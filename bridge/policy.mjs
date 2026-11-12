/**
 * What JARVIS may do, decided in one place.
 *
 * Two layers, and the difference between them is the point of this file:
 *
 *   tierOf(name, policy)      — the policy by tool *name*: 'allow', 'confirm'
 *                               (waits for the user to press Enter on screen)
 *                               or 'deny'. Read from an explicit policy file —
 *                               see default-policy.json — not guessed from
 *                               verbs in tool names.
 *   checkToolUse(name, input) — the same policy plus the *arguments*: where a
 *                               file tool is pointed, what a fetch is aimed at.
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
 *
 * Why a list instead of the verb rules this used to have. Reading verbs out of
 * tool names fails open in both directions that matter: `search_and_replace`
 * begins with a read verb and ran, and on an allowlisted server anything whose
 * effectful verb was not in the regex — `clone`, `share`, `forward`, `move`,
 * `execute` — ran too. A list fails closed: a tool nobody named is refused, and
 * the bridge prints its name at startup so you can decide where it belongs.
 */

import { lookup } from 'node:dns/promises'
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs'
import { isIP } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { blockedAddress, vetTarget } from './net.mjs'

export const DEFAULT_POLICY_FILE = fileURLToPath(new URL('./default-policy.json', import.meta.url))

/**
 * `*` matches anything that does not contain `__`; every other character is
 * literal. `__` is what separates server from tool in `mcp__server__tool`, so a
 * wildcard in one part can never spill into the next.
 */
const pattern = (p) =>
  new RegExp(
    '^' +
      String(p)
        .split('*')
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('(?:(?!__).)*') +
      '$',
  )

const strings = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.trim()) : [])

/**
 * A policy object, ready to match against. Accepts the parsed JSON of a policy
 * file; anything missing is an empty list.
 */
export function compilePolicy(raw = {}) {
  return {
    allow: strings(raw.allow).map(pattern),
    confirm: strings(raw.confirm).map(pattern),
    deny: strings(raw.deny).map(pattern),
    publicServers: new Set(strings(raw.publicServers)),
    trustedHosts: strings(raw.trustedHosts),
  }
}

/**
 * The policy in force: JARVIS_POLICY if set, else ~/.jarvis/policy.json if it
 * exists, else the bundled default. A user file replaces the default rather
 * than merging into it, so what you read in it is the whole of what applies.
 * A file that will not parse stops the bridge: silently falling back to a
 * different policy than the one you wrote is the wrong kind of helpful.
 */
export function loadPolicy({ file = process.env.JARVIS_POLICY, home = homedir() } = {}) {
  const userFile = join(home, '.jarvis', 'policy.json')
  const path = file || (existsSync(userFile) ? userFile : DEFAULT_POLICY_FILE)
  let raw
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`could not read the tool policy at ${path}: ${err.message}`)
  }
  return { path, ...compilePolicy(raw) }
}

let DEFAULT_POLICY = null
const defaultPolicy = () => (DEFAULT_POLICY ??= compilePolicy(JSON.parse(readFileSync(DEFAULT_POLICY_FILE, 'utf8'))))

/** 'allow' | 'confirm' | 'deny' for a tool name. Unlisted is 'deny'. */
export function tierOf(name, policy = defaultPolicy()) {
  const hit = (list) => list.some((re) => re.test(name))
  if (hit(policy.deny)) return 'deny'
  if (hit(policy.confirm)) return 'confirm'
  if (hit(policy.allow)) return 'allow'
  return 'deny'
}

/** Whether a tool is listed at all, for the startup report of unlisted tools. */
export function isListed(name, policy = defaultPolicy()) {
  return [...policy.allow, ...policy.confirm, ...policy.deny].some((re) => re.test(name))
}

/**
 * Whether a tool can run at all in this mode: 'allow' always, 'confirm' only
 * with writes on (and then only once the user approves it). Kept as a boolean
 * for the callers that only need yes or no.
 */
export function decideTool(name, allowWrites = false, policy = defaultPolicy()) {
  const tier = tierOf(name, policy)
  return tier === 'allow' || (tier === 'confirm' && allowWrites)
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
/**
 * A Windows network or device path: \\host\share, //host/share, \\?\…, \\.\….
 *
 * Refused before anything touches the filesystem, because merely resolving one
 * makes Windows look the host up and try to connect to it — which sends the
 * host name (and whatever the model wrote into it) off the machine, and offers
 * the user's login to whoever answers.
 */
export const isNetworkPath = (p) => typeof p === 'string' && /^[\\/]{2}/.test(p.trim())

function resolveReal(p, hops = 0) {
  if (isNetworkPath(p)) return null
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
  if (isNetworkPath(target)) return `${target} is a network path`
  const expanded = target.startsWith('~') ? homedir() + target.slice(1) : target
  const joined = resolvePath(cwd, expanded)
  if (isNetworkPath(joined)) return `${target} is a network path`
  const real = resolveReal(joined)
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
 * Returns { verdict, allow, reason }. verdict is 'allow', 'confirm' (run only
 * once the user approves it on screen) or 'deny'; allow is true unless the
 * verdict is 'deny', so a confirm still counts as something that may run. The
 * reason can end up spoken, so it is a plain sentence with no paths or
 * commands to read out beyond the one the model already chose.
 */
export function checkToolUse(name, input, { allowWrites = false, cwd, roots, policy = defaultPolicy() }) {
  const deny = (reason) => ({ verdict: 'deny', allow: false, reason })
  const tier = tierOf(name, policy)
  if (tier === 'deny') {
    return deny(
      'Blocked: this tool is not in the policy JARVIS runs under. Tell the user' +
        ' it is unavailable; they can add it to their policy file if they want it.',
    )
  }
  if (tier === 'confirm' && !allowWrites) {
    return deny(
      'Blocked: JARVIS is running in read-only mode and cannot take actions' +
        ' that change anything. Tell the user this action is unavailable' +
        ' until they enable write access on the machine.',
    )
  }
  for (const field of PATH_FIELDS[name] ?? []) {
    const problem = pathProblem(input?.[field], { cwd, roots })
    if (problem) return deny(`Blocked: ${problem}.`)
  }
  if (name === 'Glob' && typeof input?.pattern === 'string') {
    // A pattern can carry its own starting point — `/etc/**`, `C:\Users\**`,
    // `\\host\share\*` — which `path` being unset or innocent says nothing
    // about. Judge the part before the first wildcard as a path of its own.
    const pattern = input.pattern.trim()
    if (/^[\\/~]|^[a-z]:[\\/]/i.test(pattern)) {
      const fixed = pattern.split(/[*?[{]/)[0]
      const problem = pathProblem(fixed || pattern, { cwd, roots })
      if (problem) return deny(`Blocked: ${problem}.`)
    }
  }
  if (/^mcp__jarvis_chrome__chrome_navigate$/.test(name)) {
    // The user's own browser goes to web pages and nowhere else. A data: or
    // javascript: address is a page the model wrote, running in that browser;
    // file: reads the disk; chrome: opens settings.
    const url = String(input?.url ?? '').replace(/[\t\n\r]/g, '').trim()
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase()
    const hostPort = /^[a-z0-9.-]+:\d{1,5}(\/|$)/i.test(url) // localhost:3000/x has no scheme
    if (scheme && !hostPort && scheme !== 'http' && scheme !== 'https' && url.toLowerCase() !== 'about:blank') {
      return deny('Blocked: the browser can only be sent to http and https addresses.')
    }
  }
  if (name === 'WebFetch') {
    // The bridge's own fetches refuse the LAN and cloud metadata; the built-in
    // fetch runs in the agent process and has no such gate, so apply the same
    // one to the URL before it goes.
    try {
      vetTarget(input?.url)
    } catch (err) {
      return deny(`Blocked: that address cannot be fetched (${err.message}).`)
    }
  }
  return { verdict: tier, allow: true, reason: null }
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
