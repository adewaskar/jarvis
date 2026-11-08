// The bridge hands MCP servers from ~/.claude.json to the agent. These start it
// against a throwaway home directory and read which ones it says it passed on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER = fileURLToPath(new URL('../bridge/server.mjs', import.meta.url))

function bannerWith(overrides) {
  const home = mkdtempSync(join(tmpdir(), 'jarvis-home-'))
  writeFileSync(
    join(home, '.claude.json'),
    JSON.stringify({
      mcpServers: {
        search: { command: 'true' },
        mailer: { command: 'true' },
      },
    }),
  )
  const env = { ...process.env, HOME: home, USERPROFILE: home, JARVIS_BRIDGE_PORT: '0' }
  delete env.JARVIS_MCP_SERVERS
  delete env.JARVIS_ACCOUNT_CONNECTORS
  Object.assign(env, overrides)
  const child = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    let log = ''
    const onData = (d) => {
      log += d
      const line = /MCP servers from config: .*/.exec(log)
      if (line) {
        child.kill()
        resolve(line[0])
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', (d) => (log += d))
    child.on('exit', () => reject(new Error(log)))
    setTimeout(() => {
      child.kill()
      reject(new Error(`no banner: ${log}`))
    }, 15_000)
  })
}

test('unset passes every configured server, as before', async () => {
  assert.match(await bannerWith({}), /config: search, mailer ·/)
})

test('JARVIS_MCP_SERVERS passes only the named servers', async () => {
  const line = await bannerWith({ JARVIS_MCP_SERVERS: 'search' })
  assert.match(line, /config: search ·/)
  assert.doesNotMatch(line, /mailer/)
})

test('an empty JARVIS_MCP_SERVERS passes none', async () => {
  assert.match(await bannerWith({ JARVIS_MCP_SERVERS: '' }), /config: none/)
})

test('account connectors are off unless asked for', async () => {
  assert.match(await bannerWith({}), /account connectors off/)
  assert.match(await bannerWith({ JARVIS_ACCOUNT_CONNECTORS: '1' }), /account connectors ON/)
})
