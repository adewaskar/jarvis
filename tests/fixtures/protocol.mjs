export const turn = [
  { type: 'text', ask: 'a1', delta: 'Hello' },
  { type: 'tool', ask: 'a1', name: 'mcp__jarvis__display' },
  { type: 'done', ask: 'a1', text: 'Hello', costUsd: null },
]
export const session = [
  { type: 'ready', servers: ['jarvis'] },
  { type: 'panel', panel: { id: 'p1', html: '<p>Hello</p>' } },
  { type: 'blade', blade: { id: 'b1', html: '<p>Page</p>' } },
  { type: 'ui', op: 'reset', args: {} },
  { type: 'capture', id: 'q1', mode: 'look' },
  { type: 'reply', id: 'q1', data: 'abc', mimeType: 'image/jpeg' },
  { type: 'interrupt' },
  { type: 'error', ask: 'a1', message: 'Failed' },
]
