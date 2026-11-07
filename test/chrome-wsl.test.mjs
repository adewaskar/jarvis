// The WSL transport to the Claude-for-Chrome native host.
//
// Runs only under WSL, against a fake native host: a PowerShell named-pipe
// server that answers one framed request. Never touches a real browser.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const onWsl =
  process.platform === 'linux' &&
  (Boolean(process.env.WSL_DISTRO_NAME) || existsSync('/proc/sys/fs/binfmt_misc/WSLInterop'))

const PIPE = `jarvis-test-${randomBytes(4).toString('hex')}`
process.env.JARVIS_CHROME_PIPE = PIPE

/** A one-shot fake native host. Resolves once the pipe exists. */
function fakeHost(replyText) {
  const reply = JSON.stringify({ result: { content: [{ type: 'text', text: replyText }] } })
  const ps = `$s = New-Object System.IO.Pipes.NamedPipeServerStream('${PIPE}', 'InOut', 1, 'Byte', 'Asynchronous')
[Console]::Out.WriteLine('listening'); [Console]::Out.Flush()
$s.WaitForConnection()
$h = New-Object byte[] 4; $n = 0; while ($n -lt 4) { $n += $s.Read($h, $n, 4 - $n) }
$len = [BitConverter]::ToInt32($h, 0); $b = New-Object byte[] $len; $n = 0
while ($n -lt $len) { $n += $s.Read($b, $n, $len - $n) }
$req = [Text.Encoding]::UTF8.GetString($b)
[Console]::Out.WriteLine('got ' + $req); [Console]::Out.Flush()
$r = [Text.Encoding]::UTF8.GetBytes('${reply.replace(/'/g, "''")}')
$s.Write([BitConverter]::GetBytes($r.Length), 0, 4); $s.Write($r, 0, $r.Length); $s.Flush()
Start-Sleep -Milliseconds 300; $s.Dispose()`
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  let out = ''
  const listening = new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => {
      out += d
      if (out.includes('listening')) resolve()
    })
    child.on('error', reject)
  })
  return { child, listening, seen: () => out }
}

test('WSL: finds the native host pipe and relays a call through it', { skip: !onWsl }, async () => {
  const { chromeAvailable, callBrowser } = await import('../bridge/chrome.mjs')
  assert.equal(await chromeAvailable(), false, 'no pipe yet')

  const host = fakeHost('fake-ok')
  await host.listening
  assert.equal(await chromeAvailable(), true)

  const reply = await callBrowser('tabs_context_mcp', { createIfEmpty: false })
  assert.equal(reply.result.content[0].text, 'fake-ok')
  assert.match(host.seen(), /"method":"execute_tool"/)
  assert.match(host.seen(), /"tool":"tabs_context_mcp"/)

  await new Promise((resolve) => host.child.on('exit', resolve))
  // The host is gone; a call fails with a sentence, not a hang.
  await assert.rejects(callBrowser('tabs_context_mcp', {}), /not running|relay|closed|disconnected/i)
})
