import test from 'node:test'
import assert from 'node:assert/strict'
import { toAnthropicMessages } from '../src/lib/providers/anthropic-messages.ts'
import { JARVIS_PERSONA } from '../shared/persona.mjs'
test('direct adapter translates independent multimodal history without mutation',()=>{
 const history=[{role:'user' as const,content:[{type:'text' as const,text:'Look'},{type:'image' as const,mimeType:'image/jpeg',data:'abc'}]}]
 const snapshot=structuredClone(history)
 const translated=toAnthropicMessages(history)
 assert.deepEqual(translated[0].content,[{type:'text',text:'Look'},{type:'image',source:{type:'base64',media_type:'image/jpeg',data:'abc'}}])
 assert.deepEqual(history,snapshot)
 assert.match(JARVIS_PERSONA,/JARVIS/)
})
