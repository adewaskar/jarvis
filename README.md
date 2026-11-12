# J.A.R.V.I.S.

A browser voice assistant with an Iron Man holographic interface. Say
**"Hey Jarvis"**, he wakes, listens, and does real things through your tools —
searches the web, generates images, drives your phone, reads your mail. The face
is a web page (React + Vite + Three.js + custom GLSL). The brain is Claude Code,
run headless as a library.

**For the default backend, the only subscription you need is Claude Code.** No API keys, no OpenAI
account, no cloud bill — the brain runs on your existing Claude Code login, and
the heavy work (the model itself) runs on Anthropic's servers, so even a low-end
laptop only has to draw the interface. **ElevenLabs is an optional add-on** that
gives JARVIS a much better voice and sharper hearing; without it he speaks and
listens through the browser's own speech, and everything still works.

---

## Requirements

**In one line:** a Claude Code subscription, plus two free things every computer
can have — Node.js and Chrome. That's the whole list.

- **Claude Code, installed and logged in** — this is the only account you need.
  Install it with the official method — `npm install -g @anthropic-ai/claude-code`,
  or the platform installer at <https://docs.claude.com/en/docs/claude-code> —
  then run `claude` once and complete login. The bridge reuses that login. **No
  API key**, and usage is billed to your existing Claude account.
- **Node.js 20 or newer** — free, one installer from <https://nodejs.org>. This
  is a Node web app, so it is the one unavoidable tool.
- **Google Chrome or Microsoft Edge**, in a **real browser window** — not an
  embedded preview pane. Preview panes (including the one inside editors and
  Claude Code) block microphone access, so the page loads and looks right but
  never hears you. JARVIS also needs WebGL, which these browsers provide.
- **Optional: an ElevenLabs API key** — a good add-on, not a requirement. It
  gives a better voice and sharper transcription; the free tier is plenty for a
  demo. Without it, everything runs on the browser's own speech.

Run `npm run setup` after cloning and it checks all of this for you, in plain
language.

---

## Quick start

First, install, then start it:

```bash
npm install
npm start          # runs the brain and the face together
```

Then open the URL it prints (http://localhost:5173) in **Chrome**, click **INITIALISE**, and say **“Hey Jarvis”**.

Prefer two terminals? Run them separately instead:

```bash
npm install
```

Terminal 1 — the brain:

```bash
npm run bridge
```

Terminal 2 — the face:

```bash
npm run dev
```

Then open the app in a **real Chrome or Edge window**:

```bash
open http://localhost:5173
```

Click **INITIALISE**, allow the microphone when asked, and say **"Hey Jarvis"**.

> It has to be a real browser window. Embedded preview panes block the
> microphone, so JARVIS will look perfectly alive and simply never respond.

### Local Multica voice pilot

The optional Multica backend sends each English transcript to one preselected
Multica issue and reads the assigned agent's correlated final comment aloud.
It is an asynchronous agent-task pilot, not a low-latency chat API: a turn can
spend substantial time queued or running. Turns are sequential and
push-to-talk; in this mode the wake word is disabled and the HUD asks you to
hold Space for each turn.

Use a normal local Multica user profile. Create a dedicated pilot issue in
advance, assign it to the one agent you want to hear from, and record its issue,
workspace and agent UUIDs. Do not use an intake/build issue, the Orchestrator by
default, or credentials injected into a managed agent task. The bridge never
creates an issue or changes its assignment.

Set server variables in the shell that starts the bridge:

```bash
export JARVIS_BACKEND=multica
export JARVIS_MULTICA_PROFILE=your-local-profile
export JARVIS_MULTICA_ISSUE_ID=your-dedicated-pilot-issue-uuid
export JARVIS_MULTICA_WORKSPACE_ID=the-expected-workspace-uuid
export JARVIS_MULTICA_AGENT_ID=the-selected-agent-uuid
export JARVIS_MULTICA_CLI=/absolute/path/to/multica
export JARVIS_MULTICA_TIMEOUT_MS=180000
npm run bridge
```

Set only the non-secret browser choice in `.env.local`, then start Vite:

```text
VITE_BACKEND=multica
VITE_BRIDGE_IDLE_TIMEOUT_MS=210000
```

The bridge validates the issue's workspace and assignee before listening. It
runs the fixed CLI executable with argument arrays and `--profile`; transcripts
never enter shell code, and profile credentials never enter Vite or the
browser. The default 180-second server timeout is a safety bound, not an SLA.

The adapter keeps a private, dependency-free JSON outbox under
`~/.jarvis/multica` (override with `JARVIS_MULTICA_STATE_DIR`). Writes are
atomic and user-only. A transcript exists in a private body file only until
submission is resolved; C/T/R ids, the previous response id, cancellation and
playback acknowledgement remain for deduplication. If submission fails
ambiguously, the adapter searches for its embedded UUID marker. It never sends
the comment again unless it can prove the first send did not happen. An
unresolved send blocks later turns for manual inspection. After a bridge crash,
registered responses are not replayed; an unfinished submitted task is also
left blocked rather than guessed at. This is best-effort single-process
deduplication, not exactly-once delivery.

#### Text-only live pilot before audio

Run this only when the dedicated profile and pilot target above are available.
Do not substitute a managed task credential or this repository's build issue.

1. Start the bridge and confirm its read-only startup validation succeeds.
2. Send a short text turn through the WebSocket/UI and record timestamps for
   transcript end, comment `C1`, task `T1`, response `R1`, task completion and
   first output. Record ids/status/timing only—never transcript or response
   text, audio, credentials, or raw CLI output.
3. Verify `T1.trigger_comment_id=C1`, `R1.source_task_id=T1`, and exactly one
   final response was presented.
4. Send turn 2 and verify its comment uses `--parent R1`, while its independent
   `C2/T2/R2` correlation remains exact.
5. Continue through 10 sequential turns. For every turn, verify no second turn
   is accepted while one is active, no stale comment is presented, and no
   response is presented twice.
6. Calculate observed queue, response, completion and end-to-first-output
   latency from those content-free timestamps. Report raw observations; do not
   describe them as an SLA or as proof of conversational latency.
7. Exercise one interrupt and one timeout. Confirm only the current known task
   receives at most one cancellation and any later response is suppressed.
8. Only after all 10 text turns pass, open Chrome/Edge, click INITIALISE, hold
   Space, speak English, and confirm the same final response is spoken once by
   the browser voice without a Claude session or ElevenLabs key.

If microphone, audio device or real-browser access is unavailable, stop after
the text fixture/live checks and record the browser smoke as outstanding rather
than inferring a result.

---

## How it works

JARVIS is two processes. The browser is the face and the voice; the bridge is
the brain and the hands.

```
  ┌─ browser (the face) ───────────────┐        ┌─ bridge (the brain) ─────────────┐
  │  "Hey Jarvis" wake word            │        │  Node · bridge/server.mjs        │
  │  local VAD  →  speech to text      │   ws   │  Claude Agent SDK                │
  │  reactor UI (Three.js + GLSL)      │◄─────► │   = Claude Code, headless        │
  │  text to speech                    │  8787  │  spawns your MCP servers         │
  │  heads-up display                  │        │  permission gate (decideTool)    │
  └────────────────────────────────────┘        └──────────────────────────────────┘
```

Everything you see and hear happens in the browser. The bridge is a single Node
process (`bridge/server.mjs`) that runs the **Claude Agent SDK**
(`@anthropic-ai/claude-agent-sdk`) — this spawns the real `claude` CLI as a child
process, so **the brain literally is Claude Code, headless.** They talk over a
WebSocket (plus a few HTTP endpoints) on `ws://localhost:8787`.

**Why a bridge at all?** A browser tab cannot spawn the local stdio MCP servers —
`higgsfield`, `elevenlabs`, `android`, `playwright`, `exa`, `serper`, and the
rest. The bridge can. And because it is the Agent SDK, it authenticates off your
existing Claude Code login: no API key, billed to that same Claude account.

**The model.** `claude-opus-5` at effort `medium` by default. Override with the
`JARVIS_MODEL` and `JARVIS_EFFORT` environment variables. On startup the bridge
prints its choice, e.g. `[jarvis] model claude-opus-5 · effort medium`.

### The voice pipeline

The loop is designed so that nothing silently dies and barge-in feels natural.

- **Detection is local.** An energy-based voice-activity detector
  (`src/lib/vad.ts`) decides when you are speaking. It is instant, cannot quietly
  fail, and is what makes **barge-in** work — speak while JARVIS is talking and he
  stops.
- **Transcription has two tiers, chosen automatically at boot.** The browser asks
  the bridge `/health` and picks the best available:
  - **ElevenLabs key present** → ElevenLabs Scribe, via the bridge `/stt` endpoint.
  - **Nothing configured** → the browser's own `SpeechRecognition` (Chrome/Edge),
    guarded by a heartbeat so it recovers when Chrome throttles it.
- **Speaking** uses the **ElevenLabs voice when a key is present**, and the
  browser's `speechSynthesis` otherwise. If a cloud call fails it falls back to
  the browser voice, and if the OS voice itself is broken it latches over to the
  cloud voice.

So it works with no keys and auto-upgrades when a key appears — there is no flag
to set. Capability detection lives in `src/lib/capabilities.ts`, which probes the
bridge's `GET /health` (returning `{ ok, tts, stt }`, both tracking the
ElevenLabs key) once at boot and picks the engines.

---

## What JARVIS can do

Beyond answering, JARVIS reaches every MCP server in your Claude Code
configuration, and can drive his own interface.

### Your tools

Every server in your `~/.claude.json` is handed to the SDK explicitly, or only the
ones you name in `JARVIS_MCP_SERVERS`. Depending on what you have installed, that
is roughly:

- **Web & search** — `exa`, `serper`, `serpapi`
- **Images & video** — `higgsfield`, `openrouter-image`, `palmier-pro`
- **Voice** — `elevenlabs`
- **Your phone** — `android`
- **The browser** — `playwright`

A few things you can say:

- *"What's happening in AI this week?"*
- *"Generate an image of the Mark VII suit."*
- *"Take a screenshot of my phone."*
- *"Open my GitHub notifications."*

> **Note on account connectors.** Servers you added through your **claude.ai
> account** (mail, drive, calendar and other account connectors) are not in `~/.claude.json`,
> but the CLI fetches them on its own and they join the session from the second
> turn. The bridge keeps them out by default; set `JARVIS_ACCOUNT_CONNECTORS=1`
> to let them in, and `JARVIS_MCP_SERVERS` to choose which `~/.claude.json`
> servers JARVIS gets.

### JARVIS controls the interface

He drives the UI through MCP tools the bridge exposes:

- `ui_theme` — accent, background, per-phase colours
- `ui_reactor` — colour, scale, intensity, spin, and style (`ring` | `sphere` | `wire`), visibility
- `ui_orbit` — put images in orbit around the reactor
- `ui_chrome` — show or hide rails, transcript, badges
- `ui_effect` — `glitch` | `pulse` | `scan` | `shake` | `flash`
- `ui_screen` — clear
- `ui_reset` — back to defaults

So *"make it red, hide the systems list, put that render in orbit"* is a spoken
command.

### The heads-up display

JARVIS authors panels with a `display` tool against a fixed `.hud-*` design
system. The browser sanitises the markup (DOMPurify, a class allowlist and a
strict CSP) before rendering. Rich media works — images, `<video>`, and
YouTube/Vimeo embeds. Remote images and video are fetched **server-side** through
the bridge (`/img` and `/media`, both SSRF-guarded), so hotlink-blocked news
thumbnails still appear and the page never beacons your IP to a host the model
chose.

---

## Controls

| Key / phrase | Does |
|---|---|
| **"Hey Jarvis"** | Wake him |
| **Space** | Talk without the wake word |
| Just speak | Interrupt him mid-sentence (barge-in) |
| **V** | Cycle the browser voice |
| **Escape** | Stand down |
| **D** | Live diagnostics panel |
| **T** | One-line audio self-test |

---

## The boot sequence

Power-up plays a four-beat Iron Man start-up (`src/ui/Boot.tsx`): an
"INITIATING SYSTEM" status bar with a segmented progress bar and boot log; then
concentric reticle rings resolving into "J.A.R.V.I.S"; then a suit schematic;
then the triangular arc reactor lighting up — with a start-up sound under it
(`public/audio/boot-music.mp3`).

---

## Configuration

Everything is optional in bridge mode. Frontend settings live in `.env.local`
(copy `.env.example`); bridge settings are environment variables.

### Bridge

| Variable | Default | Effect |
|---|---|---|
| `JARVIS_BRIDGE_PORT` | `8787` | Port for the WebSocket + HTTP endpoints |
| `JARVIS_BRIDGE_HOST` | `127.0.0.1` | Interface to listen on. Any other address puts the agent on your network |
| `JARVIS_BACKEND` | `claude` | `claude` preserves the SDK backend; `multica` enables the local issue adapter |
| `JARVIS_MULTICA_PROFILE` | none | Required Multica CLI profile in Multica mode |
| `JARVIS_MULTICA_ISSUE_ID` | none | Required dedicated pilot issue UUID |
| `JARVIS_MULTICA_WORKSPACE_ID` | none | Required expected workspace UUID |
| `JARVIS_MULTICA_AGENT_ID` | none | Required expected assignee UUID |
| `JARVIS_MULTICA_CLI` | `multica` | Fixed CLI executable; an absolute path is recommended |
| `JARVIS_MULTICA_TIMEOUT_MS` | `180000` | Whole-turn safety timeout, not a latency target |
| `JARVIS_MULTICA_STATE_DIR` | `~/.jarvis/multica` | Private persistent outbox/correlation state |
| `JARVIS_ALLOWED_HOSTS` | none | Extra hostnames the bridge answers to; a request for any other name gets a 403 |
| `JARVIS_MODEL` | `claude-opus-5` | Model to run |
| `JARVIS_EFFORT` | `medium` | Reasoning effort |
| `JARVIS_ALLOW_WRITES` | off | `1` allows effectful tools (see below) |
| `JARVIS_MCP_SERVERS` | all configured | Comma-separated `~/.claude.json` servers to pass on; empty passes none |
| `JARVIS_ACCOUNT_CONNECTORS` | off | `1` lets your claude.ai account's connectors join the session |
| `JARVIS_DISABLE` | none | Comma-separated capabilities to leave out: `browser`, `camera`, `interface` |
| `JARVIS_ALLOWED_ORIGINS` | local dev | Extra WebSocket origins to accept |
| `JARVIS_ALLOW_NO_ORIGIN` | off | Accept connections with no `Origin` header |
| `JARVIS_WORKSPACE` | `~/.jarvis/workspace` | The agent's working directory; file tools are confined to it and the temp directory |
| `JARVIS_FILE_ROOTS` | none | Extra folders the file tools and the `/file` endpoint may use |
| `JARVIS_KEEP_TRANSCRIPTS` | off | `1` keeps the SDK's session transcripts in `~/.claude/projects` |
| `JARVIS_CLAUDE_EXECUTABLE` | bundled CLI | Run the agent through this executable instead, e.g. a sandbox wrapper that execs the real CLI |
| `JARVIS_CHROME_PIPE` | none | WSL only: the Windows pipe name the browser relay connects to |
| `JARVIS_DEBUG` | off | `1` logs every agent message to the bridge terminal, answer text and tool calls included |
| `JARVIS_VOICE_ID` | none | ElevenLabs voice id |
| `ELEVENLABS_API_KEY` | none | Optional; enables the ElevenLabs voice + Scribe |

### Frontend (`.env.local`)

| Variable | Effect |
|---|---|
| `VITE_BACKEND` | `bridge` (default), `multica`, or `direct` |
| `VITE_BRIDGE_URL` | Where to reach the bridge |
| `VITE_BRIDGE_IDLE_TIMEOUT_MS` | Quiet-turn limit; defaults to 210s in Multica mode, otherwise 120s |
| `VITE_TTS_ENGINE` | `system` or `kokoro` |
| `VITE_KOKORO_VOICE` | Voice for the Kokoro engine |
| `VITE_USE_ELEVENLABS` | Force the ElevenLabs voice on |
| `VITE_ANTHROPIC_API_KEY` | Direct mode only |

### Adding an ElevenLabs key

You do not have to touch a flag. Either:

- Set `ELEVENLABS_API_KEY` on the bridge before starting it, **or**
- Add the key to your `elevenlabs` MCP server's env in `~/.claude.json` — the
  bridge reads it from there too.

Either way, `/health` starts reporting the capability, the browser picks it up on
the next boot, and both the voice and transcription upgrade automatically.

---

## Enabling actions

The tool gate starts **read-only**. Search, generation and lookups run freely;
anything effectful — send, tap, delete, install, pay — is denied. Voice is a poor
interface for a confirmation dialog, so the decision is made ahead of time, in
`decideTool()` in `bridge/policy.mjs`. The bridge sets
`settingSources: []`, which makes its own gate the only authority — filesystem
settings and any global `bypassPermissions` cannot override it.

A `PreToolUse` hook applies that policy to every call, including the reads the
Claude Code CLI would otherwise approve by itself. In read-only mode the agent
has no shell, and its file tools reach only its workspace (`~/.jarvis/workspace`),
the temp directory and any folders in `JARVIS_FILE_ROOTS`. Paths that hold
credentials, such as `~/.ssh`, `~/.claude` and `.env` files, stay refused even
inside those folders.

To allow effectful tools (phone, browser driving, sending), run the bridge this
way instead:

```bash
npm run bridge:writes
```

The script passes `--writes` to the bridge, so it works in Windows `cmd` and
PowerShell too. With `npm start`, use `npm start -- --writes`. Writes add `Bash`,
`Write`, `Edit` and `NotebookEdit` to the agent's tools. The file tools stay
inside the same folders; the shell can reach anything your user account can.

> Read `decideTool()` before you do. *"Hey Jarvis, clean up my downloads folder"*
> means something rather different with writes enabled.

---

## Troubleshooting

**I can't hear him, or he can't hear me.** Press **D** for the diagnostics panel
— it states plainly whether he is hearing you and whether he is producing sound.
Press **T** for a one-line audio self-test.

**No voice at all.** You must be in **Chrome or Edge**, in a **real browser
window** (not an embedded preview), and you must have **allowed the microphone**.

**Bridge not reachable.** Check that `npm run bridge` is still running in its
terminal, and that nothing else is holding port `8787`. If the port is taken,
the bridge says so in one line at startup and exits. It listens on `127.0.0.1`
only. Reaching it from another machine takes `JARVIS_BRIDGE_HOST` and
`JARVIS_ALLOWED_HOSTS`, and your own authentication in front of it first.

**Browser control on Windows.** The bridge finds the Claude extension's named
pipe, `\\.\pipe\claude-mcp-browser-bridge-<user>`, by itself. If the boot log
says the extension is not running, open Chrome with the extension signed in.
Each browser request looks for the pipe again, so the bridge does not need a
restart.

**Running the bridge in WSL, with Chrome on Windows.** Browser control works:
the Windows native host exposes a named pipe rather than a Unix socket, and the
bridge reaches it through a short PowerShell relay (WSL interop must be on,
which it is by default). Open the app at `http://127.0.0.1:5173` if
`localhost` is slow to load — Windows tries IPv6 loopback first, and WSL does
not forward it.

---

## Tests

`npm test` runs the bridge's tests with Node's built-in runner. They cover the
network binding, the tool policy, the MCP server allowlist and the WSL browser
relay, which runs only under WSL. The network and allowlist tests start the
bridge on a random loopback port, and none of the tests opens an agent session.
The Multica adapter tests use a fake CLI fixture: they cover sequential C/T/R
correlation, wrong-turn filtering, delayed visibility, terminal failures,
ambiguous submission reconciliation, persistent playback acknowledgement,
timeouts and interruption before a task id is visible. They do not call a live
Multica agent. The browser voice smoke and the 10-turn live procedure above are
separate manual validations.

---

## Security

The bridge's defences live in `bridge/server.mjs` and `bridge/policy.mjs`:

- It listens on `127.0.0.1` and answers only requests addressed to `localhost`,
  `127.0.0.1` or `[::1]`, which blocks DNS rebinding.
- The WebSocket accepts only local dev origins (add more with
  `JARVIS_ALLOWED_ORIGINS`).
- `/file`, `/img` and `/media` validate the scheme, confine to allowed roots,
  resolve the real path, and refuse private and loopback addresses (SSRF guard).
- The tool gate (`decideTool`) is default-deny for effectful MCP tools.
- A `PreToolUse` hook enforces the tool policy on every call. File tools stay
  inside the workspace, the temp directory and `JARVIS_FILE_ROOTS`, and
  `WebFetch` cannot reach loopback, LAN or cloud metadata addresses.
- claude.ai account connectors stay out of the session unless
  `JARVIS_ACCOUNT_CONNECTORS=1`, and `JARVIS_MCP_SERVERS` narrows which
  `~/.claude.json` servers the agent gets.
- Session transcripts are written to `~/.claude/projects` only when
  `JARVIS_KEEP_TRANSCRIPTS=1`.
- `JARVIS_DISABLE` removes browser control, the camera or the interface tools
  entirely, and `JARVIS_CLAUDE_EXECUTABLE` can run the agent inside a sandbox
  wrapper.
- A strict CSP in `index.html`; model-authored panel HTML is sanitised.

---

## Credits & licence

MIT.

The boot sound and any tracks in `public/audio/` ship with the project for the
demo. If you go on to monetise something built on this, clearing the rights to
that audio is your responsibility.
