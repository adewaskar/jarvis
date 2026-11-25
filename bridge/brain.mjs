import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

/**
 * Which brain JARVIS thinks with, switchable while he runs.
 *
 *   cloud: Claude through your Claude Code sign-in (no API bill on a
 *          subscription). Strongest by far.
 *   local: a model on this PC through Ollama, which speaks the same
 *          Anthropic Messages API on localhost:11434. Free, private and
 *          offline, but a small local model is much weaker at tools.
 *
 * The choice is saved in the workspace so it survives restarts. A change takes
 * effect by restarting each voice session; the page reconnects by itself.
 *
 * Usage-limit fallback: when Claude refuses with a usage limit, JARVIS drops to
 * the local brain on his own and goes back to Claude once the limit resets.
 * `limitedUntil` records when that is; unattended runs wait for it.
 */

export const CLOUD_MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5 · best included' },
  { id: 'claude-fable-5-2', label: 'Fable 5.2 · needs usage credits' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 · quick' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5 · fastest' },
]

const OLLAMA = (process.env.OLLAMA_HOST ?? 'http://localhost:11434').replace(/\/$/, '').replace(/^(?!https?:)/, 'http://')

export function createBrain({ workspace, defaultModel, effort }) {
  const file = join(workspace, 'brain.json')
  const read = () => {
    try {
      return JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      return {}
    }
  }
  let state = { mode: 'cloud', cloud: defaultModel, local: null, ...read() }
  // An env override wins over a saved choice, so JARVIS_MODEL still means what it says.
  if (process.env.JARVIS_MODEL && state.mode === 'cloud') state.cloud = process.env.JARVIS_MODEL

  const save = () => {
    mkdirSync(workspace, { recursive: true })
    writeFileSync(file + '.tmp', JSON.stringify(state, null, 2))
    renameSync(file + '.tmp', file)
  }

  async function localModels() {
    try {
      const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2500) })
      const d = await r.json()
      // Smallest first: on a laptop the default pick is the quickest model that
      // can use tools (a 2B answers in seconds once warm; a 9B takes minutes).
      return [...(d.models ?? [])].sort((a, b) => (a.size ?? 0) - (b.size ?? 0)).map((m) => ({
        id: m.name,
        label: `${m.name} · ${m.details?.parameter_size ?? ''}`.trim(),
        tools: (m.capabilities ?? []).includes('tools'),
      }))
    } catch {
      return null // Ollama not running
    }
  }

  /** Start the Ollama app if it is installed but not running; wait up to 30 s. */
  async function startOllama() {
    const exe = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Ollama', 'ollama app.exe')
    if (process.platform !== 'win32' || !existsSync(exe)) return null
    try {
      spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    } catch {
      return null
    }
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      const m = await localModels()
      if (m) return m
    }
    return null
  }

  /** What the deck and the voice tool see. */
  async function describe() {
    const local = await localModels()
    return {
      mode: state.mode,
      claudeLimitedUntil: limited() ? new Date(state.limitedUntil).toISOString() : null,
      automaticFallback: Boolean(state.fellBack),
      model: state.mode === 'local' ? state.local : state.cloud,
      cloud: state.cloud,
      local: state.local,
      cloudModels: CLOUD_MODELS,
      localModels: local ?? [],
      ollama: local !== null,
    }
  }

  /** Change the brain. Returns the new description, or throws a plain reason. */
  async function set({ mode, cloud, local }) {
    const next = { ...state }
    if (cloud) {
      if (!/^claude-[a-z0-9.-]+$/.test(cloud)) throw new Error('Unknown cloud model.')
      next.cloud = cloud
    }
    if (mode) {
      if (mode !== 'cloud' && mode !== 'local') throw new Error('mode is cloud or local.')
      next.mode = mode
    }
    if (local || next.mode === 'local') {
      const models = await localModels()
      if (!models) throw new Error('Ollama is not running. Start the Ollama app, then try again.')
      const pick = local ?? next.local ?? models.find((m) => m.tools)?.id ?? models[0]?.id
      if (!pick || !models.some((m) => m.id === pick)) throw new Error(`No local model called ${pick}. Installed: ${models.map((m) => m.id).join(', ') || 'none'}.`)
      next.local = pick
    }
    state = next
    save()
    return describe()
  }

  /** The query() options for the current brain. */
  function options() {
    if (state.mode === 'local' && state.local) {
      return {
        model: state.local,
        env: {
          ...process.env,
          ANTHROPIC_BASE_URL: OLLAMA,
          ANTHROPIC_AUTH_TOKEN: 'ollama',
          ANTHROPIC_API_KEY: '',
          // No background calls: they stall for a minute against a local server.
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          DISABLE_TELEMETRY: '1',
        },
        // Local models think at length before every word; on a laptop that is
        // most of the wait. Measured: 53 s with thinking, 7 s without.
        thinking: { type: 'disabled' },
      }
    }
    return { model: state.cloud, effort }
  }

  const now = () => Date.now()
  const limited = () => Boolean(state.limitedUntil && now() < state.limitedUntil)

  /**
   * Claude said no. Remember until when, and fall back to the local brain if
   * one is installed. Returns true when the brain actually changed.
   */
  async function hitLimit(resetsAt) {
    let until = Number(resetsAt) || 0
    if (until && until < 1e12) until *= 1000 // seconds -> ms
    if (!until || until <= now()) until = now() + 60 * 60e3 // unknown: try again in an hour
    state = { ...state, limitedUntil: until }
    let switched = false
    if (state.mode === 'cloud') {
      const models = (await localModels()) ?? (await startOllama())
      const pick = models?.find((m) => m.tools)?.id ?? state.local ?? models?.[0]?.id // quickest tool-capable model first
      if (models && pick) {
        state = { ...state, mode: 'local', local: pick, fellBack: true }
        switched = true
      }
    }
    save()
    return switched
  }

  /** Once the limit has reset, go back to Claude. Returns true when it did. */
  function recover() {
    if (!state.limitedUntil || now() < state.limitedUntil) return false
    const back = state.fellBack && state.mode === 'local'
    const { limitedUntil: _l, fellBack: _f, ...rest } = state
    state = back ? { ...rest, mode: 'cloud' } : rest
    save()
    return Boolean(back)
  }

  /** A user's own switch ends any automatic fallback. */
  const userSet = async (a) => {
    const d = await set(a)
    if (state.fellBack) {
      const { fellBack: _f, ...rest } = state
      state = rest
      save()
    }
    return d
  }

  const label = () => (state.mode === 'local' ? `local · ${state.local}` : `cloud · ${state.cloud}`)

  return {
    describe,
    set: userSet,
    options,
    label,
    hitLimit,
    recover,
    limited,
    get mode() { return state.mode },
    get fellBack() { return Boolean(state.fellBack) },
    get limitedUntil() { return state.limitedUntil ?? null },
  }
}
