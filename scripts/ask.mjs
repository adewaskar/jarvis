// Ask the running JARVIS a question from a terminal: npm run ask -- "what is on the agency board?"
import WebSocket from 'ws'
const text = process.argv.slice(2).join(' ')
const ws = new WebSocket('ws://127.0.0.1:8787', { headers: { origin: 'http://localhost:5173' } })
let out = '', tools = [], blades = [], sent = false
const go = () => { if (!sent) { sent = true; ws.send(JSON.stringify({ type: 'ask', text, id: 'q1' })) } }
const t = setTimeout(() => { console.log('TIMEOUT\nTOOLS', tools.join(', '), '\nPARTIAL', out); process.exit(1) }, Number(process.env.ASK_TIMEOUT ?? 590000))
ws.on('message', (raw) => {
  const m = JSON.parse(raw)
  if (m.type === 'ready') go()
  if (m.type === 'text') out += m.text ?? ''
  if (m.type === 'tool') tools.push(m.name.replace(/^mcp__/, ''))
  if (m.type === 'blade') blades.push(`${m.blade.kind}:${m.blade.title}`)
  if (m.type === 'error') console.log('ERROR', m.message)
  if (m.type === 'done') { console.log('TOOLS', tools.join(', ')); console.log('BLADES', blades.join(' | ')); console.log('REPLY', m.text || out); clearTimeout(t); process.exit(0) }
})
ws.on('open', () => setTimeout(go, 2500))
