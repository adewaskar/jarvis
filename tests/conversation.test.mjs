import test from 'node:test'
import assert from 'node:assert/strict'
import { createConversationService } from '../bridge/conversation/service.mjs'
import { createFakeProvider } from './fakes/provider.mjs'
const tick=()=>new Promise(resolve=>setImmediate(resolve))
const message={role:'user',content:[{type:'text',text:'Hi'}]}
test('conversation isolates delayed A text and UI from B and emits one terminal',async()=>{
 let release
 const gate=new Promise(r=>{release=r});const events=[]
 const provider=createFakeProvider([async input=>{if(input.turnId==='a')await gate;return {type:'text',delta:input.turnId}},{type:'ui',op:'reset',args:{}},{type:'terminal',status:'completed'}])
 const conversation=await createConversationService({provider,tools:[],policy:{},clientCapabilities:{},sessionOptions:{}}).open({sessionId:'s',emit:e=>events.push(e)})
 await conversation.ask({turnId:'a',message});await tick()
 await conversation.interrupt()
 await conversation.ask({turnId:'b',message});await tick();release();await tick()
 assert.deepEqual(events.filter(e=>e.type==='text').map(e=>e.delta),['b'])
 assert.equal(events.filter(e=>e.type==='ui').length,1)
 assert.equal(events.filter(e=>e.type==='terminal'&&e.turnId==='a').length,1)
 assert.equal(events.filter(e=>e.type==='terminal'&&e.turnId==='b').length,1)
 await conversation.close()
})
test('unexpected EOF fails and close interrupts an accepted hanging turn',async()=>{
 const events=[];let release
 const provider=createFakeProvider([])
 const conv=await createConversationService({provider,tools:[],sessionOptions:{}}).open({sessionId:'s',emit:e=>events.push(e)})
 await conv.ask({turnId:'a',message});await tick();assert.equal(events[0].status,'failed')
 await conv.close();await assert.rejects(conv.ask({turnId:'b',message}),/closed/)
 const hanging=createFakeProvider([()=>new Promise(r=>{release=r})])
 const c=await createConversationService({provider:hanging,tools:[],sessionOptions:{}}).open({sessionId:'x',emit:e=>events.push(e)})
 await c.ask({turnId:'c',message});await tick();await c.close();release()
 assert.equal(events.at(-1).status,'interrupted')
})
