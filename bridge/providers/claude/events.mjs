import { describeClaudeTool } from './tools.mjs'
const failures = {
  error_during_execution: 'The turn failed part way through.',
  error_max_turns: 'The turn ran too long and was stopped.',
  error_max_budget_usd: 'The budget for this turn ran out.',
  error_max_structured_output_retries: 'The answer could not be assembled.',
}
export function createClaudeEventMapper({ sessionId, turnId, policy }) {
  const seen = new Set(), held = new Map()
  let ended = false
  const event = value => ({ ...value, sessionId, turnId })
  function announce(id, name) {
    if (!name || (id && seen.has(id)))
      return []
    if (id)
      seen.add(id)
    if (name === 'mcp__jarvis__display' || name.startsWith('mcp__jarvis_ui__'))
      return []
    if (policy.decide(describeClaudeTool(name)).allowed)
      return [event({ type: 'tool', name })]
    if (id)
      held.set(id, name)
    return []
  }
  return {
    accept(msg) {
      if (ended)
        return []
      if (msg.type === 'stream_event') {
        const e = msg.event
        if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta')
          return [event({ type: 'text', delta: e.delta.text })]
        if (e?.type === 'content_block_start' && e.content_block?.type === 'tool_use')
          return announce(e.content_block.id, e.content_block.name)
      }
      if (msg.type === 'assistant')
        return (msg.content ?? msg.message?.content ?? []).flatMap(b => b.type === 'tool_use' ? announce(b.id, b.name) : [])
      if (msg.type === 'user' && Array.isArray(msg.message?.content))
        return msg.message.content.flatMap(b => {
          const name = held.get(b.tool_use_id)
          if (b.type !== 'tool_result' || !name)
            return []
          held.delete(b.tool_use_id)
          return b.is_error ? [] : [event({ type: 'tool', name })]
        })
      if (msg.type === 'result') {
        ended = true
        return [event(msg.subtype === 'success' ? { type: 'terminal', status: 'completed', text: msg.result ?? '', costUsd: msg.total_cost_usd ?? null } : { type: 'terminal', status: 'failed', message: failures[msg.subtype] ?? 'The turn ended without an answer.' })]
      }
      return []
    },
    finish() {
      if (ended)
        return []
      ended = true
      return [event({ type: 'terminal', status: 'failed', message: 'The agent stream ended without a result.' })]
    },
  }
}
