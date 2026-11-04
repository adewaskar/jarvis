import test from 'node:test'
import assert from 'node:assert/strict'
import { createClaudeProvider } from '../bridge/providers/claude/provider.mjs'
import { createPermissionPolicy } from '../bridge/tools/permissions.mjs'
const input={sessionId:'s',turnId:'a',message:{role:'user',content:[{type:'text',text:'Hi'}]}}
const options={persona:'JARVIS',tools:[],integrations:{},policy:createPermissionPolicy(),onReady(){}}
test('Claude session preserves SDK options and resumes provider history without leaking SDK types',async()=>{
 const calls=[]
 const query=({options})=>{calls.push(options);return Object.assign((async function*(){yield {type:'system',subtype:'init',session_id:'sdk',mcp_servers:[]};yield {type:'result',subtype:'success',result:'Hi'};yield {type:'result',subtype:'success'}})(),{close(){}})}
 const session=await createClaudeProvider({query,config:{model:'test',effort:'high'},registerTools:()=>({})}).openSession(options)
 for(let i=0;i<2;i++) {
  const events=[];for await(const event of session.run({...input,turnId:String(i)},new AbortController().signal))events.push(event)
  assert.equal(events.length,1);assert.equal(events[0].status,'completed')
 }
 assert.deepEqual(calls[0].settingSources,[]);assert.equal(calls[0].model,'test');assert.equal(calls[1].resume,'sdk')
 assert.equal((await calls[0].canUseTool('Bash')).behavior,'deny')
 await session.close();await session.close()
})
test('Claude stream failure becomes terminal failure',async()=>{
 const session=await createClaudeProvider({query:()=>({async *[Symbol.asyncIterator](){throw Error('broken')},close(){}}),config:{},registerTools:()=>({})}).openSession(options)
 const events=[];for await(const e of session.run(input,new AbortController().signal))events.push(e)
 assert.equal(events[0].status,'failed');assert.equal(events.length,1)
})
test('interrupting an SDK query preserves resume without writing to a closed transport',async()=>{
 let release;const gate=new Promise(r=>{release=r});const resumes=[]
 const query=({options})=>{
  resumes.push(options.resume)
  let closed=false
  return {async *[Symbol.asyncIterator](){yield {type:'system',subtype:'init',session_id:'keep-history',mcp_servers:[]};if(resumes.length===1)await gate;yield {type:'result',subtype:'success',result:'Done'}},close(){closed=true;release()},async interrupt(){if(closed)throw Error('transport closed')}}
 }
 const provider=createClaudeProvider({query,config:{},registerTools:()=>({})})
 const {createConversationService}=await import('../bridge/conversation/service.mjs')
 const conv=await createConversationService({provider,tools:[],policy:createPermissionPolicy()}).open({sessionId:'s',emit(){}})
 await conv.ask({...input,turnId:'a'});await new Promise(r=>setImmediate(r))
 await conv.interrupt();await conv.ask({...input,turnId:'b'});await new Promise(r=>setImmediate(r))
 assert.deepEqual(resumes,[undefined,'keep-history']);await conv.close()
})
