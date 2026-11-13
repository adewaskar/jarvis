import Anthropic from '@anthropic-ai/sdk'
import { env, MODEL, FAST_MODE, SYSTEM_PROMPT, USER_NAME, activeServers } from '../config'

/**
 * The Claude API supports CORS, so the browser can talk to it directly — no
 * server of our own. `dangerouslyAllowBrowser` is the SDK's acknowledgement
 * that this exposes the key to anyone who opens devtools, which is acceptable
 * for a local demo and not for a public deploy.
 */
const client = new Anthropic({
  apiKey: env.anthropicKey,
  dangerouslyAllowBrowser: true,
})

export type Msg = Anthropic.Beta.BetaMessageParam

export type AskHandlers = {
  /** Fires for each chunk of the spoken answer. */
  onText: (delta: string) => void
  /** Fires when Claude starts running a remote tool. */
  onTool: (name: string) => void
}

/** The stream for the turn in flight, so a barge-in can abort it. Without this
 *  cutting JARVIS off only silenced the speaker: the model kept generating,
 *  and kept billing, into a browser nobody was listening to. */
let active: ReturnType<typeof client.beta.messages.stream> | null = null
let cancelled = false

/**
 * A server-side tool loop that runs long enough gets paused rather than
 * finished: `stop_reason: 'pause_turn'`, resumable by replaying the assistant
 * turn back with no extra user message. Left unhandled it looks like a short
 * answer and reads as JARVIS trailing off. Continuations are bounded because
 * this is a voice assistant — after a few the honest thing is to say so rather
 * than keep the user in silence.
 */
const MAX_CONTINUATIONS = 3

/**
 * One turn of conversation.
 *
 * The interesting part is `mcp_servers`: Anthropic connects to those remote MCP
 * endpoints from its own infrastructure and exposes their tools to the model.
 * The browser never touches them, so there's no CORS, no OAuth plumbing here,
 * and no bridge process to keep alive.
 */
export async function ask(
  history: Msg[],
  handlers: AskHandlers,
): Promise<{ text: string; tools: string[] }> {
  const servers = activeServers()
  const usedTools: string[] = []
  let text = ''
  cancelled = false

  const betas = ['mcp-client-2025-11-20']
  if (FAST_MODE) betas.push('fast-mode-2026-02-01')

  const params = {
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    betas,
    ...(FAST_MODE ? { speed: 'fast' as const } : {}),
    // Thinking stays on at low effort. Disabling it entirely on Opus 5 can make
    // the model write tool calls into its visible text instead of emitting a
    // real tool_use block, which would silently break every integration here.
    thinking: { type: 'adaptive' as const },
    output_config: { effort: 'low' as const },
    mcp_servers: servers.map((s) => ({
      type: 'url' as const,
      name: s.name,
      url: s.url,
      ...(s.token ? { authorization_token: s.token } : {}),
    })),
    tools: [
      // Anthropic-hosted search. Free of any setup, and it makes JARVIS able to
      // answer "what happened today" without wiring up a search provider.
      { type: 'web_search_20260209' as const, name: 'web_search' as const },
      ...servers.map((s) => ({
        type: 'mcp_toolset' as const,
        mcp_server_name: s.name,
      })),
    ],
  }

  let messages: Msg[] = history

  try {
    for (let turn = 0; ; turn++) {
      // A barge-in between continuations has no stream to abort, so the loop
      // has to check for itself rather than opening another one.
      if (cancelled) return { text: text.trim(), tools: usedTools }

      const stream = client.beta.messages.stream({ ...params, messages })
      active = stream

      stream.on('text', (delta) => {
        text += delta
        handlers.onText(delta)
      })

      stream.on('streamEvent', (event) => {
        if (event.type !== 'content_block_start') return
        const block = event.content_block

        // Two different block types reach the HUD by the same road. Tools on a
        // remote MCP server come back as `mcp_tool_use`; Anthropic's own hosted
        // tools — web search among them — come back as `server_tool_use`, and
        // matching only the first meant a search produced no tool phase, no
        // spinner and no filler line. Just several seconds of silence.
        if (block.type === 'mcp_tool_use') {
          usedTools.push(block.name)
          handlers.onTool(block.name)
        } else if (block.type === 'server_tool_use') {
          usedTools.push(block.name)
          handlers.onTool(block.name.replace(/_/g, ' '))
        }
      })

      let final: Anthropic.Beta.BetaMessage
      try {
        final = await stream.finalMessage()
      } catch (err) {
        // A barge-in aborts this stream on purpose. That surfaces as a
        // rejection, and it isn't an error the user should see a toast for —
        // hand back what he'd already said.
        if (cancelled) return { text: text.trim(), tools: usedTools }
        throw err
      } finally {
        active = null
      }

      if (final.stop_reason === 'pause_turn' && turn < MAX_CONTINUATIONS) {
        messages = [...messages, { role: 'assistant', content: final.content }]
        continue
      }

      // Everything below has to go through onText as well as the return value.
      // App speaks the deltas; the returned text only feeds history, so a line
      // that is merely returned is a line nobody ever hears.
      if (final.stop_reason === 'refusal') {
        const line = `I can't help with that one, ${USER_NAME}.`
        handlers.onText(line)
        return { text: line, tools: usedTools }
      }

      if (final.stop_reason === 'max_tokens') {
        const line = ' There is more, if you want it.'
        handlers.onText(line)
        text += line
      } else if (final.stop_reason === 'pause_turn') {
        const line = ` That is taking longer than it should, ${USER_NAME}. Ask me again.`
        handlers.onText(line)
        text += line
      }

      return { text: text.trim(), tools: usedTools }
    }
  } finally {
    active = null
  }
}

/**
 * Barge-in. Stops the generation rather than just muting it, so cutting JARVIS
 * off stops the tokens and the bill along with the voice.
 */
export function cancel(): void {
  cancelled = true
  active?.abort()
}

/**
 * Labels for the HUD's SYSTEMS rail.
 *
 * This is what is *configured*, not what is reachable. Anthropic dials these
 * servers from its own infrastructure when a tool actually runs, so the browser
 * has no way to check one without spending a turn — a revoked token shows green
 * here and only fails at the moment JARVIS tries to use it.
 */
export function connectedLabels(): string[] {
  return activeServers().map((s) => s.label)
}
