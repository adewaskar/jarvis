import test from 'node:test'
import assert from 'node:assert/strict'
import { createProvider } from '../bridge/providers/create.mjs'
import { composeBridge } from '../bridge/bootstrap.mjs'
import { createFakeProvider } from './fakes/provider.mjs'
import { loadBridgeConfig } from '../bridge/config/load.mjs'
test('composition selects injected providers, defaults to Claude and rejects invalid ID',async()=>{
 const fake=createFakeProvider([{type:'terminal',status:'completed',text:'ok'}])
 assert.equal(await createProvider('fake',{fake:()=>fake}),fake)
 await assert.rejects(createProvider('invalid',{}),/Unknown provider/)
 assert.equal(loadBridgeConfig({}).provider,'claude')
 const app=await composeBridge({config:{provider:'fake',allowWrites:false},source:{servers:{}},providerFactories:{fake:()=>fake},chromeClient:{},pages:{}})
 const events=[]
 const conv=await app.openConversation({sessionId:'s',emit:e=>events.push(e),clientCapabilities:{available:{}},onReady(){}})
 await conv.ask({turnId:'a',message:{role:'user',content:[{type:'text',text:'Hi'}]}})
 await new Promise(resolve=>setImmediate(resolve))
 assert.equal(events[0].text,'ok');await conv.close()
})
test('provider diagnosis checks only selected provider and unknown IDs cannot run commands',async()=>{
 const {diagnoseProvider}=await import('../bridge/providers/create.mjs')
 let calls=0
 assert.equal(diagnoseProvider('other',{run:()=>{calls++}}).ok,false)
 assert.equal(calls,0)
 assert.equal(diagnoseProvider('claude',{run:()=>({status:1})}).ok,false)
 assert.equal(diagnoseProvider('claude',{run:()=>({status:0})}).ok,true)
})
test('an alternative provider can execute a real UI tool through the public tool catalog',async()=>{
 let delivered=false
 const {createToolExecutor}=await import('../bridge/tools/registry.mjs')
 const provider={async openSession(options){return {capabilities:{tools:true},async *run(input,signal){
  const context={sessionId:input.sessionId,turnId:input.turnId,signal}
  const catalog=options.tools.create(context,event=>{delivered=event.type==='ui'})
  const definitions=catalog.flatMap(set=>set.tools)
  const executor=createToolExecutor({definitions,policy:options.policy})
  const result=await executor.execute('jarvis_ui:ui_reset',{},context)
  assert.equal(result.isError,undefined)
  yield {type:'terminal',status:'completed',sessionId:input.sessionId,turnId:input.turnId}
 },async interrupt(){},async close(){}}}}
 const app=await composeBridge({config:{provider:'other',allowWrites:false},source:{servers:{}},providerFactories:{other:()=>provider},chromeClient:{},pages:{}})
 const c=await app.openConversation({sessionId:'s',emit(){},clientCapabilities:{},onReady(){}})
 await c.ask({turnId:'a',message:{role:'user',content:[{type:'text',text:'Reset'}]}});await new Promise(r=>setImmediate(r))
 assert.equal(delivered,true);await c.close()
})
