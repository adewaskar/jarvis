import test from 'node:test'
import assert from 'node:assert/strict'
import { createUiTools } from '../bridge/tools/ui.mjs'
import { createToolExecutor } from '../bridge/tools/registry.mjs'
import { createPermissionPolicy } from '../bridge/tools/permissions.mjs'
test('UI tool extraction preserves coercion, clamps and reset output',async()=>{
 const events=[];const defs=createUiTools({emit:(...e)=>events.push(e)})
 const executor=createToolExecutor({definitions:defs,policy:createPermissionPolicy()})
 const ctx={signal:new AbortController().signal}
 await executor.execute('jarvis_ui:ui_reactor',{scale:'999',visible:'false'},ctx)
 assert.equal(events[0][0],'patch');assert.equal(events[0][1].reactor.visible,false);assert.ok(events[0][1].reactor.scale<999)
 await executor.execute('jarvis_ui:ui_theme',{accent:'auto'},ctx)
 assert.equal(events[1][1].accent,null)
 await executor.execute('jarvis_ui:ui_effect',{kind:'invalid'},ctx)
 assert.deepEqual(events[2],['effect',{kind:'pulse'}])
})
