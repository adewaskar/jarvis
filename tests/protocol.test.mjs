import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { turn, session } from './fixtures/protocol.mjs'
test('legacy transcript keeps correlation and text/tool/terminal ordering', () => {
  assert.deepEqual(turn.map(x => x.type), ['text', 'tool', 'done'])
  assert.ok(turn.every(x => x.ask === 'a1'))
  assert.equal(turn[0].delta, turn[2].text)
  const consumer = readFileSync(new URL('../src/lib/bridge.ts', import.meta.url), 'utf8')
  for (const frame of [...turn, ...session].filter(x => !['reply','interrupt'].includes(x.type))) {
    assert.ok(consumer.includes(`'${frame.type}'`), `consumer supports ${frame.type}`)
  }
  assert.equal(session[4].id, session[5].id)
})
