import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { attachConversationSocket } from '../bridge/transport/ws.mjs'
import { createConversationService } from '../bridge/conversation/service.mjs'
import { createFakeProvider } from './fakes/provider.mjs'
const tick=()=>new Promise(r=>setImmediate(r))
class Socket extends EventEmitter {OPEN=1;readyState=1;sent=[];send(raw){this.sent.push(JSON.parse(raw))}close(){this.readyState=3;this.emit('close')}}
test('WebSocket adapter preserves transcript and safely handles disconnect/reconnect',async()=>{
 const app={openConversation:args=>createConversationService({provider:createFakeProvider([{type:'text',delta:'Hi'},{type:'terminal',status:'completed',text:'Hi'}]),tools:[]}).open(args)}
 const socket=new Socket()
 attachConversationSocket({socket,app,sessionId:'s',servers:['jarvis']})
 socket.emit('message',JSON.stringify({type:'ask',id:'a1',text:'Hello'}));await tick();await tick()
 assert.deepEqual(socket.sent.map(x=>x.type),['ready','text','done'])
 assert.equal(socket.sent[1].ask,'a1');assert.equal(socket.sent[2].text,'Hi')
 socket.emit('message','invalid');socket.close();await tick()
 const other=new Socket();attachConversationSocket({socket:other,app,sessionId:'other',servers:[]});await tick()
 assert.equal(other.sent[0].type,'ready');other.close()
})
test('WebSocket interruption suppresses stale effects and disconnect rejects capture',async()=>{
 let release;const gate=new Promise(r=>{release=r})
 let client
 const app={async openConversation(args){client=args.clientCapabilities;return createConversationService({provider:createFakeProvider([async input=>{if(input.turnId==='a')await gate;return {type:'ui',op:'reset',args:{}}},{type:'terminal',status:'completed'}]),tools:[]}).open(args)}}
 const socket=new Socket();attachConversationSocket({socket,app,sessionId:'s',servers:[]})
 socket.emit('message',JSON.stringify({type:'ask',id:'a',text:'A'}));await tick()
 socket.emit('message',JSON.stringify({type:'interrupt'}));release();await tick();await tick()
 socket.emit('message',JSON.stringify({type:'ask',id:'b',text:'B'}));await tick();await tick()
 assert.deepEqual(socket.sent.filter(e=>e.type==='ui').map(e=>e.ask),['b'])
 const request=client.request('capture',{}, {turnId:'b'})
 const capture=socket.sent.at(-1);socket.emit('message',JSON.stringify({type:'reply',id:capture.id,data:'frame'}))
 assert.equal((await request).data,'frame')
 const pending=client.request('capture',{},{});socket.close();await assert.rejects(pending,/disconnect/i)
})
test('real localhost WebSocket carries ready, text and done with the existing protocol',async()=>{
 const {WebSocketServer,WebSocket}=await import('ws')
 const {once}=await import('node:events')
 const server=new WebSocketServer({host:'127.0.0.1',port:0})
 await once(server,'listening')
 const app={openConversation:args=>createConversationService({provider:createFakeProvider([{type:'text',delta:'Hi'},{type:'terminal',status:'completed',text:'Hi'}]),tools:[]}).open(args)}
 server.on('connection',socket=>attachConversationSocket({socket,app,sessionId:'local',servers:[]}))
 const client=new WebSocket(`ws://127.0.0.1:${server.address().port}`)
 try {
  const result=new Promise((resolve,reject)=>{
   client.on('error',reject)
   client.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='ready')client.send(JSON.stringify({type:'ask',id:'a1',text:'Hi'}));if(m.type==='done')resolve(m)})
  })
  const done=await result;assert.equal(done.ask,'a1');assert.equal(done.text,'Hi')
 } finally {client.close();await once(client,'close');await new Promise(resolve=>server.close(resolve))}
})
