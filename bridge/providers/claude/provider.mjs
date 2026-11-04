import { createClaudeEventMapper } from './events.mjs'
import { describeClaudeTool } from './tools.mjs'
/** @typedef {import('../../../shared/agent.ts').AgentProvider} AgentProvider */
// A fresh SDK query per turn binds all tool callbacks to immutable turn context.
// SDK resume keeps the conversation while an abandoned query cannot affect a new one.
export function createClaudeProvider({ query, config, registerTools }) {
  return {
    async openSession(options) {
      let resume, active, closed = false
      return {
        capabilities: { tools: true, ui: true, camera: true },
        async *run(input, signal) {
          if (closed)
            throw new Error('Session closed')
          if (active)
            throw new Error('A turn is already running')
          const events = []
          let wake, finished = false, sdk, release
          const inputDone = new Promise(resolve => { release = resolve })
          const context = { sessionId: input.sessionId, turnId: input.turnId, signal }
          const mapper = createClaudeEventMapper({ ...context, policy: options.policy })
          const push = event => {
            if (!finished) {
              events.push(event)
              wake?.()
              wake = null
            }
          }
          const emit = value => {
            if (!signal.aborted)
              push({ ...value, sessionId: input.sessionId, turnId: input.turnId })
          }
          const stop = () => {
            if (finished)
              return
            push({ ...context, type: 'terminal', status: 'interrupted' })
            finished = true
            release()
            sdk?.close?.()
            wake?.()
          }
          active = { id: input.turnId, stop, sdk: () => sdk }
          signal.addEventListener('abort', stop, { once: true })
          if (signal.aborted)
            stop()
          const pump = (async () => {
            try {
              if (finished)
                return
              const mcpServers = registerTools(options, context, emit)
              sdk = query({
                prompt: (async function*() {
                  yield {
                    type: 'user', message: {
                      role: 'user', content: input.message.content.map(part => {
                        if (part.type === 'text')
                          return { type: 'text', text: part.text }
                        return { type: 'image', source: 'url' in part ? { type: 'url', url: part.url } : { type: 'base64', media_type: part.mimeType, data: part.data } }
                      })
                    }, parent_tool_use_id: null
                  }
                  await inputDone
                })(), options: {
                  mcpServers: { ...options.integrations, ...mcpServers }, systemPrompt: options.persona ?? config.persona,
                  cwd: config.cwd, settingSources: [], model: config.model, effort: config.effort,
                  maxTurns: 24, permissionMode: 'default', includePartialMessages: true,
                  ...(resume ? { resume } : {}),
                  canUseTool: async (name) => options.policy.decide(describeClaudeTool(name)).allowed
                    ? { behavior: 'allow' } : { behavior: 'deny', message: 'Blocked: JARVIS is running in read-only mode and cannot take actions that change anything.' },
                }
              })
              for await (const raw of sdk) {
                if (finished)
                  break
                if (raw.type === 'system' && raw.subtype === 'init') {
                  resume = raw.session_id ?? resume
                  options.onReady?.((raw.mcp_servers ?? []).filter(s => !['needs-auth', 'failed'].includes(s.status)).map(s => s.name))
                }
                const mapped = mapper.accept(raw)
                for (const e of mapped)
                  push(e)
                if (mapped.some(e => e.type === 'terminal')) {
                  finished = true
                  break
                }
              }
              if (!finished)
                for (const e of mapper.finish())
                  push(e)
            }
            catch {
              if (!finished)
                push({ ...context, type: 'terminal', status: 'failed', message: 'The agent session failed.' })
            }
            finally {
              finished = true
              release()
              wake?.()
              sdk?.close?.()
            }
          })()
          try {
            while (!finished || events.length) {
              if (events.length)
                yield events.shift()
              else
                await new Promise(resolve => { wake = resolve })
            }
          }
          finally {
            stop()
            signal.removeEventListener('abort', stop)
            if (active?.id === input.turnId)
              active = null
            // The SDK may ignore cancellation. Its callback scope remains invalidated
            // do not await an uncooperative child before accepting a replacement turn.
            void pump
          }
        },
        async interrupt(turnId) {
          if (active?.id !== turnId)
            return
          const current = active
          current.stop()
          // stop() deliberately closes this per-turn query. Sending a control
          // request after close would fail and incorrectly discard resume history.
        },
        async close() { closed = true; active?.stop(); active = null },
      }
    },
  }
}
