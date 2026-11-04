import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { createToolExecutor, defineTool } from '../bridge/tools/registry.mjs'
import { createUiTools } from '../bridge/tools/ui.mjs'
import { createPermissionPolicy } from '../bridge/tools/permissions.mjs'
const context={sessionId:'s',turnId:'t',signal:new AbortController().signal}
test('reset runs independently and rejected calls cannot execute handlers',async()=>{
 const events=[];const definitions=createUiTools({emit:(...x)=>events.push(x)})
 const executor=createToolExecutor({definitions,policy:createPermissionPolicy()})
 const result=await executor.execute('jarvis_ui:ui_reset',{},context)
 assert.equal(result.isError,undefined);assert.deepEqual(events,[['reset',{}]])
 const denied=createToolExecutor({definitions,policy:{decide:()=>({allowed:false})}})
 assert.equal((await denied.execute('jarvis_ui:ui_reset',{},context)).isError,true)
 assert.equal(events.length,1)
 assert.equal((await executor.execute('missing',{},context)).isError,true)
})
test('executor validates input, output and abort before execution',async()=>{
 let calls=0
 const def=defineTool('x','X',{n:z.number()},async()=>{calls++;return {bad:true}})
 def.id='test:x';def.namespace='test';def.effect='read'
 const executor=createToolExecutor({definitions:[def],policy:createPermissionPolicy()})
 assert.equal((await executor.execute(def.id,{n:'bad'},context)).isError,true);assert.equal(calls,0)
 assert.equal((await executor.execute(def.id,{n:1},context)).isError,true);assert.equal(calls,1)
 const c=new AbortController();c.abort()
 assert.equal((await executor.execute(def.id,{n:1},{...context,signal:c.signal})).isError,true);assert.equal(calls,1)
})
test('real Claude SDK can register the independent tool schemas without starting an agent',async()=>{
 const {registerClaudeToolSet}=await import('../bridge/providers/claude/register-tools.mjs')
 const definitions=createUiTools({emit(){}})
 const set=registerClaudeToolSet({name:'jarvis_ui',version:'1.0.0',tools:definitions})
 assert.equal(set.type,'sdk');assert.equal(set.name,'jarvis_ui')
})
