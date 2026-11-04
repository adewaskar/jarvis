import test from 'node:test'
import assert from 'node:assert/strict'
import { createFakeProvider } from './fakes/provider.mjs'
import type { Message, AgentProvider } from '../shared/agent.ts'
test('provider accepts independent multimodal messages and correlates events', async () => {
 const provider: AgentProvider = createFakeProvider([{ type: 'text', delta: 'Hi' }, { type: 'terminal', status: 'completed', text: 'Hi' }])
 const message: Message = { role: 'user', content: [{ type: 'text', text: 'Describe' }, { type: 'image', mimeType: 'image/jpeg', data: 'abc' }] }
 const session = await provider.openSession({ persona: '', tools: {create:()=>[]}, integrations: {}, capabilities: {} })
 const events = []
 for await (const e of session.run({sessionId:'s',turnId:'a',message},new AbortController().signal)) events.push(e)
 assert.deepEqual(events.map(e=>e.type),['text','terminal'])
 assert.ok(events.every(e=>e.sessionId==='s' && e.turnId==='a'))
 assert.equal(session.capabilities.camera, undefined)
 await session.close()
})
