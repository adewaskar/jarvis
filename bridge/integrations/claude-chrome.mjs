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
export function createClaudeChromeClient({ connect = createConnection, discover } = {}) {
const SOCKET_DIR = `/tmp/claude-mcp-browser-bridge-${userInfo().username}`

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
  if (discover) return discover()
  let names
  try {
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
      const socket = connect(path)
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


return { findSocket, forward, settle, resolveTab, resetTab(id) { if(id === undefined || Number(id) === activeTab) activeTab = null }, close() { link.socket?.destroy(); link.reset(new Error('Client closed')) } }
}
