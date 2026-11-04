import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync,readFileSync } from 'node:fs'
import { join } from 'node:path'
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)])}
test('application contracts and handlers have no SDK dependencies',()=>{
 for(const name of [...files('shared'),...files('bridge/conversation'),...files('bridge/tools'),...files('bridge/transport')]){
  const source=readFileSync(name,'utf8')
  assert.doesNotMatch(source,/@anthropic-ai\/|Anthropic\./,name)
  if(name.startsWith('bridge/conversation')) assert.doesNotMatch(source,/process\.env|node:fs|readFile|homedir\(/,name)
 }
 assert.doesNotMatch(readFileSync('bridge/server.mjs','utf8'),/@anthropic-ai|case 'stream_event'|query\(/)
})
