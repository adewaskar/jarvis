import { join } from 'node:path'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { SECRETS_DIR } from './youtube-auth.mjs'

/**
 * Per-platform credentials in ~/.jarvis/secrets/<name>.json.
 *
 * That folder is on policy.mjs's credential list, so the agent's own file
 * tools refuse it; only bridge code reads these. `<name>-app.json` holds the
 * developer app (client key/secret, redirect URI), `<name>.json` the user's
 * tokens.
 */
export const secretPath = (name) => join(SECRETS_DIR, `${name}.json`)

export const hasSecret = (name) => existsSync(secretPath(name))

export function readSecret(name) {
  try {
    return JSON.parse(readFileSync(secretPath(name), 'utf8'))
  } catch {
    return null
  }
}

export function saveSecret(name, value) {
  mkdirSync(SECRETS_DIR, { recursive: true })
  writeFileSync(secretPath(name), JSON.stringify(value, null, 2), { mode: 0o600 })
  try {
    chmodSync(secretPath(name), 0o600)
  } catch {
    /* Windows: ACLs, not modes */
  }
}

/** MCP tool result helpers shared by the bridge's own servers. */
export const ok = (data) => ({
  content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data) }],
})
export const fail = (err) => ({
  isError: true,
  content: [{ type: 'text', text: String(err?.message ?? err) }],
})

/** Wrap a handler so any throw becomes a sentence the model can repeat. */
export const safe = (fn) => async (args) => {
  try {
    return ok(await fn(args ?? {}))
  } catch (e) {
    return fail(e)
  }
}
