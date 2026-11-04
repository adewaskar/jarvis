/** Deterministic provider; scripted functions can wait on test-controlled gates. */
export function createFakeProvider(script = []) {
 return {
  async openSession() {
   let closed = false
   return {
    capabilities: {},
    async *run(input, signal) {
     if (closed) throw new Error('Session closed')
     for (const step of script) {
      const event = typeof step === 'function' ? await step(input, signal) : step
      if (event) yield { ...event, sessionId: input.sessionId, turnId: input.turnId }
     }
    },
    async interrupt() {},
    async close() { closed = true },
   }
  },
 }
}
