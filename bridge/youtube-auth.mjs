import { join } from 'node:path'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { SECRETS_DIR, accountSecret, listAccounts } from './accounts.mjs'

/**
 * YouTube credentials, kept out of the agent's reach.
 *
 * The token lives in ~/.jarvis/secrets, which policy.mjs lists as a credential
 * directory: the agent's file tools refuse it even if JARVIS_FILE_ROOTS is
 * widened to the whole home folder. Only this bridge process reads it.
 *
 * Written once by `npm run youtube:connect`, refreshed here as needed. Extra
 * channels (`--account <name>`) live beside it as youtube@<name>.json; the
 * current account comes from accounts.mjs.
 */
export { SECRETS_DIR }
export const TOKEN_FILE = join(SECRETS_DIR, 'youtube.json')
const tokenFile = () => join(SECRETS_DIR, `${accountSecret('youtube')}.json`)

export const SCOPES = [
  // Read + manage the channel: videos, playlists, comments, thumbnails.
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/youtube.upload',
  // Views, watch time, subscribers gained — the analytics tab.
  'https://www.googleapis.com/auth/yt-analytics.readonly',
]

/** True when any YouTube channel (main or named) is connected. */
export function youtubeConnected() {
  return existsSync(TOKEN_FILE) || listAccounts('youtube').length > 0
}

export function readToken() {
  try {
    return JSON.parse(readFileSync(tokenFile(), 'utf8'))
  } catch {
    return null
  }
}

export function saveToken(token) {
  const file = tokenFile()
  mkdirSync(SECRETS_DIR, { recursive: true })
  writeFileSync(file, JSON.stringify(token, null, 2), { mode: 0o600 })
  try {
    chmodSync(file, 0o600)
  } catch {
    /* Windows: ACLs, not modes */
  }
}

/** One refresh in flight per account. */
const refreshing = new Map()

/** A valid access token, refreshing it first when it is within a minute of expiry. */
export async function accessToken() {
  const tok = readToken()
  const file = tokenFile()
  if (!tok?.refresh_token) {
    throw new Error(`YouTube ${accountSecret('youtube')} is not connected. The user needs to run: npm run youtube:connect`)
  }
  if (tok.access_token && tok.expires_at && Date.now() < tok.expires_at - 60_000) {
    return tok.access_token
  }
  if (refreshing.has(file)) return refreshing.get(file)
  const p = (async () => {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: tok.client_id,
        client_secret: tok.client_secret,
        refresh_token: tok.refresh_token,
        grant_type: 'refresh_token',
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(
        `YouTube sign-in expired or was revoked (${body.error ?? res.status}). ` +
          'The user needs to run: npm run youtube:connect',
      )
    }
    const next = {
      ...tok,
      access_token: body.access_token,
      expires_at: Date.now() + (body.expires_in ?? 3600) * 1000,
    }
    saveToken(next)
    return next.access_token
  })().finally(() => refreshing.delete(file))
  refreshing.set(file, p)
  return p
}
