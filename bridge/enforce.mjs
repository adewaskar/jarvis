/**
 * The enforcement point for one session: the PreToolUse hook and the
 * canUseTool gate behind it. Kept apart from server.mjs so it can be tested
 * without starting a bridge.
 *
 * In order, for every tool call: the policy by name and arguments; then, if
 * the tool is in the confirm tier or the leak guard is holding one of its
 * destinations, an approval card that only the person at the keyboard can
 * answer; and only then anything that touches the network on the call's
 * behalf. A call that is allowed is recorded with the guard, so the first
 * private read taints the session.
 *
 * Everything here fails closed. An approval that is declined, times out, is
 * cancelled, or throws is a no. And because a hook that takes too long can be
 * abandoned by the SDK — after which the CLI carries on as though it had not
 * run — `gate` (canUseTool) re-checks the two things a card protects rather
 * than trusting that the hook finished.
 */

import { checkToolUse, fetchTargetProblem, tierOf } from './policy.mjs'

/** How much of one value a card shows before saying how much it left out. */
const VALUE_LIMIT = 1500
const CARD_LIMIT = 6000

/**
 * A value as the card shows it. Never silently shortened: what is cut is
 * counted, because "approve what you can see" is only safe if the card admits
 * what it is not showing. Line breaks are kept — a second command on a second
 * line should look like one.
 */
function show(value, limit = VALUE_LIMIT) {
  let text
  if (typeof value === 'string') text = value
  else {
    try {
      text = JSON.stringify(value)
    } catch {
      text = String(value)
    }
  }
  // Control characters (other than tab and newline) are shown as "?", so
  // nothing in a value can move the cursor or blank part of the card.
  text = Array.from(String(text ?? '').replace(/\r\n?/g, '\n'), (ch) => {
    const code = ch.charCodeAt(0)
    return (code < 32 && code !== 9 && code !== 10) || code === 127 ? '?' : ch
  }).join('')
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n[… ${text.length - limit} more characters not shown]`
}

/**
 * A human description of a call, for the approval card: every argument on its
 * own line, by name. Nothing is picked out as "the" detail by guessing from
 * key names — a stray `file_path` on a typing tool must not replace the text
 * it is about to type.
 */
export function describeCall(name, input) {
  const tool = name.startsWith('mcp__') ? name.split('__').slice(1).join(' · ') : name
  const a = input && typeof input === 'object' ? input : {}
  let detail
  if (name === 'Bash') {
    detail = show(a.command, 4000)
  } else if (name === 'Write') {
    detail = `${show(a.file_path, 400)}\n\n${show(a.content)}`
  } else if (name === 'Edit' || name === 'MultiEdit') {
    const edits = Array.isArray(a.edits) ? a.edits : [a]
    detail =
      `${show(a.file_path, 400)}\n\n` +
      edits.map((e) => `- ${show(e?.old_string, 600)}\n+ ${show(e?.new_string, 600)}`).join('\n\n')
  } else {
    // Short values first, so an oversized one cannot push the others out of view.
    const lines = Object.entries(a).map(([k, v]) => `${k}: ${show(v)}`)
    detail = lines.sort((x, y) => x.length - y.length).join('\n')
  }
  if (detail.length > CARD_LIMIT) {
    detail = `${detail.slice(0, CARD_LIMIT)}\n[… ${detail.length - CARD_LIMIT} more characters not shown]`
  }
  return { tool, detail }
}

const decision = (permissionDecision, reason) => ({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision,
    ...(reason ? { permissionDecisionReason: reason } : {}),
  },
})

const NOT_IN_TIME =
  'Blocked: this needed the user to approve it on screen and no approval was' +
  ' given. Say so in one sentence. Do not try to do it another way.'

/** Tools that act on whatever page the browser is showing. */
const ACTS_ON_PAGE = /^mcp__jarvis_chrome__chrome_(click|type|key|form_input)$/

/**
 * @param {{
 *   policy: object,
 *   allowWrites: boolean,
 *   cwd: string,
 *   roots: string[],
 *   guard: import('./guard.mjs').LeakGuard,
 *   confirm: (card: object, signal?: AbortSignal) => Promise<boolean>,
 *   pageOf?: (args: object) => Promise<string | null>,
 *   onTaint?: (by: string) => void,
 *   log?: (line: string) => void,
 *   resolveFetch?: (url: string) => Promise<string | null>,
 * }} session
 *
 * `pageOf` answers "which page would this browser action land on", as a URL.
 * Typing into a page sends what is typed to that page's site, so the card has
 * to name it and the guard has to count it.
 */
export function createEnforcer({
  policy,
  allowWrites,
  cwd,
  roots,
  guard,
  confirm,
  pageOf = async () => null,
  onTaint = () => {},
  log = () => {},
  resolveFetch = fetchTargetProblem,
}) {
  /** tool_use ids the user approved on a card, for the second gate. */
  const approved = new Set()

  const hook = async (input, _toolUseID, options) => {
    const name = input.tool_name
    const args = input.tool_input
    try {
      const verdict = checkToolUse(name, args, { allowWrites, cwd, roots, policy })
      if (!verdict.allow) {
        log(`tool ${name} -> deny (policy)`)
        return decision('deny', verdict.reason)
      }

      const leaving = guard.pending(name, args)
      let where = ''
      if (ACTS_ON_PAGE.test(name)) {
        // Where the action lands is not in its arguments, so ask the browser.
        let page = null
        try {
          const url = await pageOf(args ?? {})
          page = url ? new URL(url) : null
        } catch {
          page = null
        }
        const site = page?.hostname
          ? { host: page.hostname, port: page.port || (page.protocol === 'https:' ? '443' : '80'), href: page.href }
          : { host: null, port: null, href: 'the page the browser is showing, which could not be identified' }
        where = site.host ? `On ${site.host}` : 'On a page that could not be identified'
        if (guard.tainted && !guard.allows(site)) leaving.push(site)
      }

      const needsCard = verdict.verdict === 'confirm' || leaving.length > 0
      if (needsCard) {
        const { tool, detail } = describeCall(name, args)
        const action = [where, detail].filter(Boolean).join('\n')
        const hosts = leaving.map((d) => d.host ?? 'an address that cannot be read')
        const addresses = leaving.map((d) => d.href).join('\n')
        const card = leaving.length
          ? {
              kind: 'leak',
              title: `Send to ${[...new Set(hosts)].join(', ')}?`,
              tool,
              // An acting tool shows what it would do as well as where to: a
              // shell command that happens to contain an address is still a
              // shell command, and the address alone would hide the rest of it.
              detail: verdict.verdict === 'confirm' ? `${action}\n\n${addresses}` : addresses,
              note:
                'Private information is in this conversation, and this would send a' +
                ' request to a site you have not approved. Approving trusts that' +
                ' site for the rest of the session.',
            }
          : { kind: 'action', title: 'Allow this action?', tool, detail: action, note: '' }
        let ok = false
        try {
          ok = (await confirm(card, options?.signal)) === true
        } catch {
          ok = false
        }
        // An answer that arrives after the turn was abandoned approves nothing:
        // not this call, and not the host for later ones.
        if (options?.signal?.aborted) ok = false
        log(`tool ${name} -> ${ok ? 'approved' : 'declined'} by the user`)
        if (!ok) {
          return decision(
            'deny',
            leaving.length
              ? 'Blocked: the user did not approve reaching that site while private' +
                  ' information is in the conversation. Say so in one sentence. Do not' +
                  ' try to reach it another way.'
              : 'Blocked: the user declined this action. Say so in one sentence and' +
                  ' do not try another way to do the same thing.',
          )
        }
        guard.approve(leaving)
        if (input.tool_use_id) approved.add(input.tool_use_id)
      }

      // Last, and only for a call that is going ahead: looking the name up is
      // itself a message to whoever runs that name's DNS, so it must not happen
      // for an address the user has yet to approve — or has just declined.
      if (name === 'WebFetch') {
        const problem = await resolveFetch(args?.url)
        if (problem) {
          log(`tool ${name} -> deny (policy)`)
          return decision('deny', `Blocked: that address cannot be fetched (${problem}).`)
        }
      }

      if (guard.note(name)) onTaint(name)
      // Approved on a card: say so outright, since the user answered for this
      // exact call. Otherwise no opinion, and the gate below decides as usual.
      return needsCard ? decision('allow') : {}
    } catch (err) {
      log(`tool ${name} -> deny (the policy check failed: ${err?.message ?? err})`)
      return decision('deny', 'Blocked: the safety check for this action failed. Say so in one sentence.')
    }
  }

  /**
   * canUseTool. Reached for calls the hook had no opinion on, and for any the
   * SDK went ahead with after abandoning a slow hook — which is exactly a call
   * that was waiting on a card. So a confirm-tier tool passes only if its card
   * was answered yes, and nothing passes while the guard still holds one of its
   * destinations.
   */
  const gate = (name, input, toolUseID) => {
    const tier = tierOf(name, policy)
    if (tier === 'deny' || (tier === 'confirm' && !allowWrites)) {
      return {
        allow: false,
        reason:
          'Blocked: JARVIS is running in read-only mode and cannot take' +
          ' actions that change anything. Tell the user this action is' +
          ' unavailable until they enable write access on the machine.',
      }
    }
    if (tier === 'confirm' && !approved.has(toolUseID)) return { allow: false, reason: NOT_IN_TIME }
    if (!approved.has(toolUseID) && guard.pending(name, input).length) return { allow: false, reason: NOT_IN_TIME }
    return { allow: true, reason: null }
  }

  /** One turn's ids are never referred to again. */
  const endTurn = () => approved.clear()

  return { hook, gate, endTurn }
}
