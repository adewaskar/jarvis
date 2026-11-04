export function createClientCapabilities({ send, available = {}, timeoutMs = 20000, clock = globalThis }) {
  const pending = new Map()
  let sequence = 0
  let closed = false
  function settle(id, error, value) {
    const slot = pending.get(id)
    if (!slot)
      return
    pending.delete(id)
    clock.clearTimeout(slot.timer)
    slot.signal?.removeEventListener('abort', slot.abort)
    if (error)
      slot.reject(error)
    else
      slot.resolve(value)
  }
  return {
    available,
    request(kind, payload, context = {}) {
      if (closed)
        return Promise.reject(new Error('Client disconnected'))
      if (!available[kind])
        return Promise.reject(new Error(`${kind} unavailable`))
      if (context.signal?.aborted)
        return Promise.reject(new Error('Request aborted'))
      return new Promise((resolve, reject) => {
        const id = `q${++sequence}`
        const abort = () => settle(id, new Error('Request aborted'))
        const timer = clock.setTimeout(() => settle(id, new Error('Client request timed out')), timeoutMs)
        pending.set(id, { resolve, reject, timer, abort, signal: context.signal })
        context.signal?.addEventListener('abort', abort, { once: true })
        try {
          send({ ...payload, type: kind, id, ...(context.turnId ? { ask: context.turnId } : {}) })
        }
        catch (err) {
          settle(id, err)
        }
      })
    },
    receive(reply) { settle(reply.id, null, reply) },
    close() {
      closed = true; for (const id of pending.keys())
        settle(id, new Error('Client disconnected'))
    },
  }
}
