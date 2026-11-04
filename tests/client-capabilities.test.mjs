import test from 'node:test'
import assert from 'node:assert/strict'
import { createClientCapabilities } from '../bridge/transport/client-capabilities.mjs'
test('client requests correlate out of order, abort and disconnect clean pending requests', async () => {
 const sent=[];const timers=new Map();let seq=0
 const clock={setTimeout(fn){timers.set(++seq,fn);return seq},clearTimeout(id){timers.delete(id)}}
 const client=createClientCapabilities({send:x=>sent.push(x),available:{capture:true},clock})
 const controller=new AbortController();const ctx={sessionId:'s',turnId:'a',signal:controller.signal}
 const a=client.request('capture',{},ctx);const b=client.request('capture',{},ctx)
 client.receive({id:sent[1].id,data:'B'}); client.receive({id:'unknown'});client.receive({id:sent[0].id,data:'A'})
 assert.equal((await a).data,'A');assert.equal((await b).data,'B');assert.equal(timers.size,0)
 const c=client.request('capture',{},ctx);controller.abort();await assert.rejects(c,/abort/i)
 const d=client.request('capture',{}, {...ctx,signal:new AbortController().signal});client.close();await assert.rejects(d,/disconnect/i)
 assert.equal(timers.size,0)
})
test('client reports unsupported and timeout rather than success', async()=>{
 let expire
 const client=createClientCapabilities({send(){},available:{capture:true},clock:{setTimeout(fn){expire=fn;return 1},clearTimeout(){}}})
 await assert.rejects(client.request('other',{},{}),/unavailable/)
 const p=client.request('capture',{},{});expire();await assert.rejects(p,/time/)
})
