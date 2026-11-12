import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentEnv, loadPrivateEnv } from '../bridge/secrets.mjs'
import { checkToolUse, fileRoots } from '../bridge/policy.mjs'

test('the agent never inherits the bridge\'s own keys', () => {
  const env = agentEnv({
    PATH: '/usr/bin',
    HOME: '/home/me',
    ELEVENLABS_API_KEY: 'sk_live_secret',
    elevenlabs_api_key: 'lower-case too',
    JARVIS_SOME_TOKEN: 'x',
    JARVIS_MODEL: 'claude-opus-5',
  })
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'JARVIS_MODEL', 'PATH'])
})

test('the private settings file is loaded, and the shell still wins', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-env-'))
  const file = join(dir, '.env')
  writeFileSync(file, 'JARVIS_TEST_FROM_FILE=file\nJARVIS_TEST_BOTH=file\n')
  process.env.JARVIS_TEST_BOTH = 'shell'
  try {
    assert.equal(loadPrivateEnv(file), file)
    assert.equal(process.env.JARVIS_TEST_FROM_FILE, 'file')
    assert.equal(process.env.JARVIS_TEST_BOTH, 'shell')
    assert.equal(loadPrivateEnv(join(dir, 'missing.env')), null)
  } finally {
    delete process.env.JARVIS_TEST_FROM_FILE
    delete process.env.JARVIS_TEST_BOTH
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the agent cannot read the key file or edit its own policy, even with home in its roots', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'jarvis-ws-'))
  const ctx = { allowWrites: true, cwd: workspace, roots: fileRoots({ workspace, extra: [homedir()] }) }
  assert.equal(checkToolUse('Read', { file_path: join(homedir(), '.jarvis', '.env') }, ctx).allow, false)
  assert.equal(checkToolUse('Write', { file_path: join(homedir(), '.jarvis', 'policy.json'), content: '{}' }, ctx).allow, false)
  assert.equal(checkToolUse('Edit', { file_path: '~/.jarvis/policy.json', old_string: 'a', new_string: 'b' }, ctx).allow, false)
  rmSync(workspace, { recursive: true, force: true })
})
