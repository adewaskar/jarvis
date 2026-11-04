import test from 'node:test'
import assert from 'node:assert/strict'
import { createClaudeEventMapper } from '../bridge/providers/claude/events.mjs'
import { createPermissionPolicy } from '../bridge/tools/permissions.mjs'
test('Claude mapper deduplicates tools and completion, correlating each event',()=>{
 const mapper=createClaudeEventMapper({sessionId:'s',turnId:'a',policy:createPermissionPolicy()})
 const call={type:'stream_event',event:{type:'content_block_start',content_block:{type:'tool_use',id:'t',name:'Read'}}}
 assert.equal(mapper.accept(call).length,1);assert.equal(mapper.accept(call).length,0)
 assert.deepEqual(mapper.accept({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'Hi'}}}),[{type:'text',sessionId:'s',turnId:'a',delta:'Hi'}])
 const end=mapper.accept({type:'result',subtype:'success',result:'Hi'})
 assert.equal(end[0].status,'completed');assert.equal(end[0].costUsd,null)
 assert.deepEqual(mapper.accept({type:'result',subtype:'success'}),[]);assert.deepEqual(mapper.finish(),[])
})
test('EOF and error results fail, denied tools never appear as executed',()=>{
 const mapper=createClaudeEventMapper({sessionId:'s',turnId:'a',policy:createPermissionPolicy()})
 assert.deepEqual(mapper.accept({type:'assistant',message:{content:[{type:'tool_use',id:'x',name:'Bash'}]}}),[])
 assert.equal(mapper.finish()[0].status,'failed');assert.deepEqual(mapper.finish(),[])
 assert.equal(createClaudeEventMapper({sessionId:'s',turnId:'b',policy:createPermissionPolicy()}).accept({type:'result',subtype:'error_max_turns'})[0].status,'failed')
})
