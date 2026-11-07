import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { createConnection } from 'node:net'
import { readdir, stat } from 'node:fs/promises'
import { userInfo } from 'node:os'
import { join } from 'node:path'

/**
 * JARVIS's hands on your actual browser.
 *
 * Not Playwright. Playwright drives a fresh automation profile: no cookies, no
 * sessions, and a fingerprint that the sites worth visiting recognise on sight
 * — you land on a login wall or a bot check, which is exactly where a voice
 * assistant is least able to help. The browser already sitting on the desk has
 * none of those problems. It is signed in to everything, it looks like a person
 * because it is one, and the pages it can reach are the pages the user actually
 * cares about.
 *
 * Reaching it is the interesting part.
 *
 * The Claude for Chrome extension already speaks to a local process — that is
 * how Claude Code's own browser tools work. The chain is:
 *
 *   Chrome extension  (fcoeoabgfenejglbffodgkkbkcdhcgfn)
 *        ↕  Chrome Native Messaging: 4-byte little-endian length + JSON
 *   chrome-native-host
 *        ↕  Unix socket: /tmp/claude-mcp-browser-bridge-<user>/<pid>.sock
 *   whoever connects  ← this file
 *
 * What Claude Code normally does at that last step is detour through
 * `wss://bridge.claudeusercontent.com`, matching the CLI and the extension by
 * user id and OAuth token in Anthropic's cloud. That hop is the source of most
 * of the "Browser extension is not connected" reports: the socket underneath is
 * healthy and the bridge above it simply fails to authenticate, with no
 * fallback to the socket that was working all along.
 *
 * We are on the same machine as the socket, so we skip the round trip to
 * Virginia entirely and connect to it directly. Nothing about the browser side
 * changes — the extension does not know or care who is on the other end of its
 * native host.
 *
 * The cost of going under a private interface is that it can move. Everything
 * that could break is therefore soft: the socket is re-discovered on every
 * reconnect rather than pinned, an unreachable extension is reported to the
 * model as a plain sentence instead of thrown, and no tool here is required for
 * the rest of JARVIS to work.
 */

/**
 * Where the native host puts its socket.
 *
 * `userInfo().username` rather than $USER, which is unset under launchd — and a
 * bridge started from a login item is exactly the case where a wrong guess
 * would look like the extension being uninstalled.
 */
const SOCKET_DIR = `/tmp/claude-mcp-browser-bridge-${userInfo().username}`

/**
 * The same rendezvous on Windows, which has no Unix sockets in /tmp.
 *
 * The native host listens on a named pipe instead, and the name carries no pid:
 * there is exactly one candidate, so nothing to sort and no stale file to step
 * around. Everything above this — the length-prefixed frames, the connection
 * handling — is unchanged, because net.createConnection dials a pipe by path
 * exactly as it dials a socket.
 */
const PIPE_NAME = `claude-mcp-browser-bridge-${userInfo().username}`
const PIPE_PATH = `\\\\.\\pipe\\${PIPE_NAME}`

/**
 * How long a single browser action may take.
 *
 * Generous because these are real page loads on a real network, and the failure
 * we are avoiding is not a slow answer but a promise that never settles and
 * silently wedges the turn. A navigation to a heavy site genuinely can take
 * fifteen seconds; a screenshot of it takes a couple more.
 */
const CALL_TIMEOUT_MS = 45_000

/** Connecting to a socket on the same machine either works at once or is dead. */
const CONNECT_TIMEOUT_MS = 3_000

/**
 * Find the socket to talk to.
 *
 * The name carries the native host's pid, so it changes every time Chrome
 * restarts and the old file is left behind — picking the wrong one gives a
 * connection that opens successfully and then answers nothing, which is the
 * most confusing failure available. Newest by modification time is the live one.
 *
 * `0.sock` is deliberately deprioritised: it is a symlink some builds create
 * and then fail to update across a Chrome restart, so it is the single most
 * likely file here to be pointing at a host that no longer exists. It is still
 * accepted as a last resort, because on some setups it is all there is.
 */
async function findSocket() {
  let names
  try {
    // Windows exposes its pipes as a directory too, so the "is anything
    // listening?" question stays one readdir — and the boot log keeps telling
    // the truth instead of promising a browser that is not there.
    if (process.platform === 'win32') {
      const pipes = await readdir('\\\\.\\pipe\\')
      return pipes.includes(PIPE_NAME) ? PIPE_PATH : null
    }
    names = await readdir(SOCKET_DIR)
  } catch {
    return null
  }
  const candidates = []
  for (const name of names) {
    if (!name.endsWith('.sock')) continue
    const path = join(SOCKET_DIR, name)
    try {
      const info = await stat(path)
      candidates.push({ path, at: info.mtimeMs, fallback: name === '0.sock' })
    } catch {
      /* vanished between readdir and stat — a restart mid-scan */
    }
  }
  if (!candidates.length) return null
  candidates.sort((a, b) => a.fallback - b.fallback || b.at - a.at)
  return candidates[0].path
}

/**
 * One connection, one request in flight.
 *
 * The wire protocol carries no request id — a reply is simply the next frame —
 * so two overlapping calls would be indistinguishable and the answers could be
 * handed to the wrong caller. Serialising is not a performance compromise here:
 * the browser is a single visible window doing one thing at a time, and the
 * model is watching each result before deciding the next action anyway.
 */
class ChromeLink {
  constructor() {
    this.socket = null
    this.path = null
    /** Tail of the current request chain, so calls queue rather than collide. */
    this.chain = Promise.resolve()
    /** Bytes received but not yet forming a whole frame. */
    this.buffer = Buffer.alloc(0)
    /** Resolver for the frame we are currently waiting on. */
    this.waiting = null
  }

  /** Drop the connection and forget it, so the next call re-discovers. */
  reset(err) {
    const pending = this.waiting
    this.waiting = null
    this.buffer = Buffer.alloc(0)
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.destroy()
      this.socket = null
    }
    this.path = null
    if (pending) pending.reject(err ?? new Error('browser connection closed'))
  }

  /** Pull whole frames out of the byte stream and hand them to the waiter. */
  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      if (this.buffer.length < 4) return
      const length = this.buffer.readUInt32LE(0)
      // A frame larger than this is a desynchronised stream, not a big reply —
      // reading it would mean waiting for bytes that are never coming.
      if (length > 64 * 1024 * 1024) {
        this.reset(new Error('browser sent a malformed frame'))
        return
      }
      if (this.buffer.length < 4 + length) return
      const body = this.buffer.subarray(4, 4 + length)
      this.buffer = this.buffer.subarray(4 + length)
      const waiter = this.waiting
      this.waiting = null
      if (!waiter) continue // unsolicited frame; nothing asked for it
      try {
        waiter.resolve(JSON.parse(body.toString('utf8')))
      } catch (err) {
        waiter.reject(new Error(`unreadable reply from the browser: ${err.message}`))
      }
    }
  }

  async ensureConnected() {
    if (this.socket && !this.socket.destroyed) return
    const path = await findSocket()
    if (!path) {
      throw new Error(
        'The Claude browser extension is not running on this machine. ' +
          'Open Chrome with the Claude extension enabled, then try again.',
      )
    }
    await new Promise((resolve, reject) => {
      const socket = createConnection(path)
      const timer = setTimeout(() => {
        socket.destroy()
        reject(new Error('the browser extension did not accept a connection'))
      }, CONNECT_TIMEOUT_MS)

      socket.once('connect', () => {
        clearTimeout(timer)
        this.socket = socket
        this.path = path
        socket.on('data', (chunk) => this.onData(chunk))
        // Both of these mean the same thing to us: whatever we were waiting for
        // is not coming, and the next call must dial again from scratch. The
        // native host dies with Chrome, so this fires on every browser restart.
        socket.on('error', (err) => this.reset(err))
        socket.on('close', () => this.reset(new Error('the browser disconnected')))
        resolve()
      })
      socket.once('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })
  }

  /** Send one framed message and wait for exactly one framed reply. */
  async request(message) {
    await this.ensureConnected()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // A timed-out call leaves the stream ambiguous — a late reply would be
        // read as the answer to whatever runs next — so the connection goes
        // rather than being reused.
        this.reset(new Error('the browser did not answer in time'))
      }, CALL_TIMEOUT_MS)

      this.waiting = {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        },
      }

      const body = Buffer.from(JSON.stringify(message), 'utf8')
      const header = Buffer.alloc(4)
      header.writeUInt32LE(body.length, 0)
      this.socket.write(Buffer.concat([header, body]), (err) => {
        if (err) {
          this.reset(err)
        }
      })
    })
  }

  /**
   * Run one extension tool. Queued behind whatever is already running.
   *
   * A dropped connection is retried exactly once, because the overwhelmingly
   * common cause is a socket that went stale while JARVIS was idle — Chrome was
   * restarted between two questions — and re-dialling silently is much better
   * than telling the user their browser is unavailable when it is sitting right
   * there. A second failure is real and is reported.
   */
  call(name, args) {
    const run = async () => {
      const message = { method: 'execute_tool', params: { tool: name, args: args ?? {} } }
      try {
        return await this.request(message)
      } catch (err) {
        this.reset()
        return await this.request(message)
      }
    }
    // Chained on the tail whether or not the previous call succeeded, so one
    // failure cannot stall every later call behind a rejected promise.
    const result = this.chain.then(run, run)
    this.chain = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

const link = new ChromeLink()

/**
 * Turn a native-host reply into an MCP result.
 *
 * The happy path already carries MCP-shaped content blocks — text and images,
 * exactly what the extension's own tools return — so those pass through
 * untouched rather than being stringified and re-parsed. Errors arrive as
 * `{ error: { content } }` and become an MCP error, which is what puts them in
 * front of the model as something to react to rather than as a silent nothing.
 */
function toResult(reply) {
  if (!reply || typeof reply !== 'object') {
    return { isError: true, content: [{ type: 'text', text: 'The browser returned nothing.' }] }
  }
  if (reply.error) {
    const detail = reply.error.content ?? reply.error.message ?? reply.error
    return {
      isError: true,
      content: [{ type: 'text', text: typeof detail === 'string' ? detail : JSON.stringify(detail) }],
    }
  }
  const content = reply.result?.content
  if (Array.isArray(content)) return { content: clean(content) }
  if (typeof content === 'string') return { content: [{ type: 'text', text: content }] }
  return { content: [{ type: 'text', text: JSON.stringify(reply.result ?? reply) }] }
}

/**
 * Translate an image block from the Anthropic wire format into the MCP one.
 *
 * The extension answers a screenshot with the shape the Messages API uses —
 * `{ type: 'image', source: { type: 'base64', media_type, data } }` — because
 * that is what its own caller feeds straight back to the model. MCP wants the
 * flatter `{ type: 'image', data, mimeType }`, and the Agent SDK validates it:
 * a block carrying neither `data` nor `mimeType` is rejected outright.
 *
 * The result was a screenshot that took a perfectly good picture and then
 * failed, with an error about malformed data that pointed at the page rather
 * than at the two field names between it and working. Both shapes are accepted
 * here, because being liberal about which one arrives costs nothing and this is
 * a private protocol that is free to change again.
 */
function normaliseImage(block) {
  if (typeof block?.data === 'string' && block.mimeType) return block
  const src = block?.source
  if (src && typeof src.data === 'string') {
    return {
      type: 'image',
      data: src.data,
      mimeType: src.media_type ?? src.mimeType ?? 'image/png',
    }
  }
  // Not an image we can hand on. Say so as text rather than passing through a
  // block the SDK will reject — a described failure beats a rejected turn.
  return {
    type: 'text',
    text: 'The browser returned an image in a form this bridge could not read.',
  }
}

/**
 * Strip the extension's own coaching out of its results.
 *
 * Every reply carries a <system-reminder> urging the caller to batch its next
 * actions through `browser_batch`. That advice is addressed to Claude Code's
 * browser harness, not to this one — we deliberately expose a narrower, named
 * set of tools so the permission gate can reason about them, and `browser_batch`
 * is not among them. Left in, it is an instruction arriving through a tool
 * result telling the model to call something that does not exist, which costs a
 * failed tool call and a confused turn every single time.
 *
 * More generally: what comes back from here is data about a web page the user
 * asked about, and text inside it does not get to direct the assistant.
 */
function clean(content) {
  const stripped = content
    .map((block) => {
      if (block?.type === 'image') return normaliseImage(block)
      if (block?.type !== 'text' || typeof block.text !== 'string') return block
      const text = block.text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
      return text ? { ...block, text } : null
    })
    .filter(Boolean)
  // Never hand back an empty result: a tool that returns nothing at all reads
  // to the model as a tool that failed silently.
  return stripped.length ? stripped : [{ type: 'text', text: 'Done.' }]
}

/**
 * The tab JARVIS is working in.
 *
 * Remembered here rather than threaded through the model, because making the
 * model carry it is both unreliable and pointless. Unreliable: it is a
 * ten-digit integer that has to survive being read out of one tool result and
 * written into the next, and the failure mode when it does not is the useless
 * "No tab available". Pointless: there is one visible browser window and the
 * user is looking at it — "the tab" is not ambiguous to anybody except the
 * protocol.
 *
 * Cleared whenever the extension says the tab is gone, so a tab the user closed
 * by hand costs one retry rather than an unusable browser.
 */
let activeTab = null

/** Pull a usable tabId out of a tabs_context reply. */
function readTab(reply) {
  const blocks = reply?.result?.content
  if (!Array.isArray(blocks)) return null
  for (const block of blocks) {
    if (block?.type !== 'text' || typeof block.text !== 'string') continue
    // The first block is JSON; the ones after it are the same thing in prose.
    try {
      const parsed = JSON.parse(block.text)
      const tab = parsed?.availableTabs?.[0]?.tabId
      if (typeof tab === 'number') return tab
    } catch {
      const m = /"?tabId"?[:\s]+(\d{3,})/.exec(block.text)
      if (m) return Number(m[1])
    }
  }
  return null
}

/**
 * Wait until the tab is actually showing the page we asked for.
 *
 * `navigate` returns as soon as the navigation is *accepted*, not when the
 * document is ready — and, worse, the tab context it hands back reports the new
 * URL immediately while the page underneath is still the old one. So the
 * obvious check is the one that does not work: the URL agrees with you while
 * the content lies. Measured, reading straight after a navigate returned the
 * previous page in full, which for a voice assistant means confidently
 * answering a question about the wrong article.
 *
 * The reliable signal is the reader's own view of where it is: get_page_text
 * prints a `URL:` line describing the document it actually parsed. When that
 * line agrees with the target, the page really has landed.
 */
const SETTLE_TRIES = 16
const SETTLE_GAP_MS = 400

/** Same page? Compared on origin + path, since fragments and trailing slashes
 *  differ freely between what you ask for and what you get. */
function samePage(a, b) {
  try {
    const x = new URL(a)
    const y = new URL(b)
    return (
      x.host.replace(/^www\./, '') === y.host.replace(/^www\./, '') &&
      x.pathname.replace(/\/$/, '') === y.pathname.replace(/\/$/, '')
    )
  } catch {
    return false
  }
}

async function settle(tab, target) {
  for (let i = 0; i < SETTLE_TRIES; i++) {
    let reply
    try {
      reply = await link.call('get_page_text', { tabId: tab, max_chars: 200 })
    } catch {
      return // the browser went away; the caller's own error path will say so
    }
    const blocks = reply?.result?.content
    const text = Array.isArray(blocks)
      ? blocks.map((b) => (typeof b?.text === 'string' ? b.text : '')).join('\n')
      : ''
    const at = /^URL:\s*(\S+)/m.exec(text)
    if (at && samePage(at[1], target)) return
    await new Promise((r) => setTimeout(r, SETTLE_GAP_MS))
  }
}

/** The tab to act on: the one named, the one we remember, or a fresh one. */
async function resolveTab(given) {
  if (given !== undefined && given !== null && `${given}`.trim() !== '') {
    const asked = Number(given)
    if (Number.isFinite(asked)) return asked
  }
  if (activeTab !== null) return activeTab
  const reply = await link.call('tabs_context_mcp', { createIfEmpty: true })
  activeTab = readTab(reply)
  return activeTab
}

/**
 * Every tool here is the same two lines; only the name and the schema differ.
 *
 * `needsTab` is false only for the handful that address the browser rather than
 * a page — listing tabs, opening one — which are also the ones that would
 * deadlock if resolving a tab called them.
 */
function forward(name, { needsTab = true } = {}) {
  return async (args) => {
    try {
      let sent = args ?? {}
      if (needsTab) {
        const tab = await resolveTab(sent.tabId)
        sent = tab === null ? sent : { ...sent, tabId: tab }
      }
      let reply = await link.call(name, sent)
      // The tab we remembered has gone — the user closed it, or Chrome was
      // restarted under us. Forget it and try once with a fresh one before
      // reporting a browser that is actually working fine.
      if (needsTab && reply?.error && /no tab available/i.test(JSON.stringify(reply.error))) {
        activeTab = null
        const tab = await resolveTab(undefined)
        if (tab !== null) reply = await link.call(name, { ...(args ?? {}), tabId: tab })
      }
      return toResult(reply)
    } catch (err) {
      // Plainly worded because it may well be spoken. The model is told what to
      // do about it, since it is the only one that can act.
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text:
              `Could not reach the browser: ${err?.message ?? err}. ` +
              'Tell the user their browser is not available and carry on without it.',
          },
        ],
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Schemas
//
// Loose in the same way ui.mjs is loose, and for the same reason: a turn that
// fails because a coordinate arrived as a string is a turn the user watched
// break. Anything the extension will tolerate, we pass along.
// ---------------------------------------------------------------------------

/**
 * Which tab to act on.
 *
 * Numeric, and the extension means it: these ids are large integers and a
 * string form is not accepted. It is also not optional in the way an
 * ergonomically designed API would make it — omit it and every acting tool
 * answers "No tab available", including immediately after a tab group has been
 * created. Both facts were learned the way facts about undocumented protocols
 * usually are.
 *
 * So the schema says "optional" and means it, but the optionality is provided
 * by us rather than by the extension: see resolveTab. The model is free to name
 * a tab when it has a reason to, and free to ignore the concept entirely when
 * it does not, which is most of the time.
 */
const tabId = z
  .union([z.number(), z.string()])
  .optional()
  .catch(undefined)
  .describe(
    'Which tab to act on — a numeric tabId from chrome_tabs. Omit it and the ' +
      'tab JARVIS is already working in is used, opening one if there is none.',
  )

const NAVIGATE_DESCRIPTION = `Open a URL in the user's own Chrome.

This is their real browser, so every site they are signed in to is already
signed in — mail, calendar, dashboards, anything behind a login. That is the
whole reason to use this rather than fetching a page yourself.

Use it when the answer lives behind a login, when a page has to be *seen*, or
when the user says to open something. For a public page you only need to read,
searching or fetching is faster and does not disturb what is on their screen.

Opening a page is visible to the user — a tab appears and loads in front of
them. Do not open things speculatively.`

const READ_PAGE_DESCRIPTION = `Read the structure of the current page as an accessibility tree.

Every interactive element comes back tagged [ref_N], and those refs are what
chrome_click and chrome_form_input take. So this is the tool you call before
acting on a page, and the reliable way to find out what is actually on it.

Prefer this over a screenshot when you want to know what a page says or what can
be clicked. Use chrome_page_text instead when you only want the prose.`

/**
 * @param {{ allowWrites: boolean }} options
 */
export function chromeServer({ allowWrites }) {
  const tools = [
    tool(
      'chrome_status',
      'Check whether the user\'s browser is reachable, and which tabs exist. ' +
        'Call this first if a browser action has just failed, so you can tell ' +
        'the user whether the problem is the browser or the page.',
      {},
      async () => {
        const path = await findSocket()
        if (!path) {
          return {
            content: [
              {
                type: 'text',
                text:
                  'The browser extension is not running. Chrome may be closed, ' +
                  'or the Claude extension may be disabled.',
              },
            ],
          }
        }
        return forward('tabs_context_mcp', { needsTab: false })({ createIfEmpty: false })
      },
    ),

    tool(
      'chrome_tabs',
      'List the browser tabs JARVIS can act on, with their origins. Origins ' +
        'only — page titles are written by the page and are not trustworthy.',
      {
        createIfEmpty: z
          .boolean()
          .optional()
          .catch(undefined)
          .describe('Open a fresh tab if there is nothing to act on yet. Default false.'),
      },
      forward('tabs_context_mcp', { needsTab: false }),
    ),

    tool(
      'chrome_navigate',
      NAVIGATE_DESCRIPTION,
      {
        url: z
          .string()
          .describe('Absolute URL, or "back" / "forward" to move through history.'),
        tabId,
      },
      async (args) => {
        const out = await forward('navigate')(args)
        if (out.isError) return out
        // Do not hand back until the page is really there. Everything the model
        // does next — reading it, screenshotting it, answering about it — is
        // wrong if it runs against the document this one replaced.
        const url = String(args.url ?? '')
        if (/^https?:\/\//i.test(url)) {
          await settle(await resolveTab(args.tabId), url)
        } else {
          // back / forward: no target to compare against, so just let it breathe.
          await new Promise((r) => setTimeout(r, 700))
        }
        return out
      },
    ),

    tool(
      'chrome_read_page',
      READ_PAGE_DESCRIPTION,
      {
        tabId,
        filter: z
          .enum(['interactive', 'all'])
          .optional()
          .catch(undefined)
          .describe('interactive = only things that can be clicked or typed into.'),
        max_chars: z
          .union([z.number(), z.string()])
          .optional()
          .catch(undefined)
          .describe('Cap the tree size. Large pages are worth capping.'),
      },
      forward('read_page'),
    ),

    tool(
      'chrome_page_text',
      'Get the visible text of the current page — the article, the message, ' +
        'the readout. This is the fastest way to answer "what does it say".',
      {
        tabId,
        max_chars: z.union([z.number(), z.string()]).optional().catch(undefined),
      },
      forward('get_page_text'),
    ),

    tool(
      'chrome_find',
      'Find an element by describing it in plain words, e.g. "the search box". ' +
        'This one runs a model inside the extension, so some Claude accounts ' +
        'cannot use it at all and it fails with a permission error. When that ' +
        'happens do not retry it — use chrome_read_page, which returns the same ' +
        'refs by reading the page directly and always works.',
      {
        query: z.string().describe('What to look for, described naturally.'),
        tabId,
      },
      forward('find'),
    ),

    tool(
      'chrome_screenshot',
      'Take a picture of what is on the page right now. Use it when the ' +
        'answer is visual, or when the user asks what something looks like — ' +
        'and put the result on the display rather than describing it.',
      { tabId },
      async (args) => forward('computer')({ action: 'screenshot', ...args }),
    ),

    tool(
      'chrome_scroll',
      'Scroll the page to bring more of it into view. A read that happens to ' +
        'move the page, not an action on it.',
      {
        direction: z.enum(['up', 'down', 'left', 'right']).catch('down'),
        amount: z.union([z.number(), z.string()]).optional().catch(undefined),
        tabId,
      },
      async (args) =>
        forward('computer')({
          action: 'scroll',
          scroll_direction: args.direction ?? 'down',
          scroll_amount: args.amount ?? 3,
          coordinate: [400, 400],
          tabId: args.tabId,
        }),
    ),

    tool(
      'chrome_console',
      'Read console output from the page. For diagnosing a site that is ' +
        'misbehaving, not for ordinary browsing.',
      {
        tabId,
        onlyErrors: z.boolean().optional().catch(undefined),
        limit: z.union([z.number(), z.string()]).optional().catch(undefined),
      },
      forward('read_console_messages'),
    ),

    tool(
      'chrome_network',
      'List network requests the page made, or fetch one response body by id.',
      {
        tabId,
        urlPattern: z.string().optional().catch(undefined),
        requestId: z.string().optional().catch(undefined),
        limit: z.union([z.number(), z.string()]).optional().catch(undefined),
      },
      forward('read_network_requests'),
    ),
  ]

  /**
   * The acting half.
   *
   * These are withheld by default, and the reason is specific to what this
   * server is: it is pointed at a browser that is signed in to the user's mail,
   * their bank and their employer. A misheard sentence that merely reads a page
   * is a wasted turn; a misheard sentence that clicks a button on a page that
   * is already authenticated is something else. The gate is the same one the
   * rest of the bridge uses, so a user who has decided to trust it turns both
   * on together.
   */
  if (allowWrites) {
    tools.push(
      tool(
        'chrome_click',
        'Click something on the page. Take the ref from chrome_read_page or ' +
          'chrome_find rather than guessing coordinates. Say what you are ' +
          'about to do before doing anything irreversible.',
        {
          ref: z.string().optional().catch(undefined).describe('A ref_N from chrome_read_page.'),
          coordinate: z
            .array(z.number())
            .optional()
            .catch(undefined)
            .describe('[x, y] fallback when there is no ref.'),
          tabId,
        },
        async (args) => forward('computer')({ action: 'left_click', ...args }),
      ),

      tool(
        'chrome_type',
        'Type text into whatever is focused. Click the field first.',
        { text: z.string(), tabId },
        async (args) => forward('computer')({ action: 'type', ...args }),
      ),

      tool(
        'chrome_key',
        'Press a key or chord, e.g. "Return", "Escape", "cmd+a".',
        { text: z.string().describe('The key to press.'), tabId },
        async (args) => forward('computer')({ action: 'key', ...args }),
      ),

      tool(
        'chrome_form_input',
        'Set the value of a form field directly — more reliable than typing ' +
          'for selects, checkboxes and long values.',
        {
          ref: z.string().describe('A ref_N from chrome_read_page.'),
          value: z.union([z.string(), z.number(), z.boolean()]),
          tabId,
        },
        forward('form_input'),
      ),

      tool(
        'chrome_new_tab',
        'Open a fresh blank tab and work in it from now on.',
        {},
        async (args) => {
          const out = await forward('tabs_create_mcp', { needsTab: false })(args)
          // Whatever was just opened is what the next action should land in.
          activeTab = null
          return out
        },
      ),

      tool(
        'chrome_close_tab',
        'Close a tab by id.',
        {
          tabId: z
            .union([z.number(), z.string()])
            .describe('The numeric tabId to close, from chrome_tabs.'),
        },
        async (args) => {
          const out = await forward('tabs_close_mcp', { needsTab: false })(args)
          if (Number(args.tabId) === activeTab) activeTab = null
          return out
        },
      ),
    )
  }

  return createSdkMcpServer({
    name: 'jarvis_chrome',
    version: '1.0.0',
    instructions:
      "The user's own Chrome, already signed in to everything they use. " +
      'Reach for it when the answer is behind a login or has to be seen on a ' +
      'real page. Reading is free; acting on a page is not, so say what you ' +
      'are doing before you do anything that changes something.',
    // Behind tool search the model would never think to look, and "open my
    // GitHub notifications" would quietly become a web search instead.
    alwaysLoad: true,
    tools,
  })
}

/** Whether the extension looks reachable, for the boot log. */
export async function chromeAvailable() {
  return (await findSocket()) !== null
}
