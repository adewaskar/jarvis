import { createTurn } from './turns.mjs'
/** @typedef {import('../../shared/agent.ts').AgentProvider} AgentProvider */
/** @typedef {import('../../shared/tools.ts').ToolCatalog} ToolCatalog */
export function createConversationService({ provider, tools, policy, clientCapabilities, sessionOptions = {}, clock = globalThis, interruptTimeoutMs = 400 }) {
  async function bounded(action) {
    let timer
    try {
      return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => { timer = clock.setTimeout(() => reject(new Error('Interruption timed out')), interruptTimeoutMs) })])
    }
    finally {
      clock.clearTimeout(timer)
    }
  }
  return {
    async open({ sessionId, emit }) {
      const options = { ...sessionOptions, tools, policy, clientCapabilities }
      let session = await provider.openSession(options), active = null, closed = false
      let operations = Promise.resolve()
      const enqueue = fn => { const next = operations.then(fn); operations = next.catch(() => { }); return next }
      const used = new Set()
      async function interrupt() {
        const old = active
        if (!old)
          return
        active = null
        old.controller.abort()
        old.finish('interrupted')
        try {
          await bounded(async () => { await old.session.interrupt(old.input.turnId); await old.done })
        }
        catch {
          const discarded = session
          session = null
          // Do not wait indefinitely for an SDK that ignores cancellation.
          void bounded(() => discarded.close()).catch(() => { })
        }
      }
      return {
        ask(input) {
          return enqueue(async () => {
            if (closed)
              throw new Error('Conversation closed')
            if (!input.turnId || used.has(input.turnId))
              throw new Error('Turn ID must be unique')
            await interrupt()
            if (!session)
              session = await provider.openSession(options)
            const turn = createTurn({ ...input, sessionId }, emit)
            used.add(input.turnId)
            active = turn
            turn.session = session
            turn.done = (async () => {
              try {
                for await (const event of turn.session.run(turn.input, turn.controller.signal)) {
                  if (active === turn && !turn.controller.signal.aborted)
                    turn.emit(event)
                }
                if (active === turn)
                  turn.finish('failed', 'The agent stream ended without a result.')
              }
              catch {
                if (active === turn)
                  turn.finish('failed', 'The agent session failed.')
              }
              finally {
                if (active === turn)
                  active = null
              }
            })()
          })
        },
        interrupt() { return enqueue(interrupt) },
        close() {
          return enqueue(async () => {
            if (closed)
              return
            closed = true
            await interrupt()
            if (session) {
              const old = session
              session = null
              await bounded(() => old.close()).catch(() => { })
            }
          })
        },
      }
    },
  }
}
