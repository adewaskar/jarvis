/**
 * What JARVIS may do, decided in one place.
 *
 * Two layers, and the difference between them is the point of this file:
 *
 *   decideTool(name)         — the policy by tool *name*: which built-ins and
 *                              MCP tools count as reads and which need
 *                              JARVIS_ALLOW_WRITES. Unchanged from when it lived
 *                              in server.mjs.
 *   checkToolUse(name, input) — the same policy plus the *arguments*: where a
 *                              file tool is pointed, what a fetch is aimed at.
 *
 * The second one exists because of where it is enforced. canUseTool is not
 * consulted for every call: the CLI settles some itself before asking — a Read
 * inside the working directory, a shell command its classifier considers
 * read-only (`cat`, `ls`, `grep` …) — and those run without the callback ever
 * seeing them. Measured on @anthropic-ai/claude-agent-sdk 0.3.220 with a
 * canUseTool that denied everything: `Bash: cat ~/secret.txt` ran and its
 * output reached the model. A PreToolUse hook, by contrast, sees every call
 * before it runs, auto-approved or not, and its deny is final. So the bridge
 * enforces through the hook, and canUseTool stays as the second gate it
 * always was.
 */

import { lookup } from 'node:dns/promises'
import { lstatSync, readlinkSync, realpathSync } from 'node:fs'
import { isIP } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, relative, resolve as resolvePath, sep } from 'node:path'
import { blockedAddress, vetTarget } from './net.mjs'

/**
 * Both spellings of every renamed built-in are listed on purpose. The SDK
 * presents several tools to the model under newer names — Task is Agent,
 * BashOutput is TaskOutput, KillShell is TaskStop, and the MCP resource tools
 * gained a "Tool" suffix — so a set holding only the old names never matches
 * and the tool falls through to the write branch, which is the opposite of
 * what these lists mean. Keep both until the old names are certainly gone.
 */
export const READ_ONLY_BUILTINS = new Set([
  'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite',
  'Task', 'Agent', 'ToolSearch',
  'ListMcpResources', 'ListMcpResourcesTool',
  'ReadMcpResource', 'ReadMcpResourceTool',
  'BashOutput', 'TaskOutput',
])
export const WRITE_BUILTINS = new Set([
  'Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
  'KillShell', 'TaskStop',
])

/** MCP tools arrive as `mcp__<server>__<tool>`. */
const mcpServerOf = (toolName) =>
  toolName.startsWith('mcp__') ? toolName.split('__')[1] : null

/** The tool half, which can itself contain underscores: `mcp__x__a__b` -> `a__b`. */
const mcpToolOf = (toolName) => toolName.split('__').slice(2).join('__')

/**
 * MCP policy, and why it is shaped this way.
 *
 * A short list of "servers that can change things" is the wrong default,
 * because it is a list of what we happened to think of. Every server not on it
 * runs unconditionally — and on a real machine that quietly includes placing a
 * phone call, spending an advertising budget, deleting a generated character
 * and writing files to disk. A voice assistant cannot ask "are you sure", so
 * the bridge has to be the one that is sure.
 *
 * So the default is deny, softened in two ways so the demo stays usable:
 *
 *   1. READ_ONLY_MCP is an explicit allowlist of servers whose whole surface is
 *      lookups and generation — search, registries, analytics reads. Anything
 *      there runs in read-only mode.
 *   2. Everywhere else, the tool has to argue for itself: its own name must
 *      begin with a read verb. `list_devices` runs; `install_apk` does not.
 *
 * On top of both sits a veto: a name containing a plainly effectful verb needs
 * allowWrites no matter which server it came from, which is what keeps
 * `make_outbound_call` and `download_lottie` still until you ask for them.
 */
const READ_ONLY_MCP = new Set([
  'exa', 'exa-code', 'serper', 'serpapi', 'lottie-search', 'mcp-registry',
  'openrouter', 'openrouter-image', 'Microsoft_Clarity',
  // The generation servers belong here too, and leaving them out was a real
  // regression: `generate_image` begins with no read verb, so it fell to the
  // deny branch and "generate an image of the Mark VII suit" — the headline
  // demo — stopped working in the default mode.
  //
  // Putting them on the allowlist is safe because the veto below still applies
  // to allowlisted servers: it is what continues to withhold
  // make_outbound_call, delete_character, create_* and edit_image. Generation
  // runs; acting on the world does not.
  'higgsfield', 'heygen', 'elevenlabs',
])

/**
 * Anchored on the tool name, so it reads the verb rather than the noun.
 * `screenshot` is in here because it is a read that doesn't sound like one,
 * and the persona is told in as many words to put screenshots on the display.
 */
const READ_VERB =
  /^(get|list|read|search|find|query|fetch|check|describe|inspect|show|view|explain|screenshot)/i

/**
 * Unanchored on purpose — `make_outbound_call` and `Bulk-Edit-Events` both
 * hide their verb in the middle. `download` is here because it writes a file
 * even though it sounds like a read.
 */
const EFFECTFUL_VERB =
  /(send|call|post|create|delete|remove|update|edit|write|install|launch|tap|swipe|press|type|buy|pay|charge|publish|deploy|outbound|download)/i

/**
 * Tools whose names trip the veto without deserving it.
 *
 * The veto reads verbs out of names, which is the right instinct and
 * occasionally the wrong answer. `openrouter send-message` sends a prompt to a
 * language model and gets text back — nothing in the world changes — but it is
 * indistinguishable by name from sending mail. Asking a second model a question
 * is one of the better things this assistant can do, so it is named here
 * instead of being lost to a regex.
 *
 * Full `server__tool` keys, so an exemption can never leak across servers.
 */
const VETO_EXEMPT = new Set([
  'openrouter__send-message',
  'openrouter__send-feedback',
])

export function decideTool(name, allowWrites = false) {
  if (READ_ONLY_BUILTINS.has(name)) return true
  if (WRITE_BUILTINS.has(name)) return allowWrites

  const server = mcpServerOf(name)
  if (server) {
    // The HUD, and the interface controls beside it. Both run in this process
    // and draw on our own screen, so neither is something to withhold —
    // without them JARVIS has no display at all. They also have to be named
    // here rather than left to the verb rules below, which read `ui_theme` as
    // a write and would hold the whole surface back behind allowWrites.
    if (server === 'jarvis' || server === 'jarvis_ui') return true

    // The browser server gates itself, at construction: chromeServer() only
    // builds the acting tools — click, type, form input, close tab — when
    // allowWrites is set, so anything that reaches here at all is something
    // the same policy has already permitted. Deciding it a second time by
    // reading verbs out of the name would only get it wrong: `chrome_navigate`
    // begins with no read verb and would fall to the write branch, which would
    // withhold the one tool the whole server is for.
    if (server === 'jarvis_chrome') return true

    // The camera. Not withheld behind allowWrites: looking changes nothing,
    // and the real gate is the browser's own camera permission plus an
    // indicator the user can see for as long as it is live.
    if (server === 'jarvis_eyes') return true

    const tool = mcpToolOf(name)
    if (EFFECTFUL_VERB.test(tool) && !VETO_EXEMPT.has(`${server}__${tool}`)) {
      return allowWrites
    }
    // The session tools this bridge is developed inside count as read-only too.
    if (READ_ONLY_MCP.has(server) || server.startsWith('ccd_session')) return true
    return READ_VERB.test(tool) ? true : allowWrites
  }
  return allowWrites
}


/**
 * The built-in tools the agent is offered at all.
 *
 * Passed as the SDK's `tools` option, which is a different thing from a
 * permission: a tool left out here is not in the model's context, so it can be
 * neither called nor talked into being called. Left to its default the SDK
 * offers the whole Claude Code set — thirty-odd tools, including scheduling
 * cloud agents, sending notifications, spawning subagents and asking questions
 * through a dialog nobody can see on a voice interface. Measured, their schemas
 * are about 10,000 input tokens on every turn, roughly 40% of JARVIS's context.
 *
 * Grep and Glob are named because native builds otherwise search with Bash,
 * which is exactly what read-only mode withholds.
 */
export function builtinTools(allowWrites = false) {
  const reads = ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'ToolSearch']
  return allowWrites ? [...reads, 'Bash', 'Write', 'Edit', 'NotebookEdit'] : reads
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

/** Tools that take a path, and the field it arrives in. */
const PATH_FIELDS = {
  Read: ['file_path'],
  Write: ['file_path'],
  Edit: ['file_path'],
  MultiEdit: ['file_path'],
  NotebookEdit: ['notebook_path'],
  Glob: ['path'],
  Grep: ['path'],
}

/**
 * Places that hold credentials, refused even inside an allowed root.
 *
 * Belt and braces: with the default roots none of these is reachable anyway,
 * but JARVIS_FILE_ROOTS can widen the roots to the whole home directory, and a
 * page JARVIS has just read is exactly the thing that would ask for them.
 */
const SECRET_DIRS = ['.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.claude', '.config/gh', '.config/gcloud']
const SECRET_FILES = /^(\.env(\..*)?|\.netrc|\.git-credentials|\.npmrc|\.pypirc|\.claude\.json|id_[a-z0-9]+|.*\.(pem|key|p12|pfx|kdbx))$/i

/**
 * realpath of the deepest part of `p` that exists, with the rest re-attached.
 *
 * A dangling symlink needs following by hand: realpath fails on it, but a
 * write through it still lands at its target, so judging the link's own
 * location would let a Write escape the roots. Null for a link loop.
 */
function resolveReal(p, hops = 0) {
  let head = p
  const tail = []
  for (;;) {
    try {
      return resolvePath(realpathSync(head), ...tail.reverse())
    } catch {
      let link = false
      try {
        link = lstatSync(head).isSymbolicLink()
      } catch {
        /* nothing there at all */
      }
      if (link) {
        if (hops >= 40) return null
        const target = resolvePath(dirname(head), readlinkSync(head))
        return resolveReal(resolvePath(target, ...tail.reverse()), hops + 1)
      }
      const up = dirname(head)
      if (up === head) return p
      tail.push(basename(head))
      head = up
    }
  }
}

const inside = (root, p) => {
  const rel = relative(root, p)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * The directories file tools may touch: the workspace, the temp directory
 * (screenshots and generated media land there), and JARVIS_FILE_ROOTS.
 */
export function fileRoots({ workspace, extra = [] }) {
  return [workspace, tmpdir(), '/tmp', ...extra]
    .filter(Boolean)
    .map((root) => {
      try {
        return realpathSync(root)
      } catch {
        return resolvePath(root)
      }
    })
}

/** Why `target` may not be touched, or null if it may. */
export function pathProblem(target, { cwd, roots }) {
  if (typeof target !== 'string' || !target) return null
  const expanded = target.startsWith('~') ? homedir() + target.slice(1) : target
  const real = resolveReal(resolvePath(cwd, expanded))
  if (!real) return `${target} cannot be resolved`
  if (!roots.some((root) => inside(root, real))) {
    return `${target} is outside the folders JARVIS may use`
  }
  const home = realpathSync(homedir())
  if (inside(home, real)) {
    // Lower-cased: on a case-insensitive volume ~/.SSH is ~/.ssh.
    const rel = relative(home, real).split(sep).join('/').toLowerCase()
    if (SECRET_DIRS.some((d) => rel === d || rel.startsWith(d + '/'))) {
      return `${target} holds credentials`
    }
  }
  if (SECRET_FILES.test(basename(real))) return `${target} holds credentials`
  return null
}

/**
 * The full decision for one call: name first, then arguments.
 *
 * Returns { allow: true } or { allow: false, reason }. The reason can end up
 * spoken, so it is a plain sentence with no paths or commands to read out
 * beyond the one the model already chose.
 */
export function checkToolUse(name, input, { allowWrites = false, cwd, roots }) {
  if (!decideTool(name, allowWrites)) {
    return {
      allow: false,
      reason:
        'Blocked: JARVIS is running in read-only mode and cannot take actions' +
        ' that change anything. Tell the user this action is unavailable' +
        ' until they enable write access on the machine.',
    }
  }
  for (const field of PATH_FIELDS[name] ?? []) {
    const problem = pathProblem(input?.[field], { cwd, roots })
    if (problem) return { allow: false, reason: `Blocked: ${problem}.` }
  }
  if (name === 'WebFetch') {
    // The bridge's own fetches refuse the LAN and cloud metadata; the built-in
    // fetch runs in the agent process and has no such gate, so apply the same
    // one to the URL before it goes.
    try {
      vetTarget(input?.url)
    } catch (err) {
      return { allow: false, reason: `Blocked: that address cannot be fetched (${err.message}).` }
    }
  }
  return { allow: true }
}

/**
 * Where a WebFetch hostname actually points, or null if it is public.
 *
 * checkToolUse only sees the URL's text, so a public name that resolves to
 * 127.0.0.1 or a LAN address passes it. This resolves the name and applies the
 * same address rules as the bridge's own fetches. It cannot pin the address
 * the CLI then connects to, so a name that rebinds between the two lookups is
 * still possible; it closes the static case. `resolve` is injectable for tests.
 */
export async function fetchTargetProblem(url, resolve = lookup) {
  let host
  try {
    host = vetTarget(url).hostname.replace(/^\[|\]$/g, '')
  } catch (err) {
    return err.message
  }
  if (isIP(host)) return null // literals were judged by vetTarget
  let answers
  try {
    answers = await resolve(host, { all: true })
  } catch {
    return null // unresolvable: the fetch fails on its own
  }
  const bad = answers.find((a) => blockedAddress(a.address))
  return bad ? `${host} resolves to the private address ${bad.address}` : null
}
