import test from 'node:test'
import assert from 'node:assert/strict'
import { readClaudeSource } from '../bridge/config/claude-source.mjs'
import { resolveVoiceCredentials } from '../bridge/config/voice.mjs'
import { loadBridgeConfig } from '../bridge/config/load.mjs'
test('configuration sources isolate personal files and preserve precedence', () => {
 const source = readClaudeSource({ home:'/fake', readFile:()=>JSON.stringify({mcpServers:{x:{command:'a'},elevenlabs:{env:{ELEVENLABS_API_KEY:'legacy'}}},projects:{'/fake':{mcpServers:{x:{command:'b'}}}}}) })
 assert.equal(source.servers.x.command,'b')
 assert.equal(resolveVoiceCredentials({env:{ELEVENLABS_API_KEY:'env'},legacySource:source}),'env')
 assert.equal(resolveVoiceCredentials({env:{},legacySource:source}),'legacy')
 assert.deepEqual(readClaudeSource({home:'/fake',readFile:()=>{throw Error()}}).servers,{})
 assert.deepEqual(readClaudeSource({home:'/fake',readFile:()=>'{'}).servers,{})
 assert.equal(loadBridgeConfig({}).effort,'high')
 assert.equal(loadBridgeConfig({}).provider,'claude')
})
