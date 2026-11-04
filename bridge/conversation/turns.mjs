export function createTurn(input, emit) {
  const controller = new AbortController()
  let terminal = false
  return {
    input, controller,
    emit(event) {
      if (terminal || event.sessionId !== input.sessionId || event.turnId !== input.turnId)
        return
      if (event.type === 'terminal')
        terminal = true
      emit(event)
    },
    finish(status, message) {
      if (terminal)
        return
      terminal = true
      emit({ sessionId: input.sessionId, turnId: input.turnId, type: 'terminal', status, ...(message ? { message } : {}) })
    },
    get ended() { return terminal },
  }
}
