import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

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

  /** What the deck and the voice tool see. */
  async function describe() {
    const local = await localModels()
    return {
      mode: state.mode,
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

  const label = () => (state.mode === 'local' ? `local · ${state.local}` : `cloud · ${state.cloud}`)

  return { describe, set, options, label, get mode() { return state.mode } }
}
