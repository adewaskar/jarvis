#!/usr/bin/env node
// JARVIS preflight — a friendly, advisory check you run with `npm run setup`.
//
// It changes nothing and installs nothing. It looks at your machine, tells you
// what is ready and what is missing, and prints the two commands that start
// JARVIS. Every check degrades to a single friendly line if something is not
// there, and the script always exits 0 — it is advice, not a gate.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { NODE_RANGE, loginState, nodeVersionOk } from './checks.mjs';

const tick = '  ok  ';
const warn = ' note ';
const info = '  ·   ';

function line(tag, msg) {
  console.log(`[${tag}] ${msg}`);
}

console.log('');
console.log('JARVIS preflight — checking your machine (nothing is changed)');
console.log('------------------------------------------------------------');

// --- Node version --------------------------------------------------------
// Not just the major version: Vite needs 20.19+ or 22.12+, and an older 20.x
// or 22.x installs fine and then fails at `npm start`.
if (nodeVersionOk(process.versions.node)) {
  line(tick, `Node.js ${process.versions.node} (needs ${NODE_RANGE}).`);
} else {
  line(warn, `Node.js ${process.versions.node} is too old or unsupported — JARVIS needs ${NODE_RANGE}.`);
  line(info, 'Install the current LTS from https://nodejs.org, then run `npm ci` again.');
}

// --- Claude CLI on PATH ---------------------------------------------------
let claudeFound = false;
try {
  const res = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 10000 });
  if (res.status === 0 && res.stdout) {
    claudeFound = true;
    line(tick, `Claude CLI found: ${res.stdout.trim()}`);
  }
} catch {
  // ignore — handled below
}
if (!claudeFound) {
  line(warn, 'Claude CLI not found on your PATH.');
  line(info, 'Install it: npm install -g @anthropic-ai/claude-code');
  line(info, '  (or the platform installer at https://docs.claude.com/en/docs/claude-code)');
  line(info, 'Then run `claude` once and complete login. The bridge uses that login — no API key needed.');
}

// --- Claude login ----------------------------------------------------------
// Without a login the bridge starts and the page loads, but JARVIS never
// answers. `claude auth status` reads local state only; it costs nothing.
if (claudeFound) {
  let state = 'unknown';
  try {
    const res = spawnSync('claude', ['auth', 'status'], { encoding: 'utf8', timeout: 10000 });
    state = loginState(res.stdout);
  } catch {
    // leave it unknown
  }
  if (state === 'yes') {
    line(tick, 'Claude Code is logged in.');
  } else if (state === 'no') {
    line(warn, 'Claude Code is not logged in. JARVIS will load but never answer.');
    line(info, 'Run `claude auth login` (or just `claude`) and complete login, then run this check again.');
  } else {
    line(info, 'Could not confirm the Claude Code login. If JARVIS never answers, run `claude` and check you are logged in.');
  }
}

// --- ~/.claude.json and MCP servers --------------------------------------
const claudeJsonPath = join(homedir(), '.claude.json');
let mcpCount = 0;
try {
  const raw = readFileSync(claudeJsonPath, 'utf8');
  let parsed = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  const servers = parsed && typeof parsed.mcpServers === 'object' && parsed.mcpServers ? parsed.mcpServers : {};
  mcpCount = Object.keys(servers).length;
  if (mcpCount > 0) {
    line(tick, `~/.claude.json found with ${mcpCount} MCP server${mcpCount === 1 ? '' : 's'} configured.`);
  } else {
    line(info, '~/.claude.json found, but no MCP servers are configured yet. JARVIS still answers and drives its own interface.');
  }
} catch {
  line(info, '~/.claude.json not found yet. It appears once you run `claude` and log in. JARVIS works without any MCP servers.');
}

// --- ElevenLabs key (env or the elevenlabs MCP entry) --------------------
function findElevenLabsKey() {
  if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY.trim()) {
    return 'environment (ELEVENLABS_API_KEY)';
  }
  try {
    const raw = readFileSync(claudeJsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    const servers = parsed && parsed.mcpServers ? parsed.mcpServers : {};
    const el = servers.elevenlabs;
    const env = el && el.env ? el.env : {};
    if (env.ELEVENLABS_API_KEY && String(env.ELEVENLABS_API_KEY).trim()) {
      return 'the elevenlabs MCP server in ~/.claude.json';
    }
  } catch {
    // ignore — no key discoverable
  }
  return null;
}

const elSource = findElevenLabsKey();
if (elSource) {
  line(tick, `Premium voice available — ElevenLabs key found via ${elSource}.`);
} else {
  line(info, 'No ElevenLabs key found — JARVIS will use browser speech (that is completely fine).');
  line(info, '  Optional: add ELEVENLABS_API_KEY for a better voice and Scribe transcription. The free tier is enough for a demo.');
}

// --- How to run ----------------------------------------------------------
console.log('');
console.log('To run JARVIS, open two terminals:');
console.log('  1)  npm run bridge      # the brain (Claude Code, headless)');
console.log('  2)  npm run dev         # the face (open http://localhost:5173 in Chrome)');
console.log('');
console.log('Then click INITIALISE and say "Hey Jarvis".');
console.log('To let JARVIS take real actions (phone, browser, sending), run `npm run bridge:writes` instead of `npm run bridge`.');
console.log('');

process.exit(0);
