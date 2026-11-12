import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_POLICY_FILE,
  builtinTools,
  checkToolUse,
  compilePolicy,
  decideTool,
  fetchTargetProblem,
  fileRoots,
  isNetworkPath,
  loadPolicy,
  tierOf,
} from '../bridge/policy.mjs'

const workspace = mkdtempSync(join(tmpdir(), 'jarvis-ws-'))
const roots = fileRoots({ workspace })
const ctx = (allowWrites = false) => ({ allowWrites, cwd: workspace, roots })
const allowed = (name, input, w) => checkToolUse(name, input, ctx(w)).allow

test('decideTool keeps its existing verdicts', () => {
  assert.equal(decideTool('Read'), true)
  assert.equal(decideTool('Bash'), false)
  assert.equal(decideTool('Bash', true), true)
  assert.equal(decideTool('mcp__jarvis__display'), true)
  assert.equal(decideTool('mcp__higgsfield__generate_image'), true)
  assert.equal(decideTool('mcp__elevenlabs__make_outbound_call'), false)
  assert.equal(decideTool('SomeFutureBuiltin'), false)
})

test('the policy is a list, not a guess from verbs in tool names', () => {
  // Each of these ran under the old verb rules.
  assert.equal(tierOf('mcp__someserver__list_devices'), 'deny') // read verb, unknown server
  assert.equal(tierOf('mcp__files__search_and_replace'), 'deny') // read verb, writes
  assert.equal(tierOf('mcp__elevenlabs__voice_clone'), 'deny') // allowlisted server, no veto verb
  assert.equal(tierOf('mcp__ccd_session__start_session'), 'deny') // the old dev-environment exemption
  assert.equal(decideTool('mcp__someserver__install_apk', true), false) // writes on changes nothing
})

test('acting tools need an on-screen approval rather than a global switch', () => {
  assert.equal(tierOf('Bash'), 'confirm')
  assert.equal(tierOf('mcp__jarvis_chrome__chrome_click'), 'confirm')
  assert.equal(tierOf('mcp__jarvis_chrome__chrome_page_text'), 'allow')
  assert.equal(checkToolUse('Bash', { command: 'ls' }, ctx(true)).verdict, 'confirm')
  assert.equal(checkToolUse('Bash', { command: 'ls' }, ctx(false)).verdict, 'deny')
})

test('policy patterns and precedence', () => {
  const p = compilePolicy({ allow: ['mcp__a__*'], confirm: ['mcp__a__send*'], deny: ['mcp__a__send_all'] })
  assert.equal(tierOf('mcp__a__get', p), 'allow')
  assert.equal(tierOf('mcp__a__send_one', p), 'confirm')
  assert.equal(tierOf('mcp__a__send_all', p), 'deny')
  assert.equal(tierOf('mcp__ab__get', p), 'deny') // * does not widen the server name
  assert.equal(tierOf('mcp__a.b__get', compilePolicy({ allow: ['mcp__a.b__*'] })), 'allow') // . is literal
  assert.equal(tierOf('mcp__aXb__get', compilePolicy({ allow: ['mcp__a.b__*'] })), 'deny')
  // * stays inside one part of the name: it never crosses a __.
  assert.equal(tierOf('mcp__a__x__y', p), 'deny')
  assert.equal(tierOf('mcp__a__b__get', compilePolicy({ allow: ['mcp__*__get'] })), 'deny')
  assert.equal(tierOf('mcp__a__get_one', compilePolicy({ allow: ['mcp__*__get_one'] })), 'allow')
})

test('the default policy does not guess from verbs either', () => {
  assert.equal(tierOf('mcp__higgsfield__generate_image'), 'allow')
  assert.equal(tierOf('mcp__higgsfield__get_or_delete_job'), 'deny')
  assert.equal(tierOf('mcp__elevenlabs__search_and_replace_voice'), 'deny')
  assert.equal(tierOf('mcp__exa__x__y'), 'deny')
  // Reaches resources on servers whose tools are not listed at all.
  assert.equal(tierOf('ReadMcpResourceTool'), 'deny')
})

test('a network path is refused before anything touches the filesystem', () => {
  // Resolving one makes Windows look the host up and try to connect to it.
  const unc = String.raw`\\one-time-code-482193.evil.example\s\a`
  assert.equal(isNetworkPath(unc), true)
  assert.equal(isNetworkPath('//evil.example/share/a'), true)
  assert.equal(isNetworkPath(String.raw`C:\Users\x\a.txt`), false)
  assert.equal(isNetworkPath('/tmp/a.txt'), false)
  const started = Date.now()
  for (const tool of ['Read', 'Grep', 'Glob']) {
    const field = tool === 'Read' ? 'file_path' : 'path'
    assert.match(checkToolUse(tool, { [field]: unc, pattern: 'x' }, ctx()).reason, /network path/)
  }
  assert.match(checkToolUse('Glob', { pattern: unc + String.raw`\*` }, ctx()).reason, /network path/)
  assert.ok(Date.now() - started < 1000, 'no lookup should have been attempted')
})

test('a Glob pattern is judged as a path too', () => {
  assert.equal(allowed('Glob', { pattern: '**/*.png' }), true)
  assert.equal(allowed('Glob', { pattern: join(workspace, '**', '*.png') }), true)
  assert.equal(allowed('Glob', { pattern: join(homedir(), '.ssh', '*') }), false)
  assert.equal(allowed('Glob', { pattern: '/etc/**' }), false)
  assert.equal(allowed('Glob', { pattern: '~/.claude/**' }), false)
})

test('the browser is only ever sent to web addresses', () => {
  const nav = (url) => checkToolUse('mcp__jarvis_chrome__chrome_navigate', { url }, ctx()).allow
  for (const url of ['https://example.com/', 'http://example.com/', 'example.com/x', 'localhost:3000/x', 'back', 'forward', 'about:blank']) {
    assert.equal(nav(url), true, url)
  }
  for (const url of [
    'data:text/html;base64,PHNjcmlwdD4=',
    "javascript:fetch('https://evil.example/')",
    'file:///C:/Users/x/.ssh/id_rsa',
    'chrome://settings',
    'JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
  ]) {
    assert.equal(nav(url), false, url)
  }
})

test('a user policy file replaces the default, and a broken one is an error', () => {
  const home = mkdtempSync(join(tmpdir(), 'jarvis-home-'))
  try {
    assert.equal(loadPolicy({ home }).path, DEFAULT_POLICY_FILE)
    mkdirSync(join(home, '.jarvis'))
    writeFileSync(join(home, '.jarvis', 'policy.json'), JSON.stringify({ allow: ['Read'] }))
    const mine = loadPolicy({ home })
    assert.equal(tierOf('Read', mine), 'allow')
    assert.equal(tierOf('WebSearch', mine), 'deny')
    writeFileSync(join(home, '.jarvis', 'policy.json'), '{ not json')
    assert.throws(() => loadPolicy({ home }), /could not read the tool policy/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('read-only mode refuses a shell command the CLI would auto-approve', () => {
  // `cat` is what the CLI's own classifier runs without asking canUseTool.
  assert.equal(allowed('Bash', { command: 'cat ~/.ssh/id_rsa' }), false)
  assert.equal(allowed('Bash', { command: 'ls' }), false)
  assert.equal(allowed('Bash', { command: 'ls' }, true), true)
})

test('file tools are confined to the workspace and temp roots', () => {
  writeFileSync(join(workspace, 'note.txt'), 'hi')
  assert.equal(allowed('Read', { file_path: join(workspace, 'note.txt') }), true)
  assert.equal(allowed('Read', { file_path: 'note.txt' }), true) // relative to cwd
  assert.equal(allowed('Read', { file_path: join(tmpdir(), 'shot.png') }), true)
  assert.equal(allowed('Read', { file_path: join(homedir(), '.bashrc') }), false)
  assert.equal(allowed('Read', { file_path: '~/.claude/.credentials.json' }), false)
  assert.equal(allowed('Read', { file_path: '/etc/passwd' }), false)
  assert.equal(allowed('Read', { file_path: join(workspace, '..', '..', 'etc', 'passwd') }), false)
  assert.equal(allowed('Grep', { pattern: 'x', path: '/home' }), false)
  assert.equal(allowed('Glob', { pattern: '**/*' }), true) // no path = cwd
})

test('a symlink inside the workspace cannot point the read elsewhere', () => {
  const link = join(workspace, 'innocent.png')
  try {
    symlinkSync('/etc/hosts', link)
  } catch {
    return // no symlinks on this filesystem
  }
  assert.equal(allowed('Read', { file_path: link }), false)
})

test('a dangling symlink is judged by where it points, not where it sits', () => {
  const outside = mkdtempSync(join(homedir(), '.jarvis-test-outside-'))
  const link = join(workspace, 'dangling.txt')
  try {
    symlinkSync(join(outside, 'would-be-created.txt'), link)
  } catch {
    return // no symlinks on this filesystem
  }
  try {
    assert.equal(allowed('Write', { file_path: link }, true), false)
    assert.equal(allowed('Read', { file_path: link }), false)
    const loop = join(workspace, 'loop')
    symlinkSync(loop, loop)
    assert.equal(allowed('Read', { file_path: loop }), false)
  } finally {
    rmSync(outside, { recursive: true, force: true })
  }
})

test('credentials stay refused even when the roots include home', () => {
  const wide = { allowWrites: false, cwd: workspace, roots: fileRoots({ workspace, extra: [homedir()] }) }
  const ok = (p) => checkToolUse('Read', { file_path: p }, wide).allow
  assert.equal(ok(join(homedir(), 'Pictures', 'cat.png')), true)
  assert.equal(ok(join(homedir(), '.ssh', 'id_ed25519')), false)
  assert.equal(ok(join(homedir(), '.claude', '.credentials.json')), false)
  assert.equal(ok(join(homedir(), '.claude.json')), false)
  // Case-insensitive volumes (macOS, Windows): ~/.SSH is ~/.ssh.
  assert.equal(ok(join(homedir(), '.SSH', 'config')), false)
  assert.equal(ok(join(homedir(), '.Aws', 'credentials')), false)
  assert.equal(ok(join(homedir(), 'project', '.env')), false)
  assert.equal(ok(join(homedir(), 'project', '.env.local')), false)
  assert.equal(ok(join(homedir(), 'certs', 'server.pem')), false)
})

test('writes are confined too, when writes are on', () => {
  mkdirSync(join(workspace, 'out'), { recursive: true })
  assert.equal(allowed('Write', { file_path: join(workspace, 'out', 'a.txt') }, true), true)
  assert.equal(allowed('Write', { file_path: join(homedir(), 'a.txt') }, true), false)
  assert.equal(allowed('Edit', { file_path: '/etc/hosts' }, true), false)
  assert.equal(allowed('Write', { file_path: join(workspace, 'a.txt') }, false), false)
})

test('WebFetch cannot be pointed at the LAN, loopback or cloud metadata', () => {
  assert.equal(allowed('WebFetch', { url: 'https://example.com/a' }), true)
  assert.equal(allowed('WebFetch', { url: 'http://127.0.0.1:8787/file?path=/x.png' }), false)
  assert.equal(allowed('WebFetch', { url: 'http://169.254.169.254/latest/meta-data/' }), false)
  assert.equal(allowed('WebFetch', { url: 'http://192.168.1.1/' }), false)
  assert.equal(allowed('WebFetch', { url: 'http://printer.local/' }), false)
  assert.equal(allowed('WebFetch', { url: 'file:///etc/passwd' }), false)
})

test('WebFetch names that resolve to private addresses are caught', async () => {
  const to = (address) => async () => [{ address, family: address.includes(':') ? 6 : 4 }]
  assert.match(await fetchTargetProblem('https://rebind.example/', to('127.0.0.1')), /private address/)
  assert.match(await fetchTargetProblem('https://rebind.example/', to('::1')), /private address/)
  assert.match(await fetchTargetProblem('https://intranet.example/', to('10.1.2.3')), /private address/)
  assert.equal(await fetchTargetProblem('https://example.com/', to('93.184.215.14')), null)
  assert.match(await fetchTargetProblem('http://127.0.0.1/'), /blocked host/)
})

test('only the built-ins JARVIS uses are offered', () => {
  const ro = builtinTools(false)
  assert.deepEqual(ro.filter((t) => ['Bash', 'Write', 'Edit'].includes(t)), [])
  for (const absent of ['Agent', 'Task', 'CronCreate', 'RemoteTrigger', 'SendMessage', 'AskUserQuestion', 'Skill']) {
    assert.ok(!ro.includes(absent), `${absent} should not be offered`)
    assert.ok(!builtinTools(true).includes(absent), `${absent} should not be offered with writes`)
  }
  assert.ok(builtinTools(true).includes('Bash'))
})
