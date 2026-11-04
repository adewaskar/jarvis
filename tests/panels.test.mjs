import test from 'node:test'
import assert from 'node:assert/strict'
import { createPanelTools } from '../bridge/tools/panels.mjs'
import { createToolExecutor } from '../bridge/tools/registry.mjs'
import { createPermissionPolicy } from '../bridge/tools/permissions.mjs'
test('panels and blades emit without an agent SDK',async()=>{
 const events=[];const definitions=createPanelTools({emit:e=>events.push(e),emitBlade:e=>events.push(e),pages:{probeUrl:async()=>({ok:true}),renderPage:async()=>({html:'<p>Page</p>'})}})
 const ex=createToolExecutor({definitions,policy:createPermissionPolicy()});const ctx={signal:new AbortController().signal}
 const panel=await ex.execute('jarvis:display',{html:'<p>Hello</p>',title:'Hello'},ctx)
 assert.equal(panel.isError,undefined);assert.equal(events.length,1)
 const probe=await ex.execute('jarvis:probe_url',{url:'https://example.com'},ctx)
 assert.match(probe.content[0].text,/true/)
 assert.equal((await ex.execute('jarvis:display',{html:''},ctx)).isError,true)
})
