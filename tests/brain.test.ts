import test from 'node:test'
import assert from 'node:assert/strict'
import { createBrain } from '../src/lib/create-brain.ts'
import { createDirectAgent } from '../src/lib/providers/anthropic-direct.ts'
test('injected brain forwards independent history and reports absent capabilities',async()=>{
 let received: unknown;let cancelled=false
 const brain=createBrain({conversation:{ask:async(...args)=>{received=args;return {text:'ok',tools:[]}},cancel(){cancelled=true},connectedLabels:()=>[]}})
 const handlers={onText(){},onTool(){}}
 await brain.ask('Hi',[],handlers);assert.equal((received as unknown[])[0],'Hi')
 brain.cancel();assert.equal(cancelled,true);assert.equal(brain.capabilities.hud,false)
})
test('direct agent uses injected client, streams, preserves history, and cancels',async()=>{
 let aborted=false;let sent:unknown
 const handlers:Record<string,(x:never)=>void>={}
 let finish!:(x:unknown)=>void
 const stream = {
  on(name:string,fn:(x:never)=>void){handlers[name]=fn},
  finalMessage:()=>new Promise(r=>{finish=r}),
  abort(){aborted=true;finish({stop_reason:'end_turn'})},
 }
 const client={beta:{messages:{stream(params:unknown){sent=params;return stream}}}}
 const agent=createDirectAgent({client,model:'fake',fastMode:false,systemPrompt:'JARVIS',servers:()=>[]})

 const text:string[]=[];const history=[{role:'user' as const,content:[{type:'text' as const,text:'Hi'}]}]
 const result=agent.ask(history,{onText:x=>text.push(x),onTool(){}})
 handlers.text('Hello' as never);finish({stop_reason:'end_turn'})
 assert.equal((await result).text,'Hello');assert.deepEqual(text,['Hello']);assert.deepEqual((sent as {messages:unknown}).messages,history)
 const next=agent.ask(history,{onText(){},onTool(){}});agent.cancel();await next;assert.equal(aborted,true)
})
