import test from 'node:test'
import assert from 'node:assert/strict'
import { createChromeTools } from '../bridge/tools/chrome.mjs'
import { createToolExecutor } from '../bridge/tools/registry.mjs'
import { createPermissionPolicy } from '../bridge/tools/permissions.mjs'
import { createClaudeChromeClient } from '../bridge/integrations/claude-chrome.mjs'
test('missing Chrome is optional and actions are omitted in read-only mode',async()=>{
 const client=createClaudeChromeClient({discover:async()=>null,connect:()=>{throw Error('must not connect')}})
 const definitions=createChromeTools({client,allowWrites:false})
 assert.equal(definitions.some(d=>d.name==='chrome_click'),false)
 const ex=createToolExecutor({definitions,policy:createPermissionPolicy()})
 const out=await ex.execute('jarvis_chrome:chrome_status',{}, {signal:new AbortController().signal})
 assert.match(out.content[0].text,/not running/)
 const out2=await ex.execute('jarvis_chrome:chrome_read_page',{}, {signal:new AbortController().signal})
 assert.equal(out2.isError,true)
})
