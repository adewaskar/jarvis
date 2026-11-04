import test from 'node:test'
import assert from 'node:assert/strict'
import { createPermissionPolicy } from '../bridge/tools/permissions.mjs'
import { describeClaudeTool } from '../bridge/providers/claude/tools.mjs'
test('legacy permission matrix preserves read/write and explicit exceptions', () => {
 const policy=createPermissionPolicy({allowWrites:false})
 for(const name of ['Read','WebSearch','mcp__exa__search','mcp__higgsfield__generate_image','mcp__jarvis__display','mcp__openrouter__send-message']) assert.equal(policy.decide(describeClaudeTool(name)).allowed,true,name)
 for(const name of ['Bash','Write','unknown','mcp__exa__delete_all','mcp__other__new_action']) assert.equal(policy.decide(describeClaudeTool(name)).allowed,false,name)
 assert.equal(createPermissionPolicy({allowWrites:true}).decide(describeClaudeTool('Bash')).allowed,true)
 assert.equal(policy.decide({id:'x',namespace:'external',name:'mystery',effect:'unknown'}).allowed,false)
})
