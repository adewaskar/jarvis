/**
 * Connect JARVIS to your YouTube channel — run once: `npm run youtube:connect`.
 *
 * Needs an OAuth client of type "Desktop app" from Google Cloud (see
 * YOUTUBE.md). Point this at its downloaded JSON in any of these ways:
 *   npm run youtube:connect -- path\to\client_secret_xxx.json
 *   set YOUTUBE_CLIENT_SECRET_FILE=path\to\client_secret_xxx.json
 *   or drop it at ~/.jarvis/secrets/youtube-client.json
 *
 * Opens Google's consent screen in your browser, catches the reply on a
 * loopback port, and saves a refresh token to ~/.jarvis/secrets/youtube.json.
 * Nothing leaves this machine except the exchange with Google itself.
 */

import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { SCOPES, SECRETS_DIR, saveToken } from '../bridge/youtube-auth.mjs'

const CLIENT_COPY = join(SECRETS_DIR, 'youtube-client.json')

function findClientFile() {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('-'))
  for (const p of [arg, process.env.YOUTUBE_CLIENT_SECRET_FILE, CLIENT_COPY]) {
    if (p && existsSync(resolve(p))) return resolve(p)
  }
  return null
}

const file = findClientFile()
if (!file) {
  console.error(`
  No Google OAuth client file found.

  1. Follow YOUTUBE.md (step 1-4) to create a "Desktop app" OAuth client.
  2. Download its JSON, then run:

       npm run youtube:connect -- "C:\\path\\to\\client_secret_....json"
`)
  process.exit(1)
}

const raw = JSON.parse(readFileSync(file, 'utf8'))
const client = raw.installed ?? raw.web
if (!client?.client_id || !client?.client_secret) {
  console.error('  That file does not look like a Google OAuth client JSON.')
  process.exit(1)
}
if (!raw.installed) {
  console.warn('  Note: this is a "Web application" client. A "Desktop app" client is recommended.')
}

// Keep a copy beside the token so re-connecting later needs no arguments.
mkdirSync(SECRETS_DIR, { recursive: true })
if (resolve(file) !== resolve(CLIENT_COPY)) copyFileSync(file, CLIENT_COPY)

const verifier = randomBytes(32).toString('base64url')
const challenge = createHash('sha256').update(verifier).digest('base64url')
const state = randomBytes(16).toString('hex')

const server = createServer()
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address()
  const redirect = `http://127.0.0.1:${port}/callback`
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  auth.search = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirect,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  }).toString()

  console.log('\n  Opening Google sign-in in your browser…')
  console.log('  If it does not open, paste this URL into Chrome:\n')
  console.log('  ' + auth.toString() + '\n')
  openBrowser(auth.toString())

  server.on('request', async (req, res) => {
    const url = new URL(req.url, redirect)
    if (url.pathname !== '/callback') {
      res.writeHead(404).end()
      return
    }
    const done = (code, msg) => {
      res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' })
      res.end(`<body style="font:16px system-ui;background:#05080d;color:#7fe7ff;padding:3em">${msg}</body>`)
    }
    if (url.searchParams.get('state') !== state) return done(400, 'State mismatch. Run the command again.')
    if (url.searchParams.get('error')) {
      done(400, `Google said: ${url.searchParams.get('error')}. You can close this tab.`)
      console.error(`  Sign-in cancelled: ${url.searchParams.get('error')}`)
      return finish(1)
    }
    try {
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: url.searchParams.get('code'),
          client_id: client.client_id,
          client_secret: client.client_secret,
          redirect_uri: redirect,
          grant_type: 'authorization_code',
          code_verifier: verifier,
        }),
      })
      const tok = await r.json()
      if (!r.ok || !tok.refresh_token) throw new Error(tok.error_description ?? tok.error ?? 'no refresh token')
      saveToken({
        client_id: client.client_id,
        client_secret: client.client_secret,
        refresh_token: tok.refresh_token,
        access_token: tok.access_token,
        expires_at: Date.now() + (tok.expires_in ?? 3600) * 1000,
        scope: tok.scope,
      })
      // Say which channel we got, so a wrong-account sign-in is obvious now.
      const ch = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', {
        headers: { authorization: `Bearer ${tok.access_token}` },
      }).then((x) => x.json())
      const c = ch.items?.[0]
      const name = c ? `${c.snippet.title} (${c.statistics.subscriberCount} subscribers)` : 'no channel on this account yet'
      done(200, `J.A.R.V.I.S. is connected to YouTube: <b>${escapeHtml(name)}</b>.<br>You can close this tab.`)
      console.log(`\n  Connected: ${name}`)
      console.log('  Restart the bridge (npm start) and JARVIS has YouTube.\n')
      finish(0)
    } catch (err) {
      done(500, `Could not finish sign-in: ${escapeHtml(err.message)}`)
      console.error(`  Could not finish sign-in: ${err.message}`)
      finish(1)
    }
  })
})

function finish(code) {
  setTimeout(() => {
    server.close()
    process.exit(code)
  }, 300)
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
  } catch {
    /* the URL is printed above */
  }
}
