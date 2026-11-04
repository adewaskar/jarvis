import { createClientCapabilities } from './client-capabilities.mjs'
export function attachConversationSocket({ socket, app, sessionId, servers }) {
  let closed = false
  const send = msg => {
    if (!closed && socket.readyState === socket.OPEN)
      socket.send(JSON.stringify(msg))
  }
  const emit = event => {
    const { sessionId: _session, turnId, type, ...rest } = event
    if (type === 'terminal') {
      if (rest.status === 'completed')
        send({ type: 'done', ask: turnId, text: rest.text ?? '', costUsd: rest.costUsd ?? null })
      else if (rest.status === 'failed')
        send({ type: 'error', ask: turnId, message: rest.message ?? 'The turn failed.' })
      // The current frontend settles interruptions locally; no new protocol needed.
    }
    else
      send({ type, ask: turnId, ...rest })
  }
  const clientCapabilities = createClientCapabilities({ send, available: { capture: true } })
  const pending = app.openConversation({ sessionId, emit, clientCapabilities, onReady: servers => send({ type: 'ready', servers }) })
  // Register handlers before announcing readiness; the first ask may arrive immediately.
  socket.on('message', raw => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    }
    catch {
      return
    }
    if (msg.type === 'reply' && typeof msg.id === 'string') {
      clientCapabilities.receive(msg)
      return
    }
    if (msg.type === 'ask' && typeof msg.text === 'string' && typeof msg.id === 'string') {
      void pending.then(c => c.ask({ turnId: msg.id, message: { role: 'user', content: [{ type: 'text', text: msg.text }] } })).catch(() => send({ type: 'error', ask: msg.id, message: 'The question could not be started.' }))
    }
    if (msg.type === 'interrupt')
      void pending.then(c => c.interrupt()).catch(() => { })
  })
  socket.once('close', () => {
    closed = true
    clientCapabilities.close()
    void pending.then(c => c.close()).catch(() => { })
  })
  void pending.then(c => {
    if (closed)
      return c.close(); send({ type: 'ready', servers })
  }).catch(() => {
    send({ type: 'error', message: 'The agent could not be initialized.' })
    socket.close()
  })
  return { close: () => socket.close() }
}
