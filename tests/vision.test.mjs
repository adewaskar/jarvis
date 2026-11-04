import test from 'node:test'
import assert from 'node:assert/strict'
import { createVisionTools } from '../bridge/tools/vision.mjs'
import { createToolExecutor } from '../bridge/tools/registry.mjs'
import { createPermissionPolicy } from '../bridge/tools/permissions.mjs'
test('vision returns normalized images, refusals and unavailable errors',async()=>{
 let response={data:'abc',mimeType:'image/jpeg'};let last
 const definitions=createVisionTools({clientCapabilities:{request:async(...args)=>{last=args;return response}}})
 const ex=createToolExecutor({definitions,policy:createPermissionPolicy()});const ctx={turnId:'a',signal:new AbortController().signal}
 assert.equal((await ex.execute('jarvis_eyes:look',{},ctx)).content[1].data,'abc')
 assert.equal(last[2].turnId,'a')
 response={error:'Camera denied'};assert.equal((await ex.execute('jarvis_eyes:look',{},ctx)).isError,true)
 response={data:'grid'};assert.equal((await ex.execute('jarvis_eyes:watch',{},ctx)).content.at(-1).data,'grid')
})
