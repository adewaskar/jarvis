#!/usr/bin/env node
// JARVIS preflight for the desktop multi-provider build.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const say = (tag, message) => console.log('[' + tag + '] ' + message)
const providerPath = join(homedir(), '.jarvis', 'provider.json')
let provider = 'auto'
let model = 'qwen3-vl:4b'
let configured = false
try {
  const saved = JSON.parse(readFileSync(providerPath, 'utf8'))
  provider = String(saved.provider || provider)
  model = String(saved.model || model)
  configured = true
} catch {}

console.log('')
console.log('J.A.R.V.I.S. diagnostics')
console.log('-----------------------')
const major = Number(process.versions.node.split('.')[0])
say(major >= 20 ? 'OK' : 'WARN', 'Node.js ' + process.versions.node + (major >= 20 ? '' : ' (20+ required for source development).'))
say('INFO', 'Selected provider: ' + provider + (model ? ' / ' + model : '') + (configured ? '' : ' (default; configure it from the desktop menu).'))

if (provider === 'ollama' || provider === 'auto') {
  const found = spawnSync('ollama', ['--version'], { encoding: 'utf8', timeout: 8000 })
  if (found.status === 0) {
    say('OK', 'Ollama is installed: ' + (found.stdout || found.stderr || '').trim())
    const list = spawnSync('ollama', ['list'], { encoding: 'utf8', timeout: 15000 })
    if (list.status === 0 && String(list.stdout).toLowerCase().includes(model.toLowerCase())) {
      say('OK', 'Configured model appears in ollama list: ' + model)
    } else {
      say('WARN', 'Model ' + model + ' was not found in ollama list. Run: ollama pull ' + model)
    }
  } else {
    say('WARN', 'Ollama is not installed. Use the desktop menu to install Ollama and download qwen3-vl:4b (about 3.3 GB).')
  }
} else if (provider !== 'claude') {
  say('INFO', 'Cloud provider selected. Ensure its API key, model name and account billing are valid.')
} else {
  const found = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 8000 })
  say(found.status === 0 ? 'OK' : 'WARN', found.status === 0 ? 'Claude Code CLI found.' : 'Claude provider requires Claude Code installed and signed in.')
}

const workspace = join(homedir(), 'Documents', 'JARVIS Workspace')
say(existsSync(workspace) ? 'OK' : 'INFO', 'Workspace: ' + workspace)
console.log('')
console.log('The desktop application does not require Node.js to be installed on the target PC.')
console.log('A local model uses local disk, RAM and GPU. Cloud providers may charge for API usage.')
console.log('Keep the default read-only protection enabled unless you understand the consequences of allowing file and browser actions.')
console.log('')
