// Starts the real bridge and checks who can reach it.
//
//   node --test test/
//
// Nothing here talks to Claude: the agent session only starts once a browser
// opens the socket, and these tests never get that far.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { request } from 'node:http'
import { connect } from 'node:net'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'

const SERVER = fileURLToPath(new URL('../bridge/server.mjs', import.meta.url))

/** Start a bridge on a free port; resolves once it says where it is listening. */
function startBridge(env = {}) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, JARVIS_BRIDGE_PORT: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  let timer
  const ready = new Promise((resolve, reject) => {
    const onData = (d) => {
      log += d
      const m = /bridge listening on ws:\/\/(\S+):(\d+)/.exec(log)
      if (m) {
        clearTimeout(timer)
        resolve({ child, port: Number(m[2]), host: m[1], log: () => log })
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', (d) => (log += d))
    child.on('exit', (code) => reject(new Error(`bridge exited ${code}: ${log}`)))
    timer = setTimeout(() => {
      // Nothing else holds a reference to a bridge that never reported in.
      child.kill()
      reject(new Error(`bridge did not start: ${log}`))
    }, 15_000)
    child.once('exit', () => clearTimeout(timer))
  })
  return ready
}

function get(port, path, headers = {}, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const req = request({ host, port, path, headers, timeout: 3000 }, (res) => {
      res.resume()
      resolve(res.statusCode)
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.end()
  })
}

/** Resolves 'connected' or the error code; never rejects. */
function tryConnect(host, port) {
  return new Promise((resolve) => {
    const s = connect({ host, port, timeout: 2000 })
    s.once('connect', () => {
      s.destroy()
      resolve('connected')
    })
    s.once('timeout', () => {
      s.destroy()
      resolve('timeout')
    })
    s.once('error', (e) => resolve(e.code))
  })
}

/** Raw WebSocket handshake; resolves the HTTP status line's code. */
function wsHandshake(port, headers) {
  return new Promise((resolve) => {
    const s = connect({ host: '127.0.0.1', port, timeout: 3000 })
    // A bridge that accepts and then says nothing must fail the test, not hang it.
    s.once('timeout', () => {
      s.destroy()
      resolve('timeout')
    })
    s.once('connect', () => {
      const lines = [
        'GET / HTTP/1.1',
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
      ]
      s.write(lines.join('\r\n') + '\r\n\r\n')
    })
    s.once('data', (d) => {
      s.destroy()
      resolve(Number(/^HTTP\/1\.1 (\d+)/.exec(d.toString())?.[1]))
    })
    s.once('error', () => resolve(null))
  })
}

let bridge
before(async () => {
  bridge = await startBridge()
})
after(() => bridge?.child.kill())

test('listens on loopback by default', async () => {
  assert.equal(await get(bridge.port, '/health', { host: `127.0.0.1:${bridge.port}` }), 200)
  assert.match(bridge.log(), /listening on ws:\/\/127\.0\.0\.1:/)
})

test('is not reachable on any non-loopback interface', async () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && !i.internal && i.family === 'IPv4')
    .map((i) => i.address)
  if (!lan.length) return // nothing to probe on this machine
  for (const address of lan) {
    assert.notEqual(
      await tryConnect(address, bridge.port),
      'connected',
      `bridge accepted a connection on ${address}`,
    )
  }
})

test('a blank JARVIS_BRIDGE_HOST still means loopback', async () => {
  for (const blank of ['', '   ']) {
    const b = await startBridge({ JARVIS_BRIDGE_HOST: blank })
    try {
      assert.equal(b.host, '127.0.0.1', `JARVIS_BRIDGE_HOST=${JSON.stringify(blank)}`)
    } finally {
      b.child.kill()
    }
  }
})

test('refuses HTTP requests addressed to a foreign Host (DNS rebinding)', async () => {
  assert.equal(await get(bridge.port, '/health', { host: `attacker.example:${bridge.port}` }), 403)
  assert.equal(await get(bridge.port, '/file?path=/tmp/x.png', { host: 'attacker.example' }), 403)
  assert.equal(await get(bridge.port, '/health', { host: `localhost:${bridge.port}` }), 200)
  assert.equal(await get(bridge.port, '/health', { host: `[::1]:${bridge.port}` }), 200)
})

test('refuses a WebSocket addressed to a foreign Host even with a local Origin', async () => {
  const origin = 'http://localhost:5173'
  assert.equal(await wsHandshake(bridge.port, { Host: 'attacker.example', Origin: origin }), 403)
})

test('refuses a WebSocket with a forged-looking foreign Origin', async () => {
  assert.equal(
    await wsHandshake(bridge.port, { Host: `127.0.0.1:${bridge.port}`, Origin: 'https://attacker.example' }),
    403,
  )
})

test('an occupied port is reported plainly and exits non-zero', async () => {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, JARVIS_BRIDGE_PORT: String(bridge.port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', (d) => (log += d))
  child.stderr.on('data', (d) => (log += d))
  const code = await new Promise((resolve) => child.on('exit', resolve))
  assert.equal(code, 1)
  assert.match(log, /already in use/)
})
