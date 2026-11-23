/**
 * Connect JARVIS to TikTok or Instagram — run once per platform:
 *
 *   npm run social:connect -- tiktok
 *   npm run social:connect -- instagram
 *
 * Asks for your developer app's key, secret and redirect URI the first time
 * (see SOCIAL.md), opens the platform's consent screen, and saves the tokens
 * to ~/.jarvis/secrets/<platform>.json.
 *
 * Both platforms insist on an https redirect URI, which nothing on this machine
 * is listening on. That is fine: after you approve, the browser lands on that
 * URL (it may show an error page — ignore it), and you paste the address from
 * the address bar back here. If you registered an http://localhost URL
 * instead, it is caught automatically.
 */

import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { readSecret, saveSecret } from '../bridge/secrets.mjs'
import { TIKTOK_SCOPES } from '../bridge/tiktok.mjs'
import { IG_SCOPES } from '../bridge/instagram.mjs'

const platform = (process.argv[2] ?? '').toLowerCase()
if (!['tiktok', 'instagram'].includes(platform)) {
  console.error('\n  Usage: npm run social:connect -- tiktok   (or instagram)\n')
  process.exit(1)
}

const rl = createInterface({ input: process.stdin, output: process.stdout })
const ask = async (q, def) => ((await rl.question(`  ${q}${def ? ` [${def}]` : ''}: `)).trim() || def || '')

const LABEL = platform === 'tiktok' ? { key: 'Client key', secret: 'Client secret' } : { key: 'Instagram app ID', secret: 'Instagram app secret' }

let app = readSecret(`${platform}-app`)
if (!app || process.argv.includes('--reset')) {
  console.log(`\n  First-time setup for ${platform}. Values come from your developer app (SOCIAL.md).\n`)
  app = {
    client_id: await ask(LABEL.key),
    client_secret: await ask(LABEL.secret),
    redirect_uri: await ask('Redirect URI exactly as registered', 'https://localhost:8443/callback'),
  }
  if (!app.client_id || !app.client_secret) {
    console.error('\n  Both the key and the secret are needed.\n')
    process.exit(1)
  }
  saveSecret(`${platform}-app`, app)
}

const state = randomBytes(16).toString('hex')
const auth =
  platform === 'tiktok'
    ? `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({
        client_key: app.client_id,
        scope: TIKTOK_SCOPES,
        response_type: 'code',
        redirect_uri: app.redirect_uri,
        state,
      })}`
    : `https://www.instagram.com/oauth/authorize?${new URLSearchParams({
        client_id: app.client_id,
        redirect_uri: app.redirect_uri,
        response_type: 'code',
        scope: IG_SCOPES,
        state,
        enable_fb_login: '0',
        force_reauth: 'true',
      })}`

console.log(`\n  Opening ${platform} sign-in in your browser. If it does not open, paste this into Chrome:\n\n  ${auth}\n`)
openBrowser(auth)

const code = await getCode()
try {
  if (platform === 'tiktok') await finishTikTok(code)
  else await finishInstagram(code)
  console.log('  Restart the bridge (npm start -- --writes) and JARVIS has it.\n')
  process.exit(0)
} catch (err) {
  console.error(`\n  Could not finish sign-in: ${err.message}\n`)
  process.exit(1)
}

/** Catch the redirect on loopback if possible, otherwise ask for the pasted URL. */
async function getCode() {
  const r = new URL(app.redirect_uri)
  const loopback = r.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(r.hostname)
  const parse = (raw) => {
    const u = new URL(raw.trim(), app.redirect_uri)
    if (u.searchParams.get('error')) throw new Error(`${platform} said: ${u.searchParams.get('error_description') ?? u.searchParams.get('error')}`)
    if (u.searchParams.get('state') !== state) throw new Error('State mismatch — paste the address from this sign-in, not an older one.')
    // Instagram appends "#_" to the code.
    return (u.searchParams.get('code') ?? '').replace(/#_?$/, '')
  }
  if (!loopback) {
    console.log('  After approving, your browser goes to your redirect URI (an error page there is normal).')
    const pasted = await ask('Paste the FULL address from the address bar here')
    rl.close()
    return parse(pasted)
  }
  rl.close()
  return new Promise((resolve, reject) => {
    const srv = createServer((req, res) => {
      if (!req.url.startsWith(r.pathname)) return res.writeHead(404).end()
      res.writeHead(200, { 'content-type': 'text/html' }).end('<body style="font:16px system-ui;padding:3em">Connected — you can close this tab.</body>')
      srv.close()
      try {
        resolve(parse(`http://${req.headers.host}${req.url}`))
      } catch (e) {
        reject(e)
      }
    }).listen(Number(r.port || 80), r.hostname)
  })
}

async function finishTikTok(code) {
  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: app.client_id,
      client_secret: app.client_secret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: app.redirect_uri,
    }),
  })
  const b = await res.json()
  if (!res.ok || !b.access_token) throw new Error(b.error_description ?? b.error ?? `status ${res.status}`)
  saveSecret('tiktok', {
    client_key: app.client_id,
    client_secret: app.client_secret,
    open_id: b.open_id,
    scope: b.scope,
    access_token: b.access_token,
    refresh_token: b.refresh_token,
    expires_at: Date.now() + b.expires_in * 1000,
  })
  const me = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=display_name,follower_count', {
    headers: { authorization: `Bearer ${b.access_token}` },
  }).then((x) => x.json())
  const u = me.data?.user
  console.log(`\n  Connected to TikTok: ${u ? `${u.display_name} (${u.follower_count ?? '?'} followers)` : 'ok'}`)
  if (!String(b.scope).includes('video.publish')) {
    console.log('  Note: video.publish was not granted — add the Content Posting API product and Direct Post to your app.')
  }
}

async function finishInstagram(code) {
  const short = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: app.client_id,
      client_secret: app.client_secret,
      grant_type: 'authorization_code',
      redirect_uri: app.redirect_uri,
      code,
    }),
  }).then((x) => x.json())
  if (!short.access_token) throw new Error(short.error_message ?? short.error?.message ?? JSON.stringify(short))
  const long = await fetch(
    `https://graph.instagram.com/access_token?${new URLSearchParams({
      grant_type: 'ig_exchange_token',
      client_secret: app.client_secret,
      access_token: short.access_token,
    })}`,
  ).then((x) => x.json())
  if (!long.access_token) throw new Error(long.error?.message ?? 'could not get a long-lived token')
  const me = await fetch(
    `https://graph.instagram.com/me?fields=user_id,username,account_type,followers_count&access_token=${encodeURIComponent(long.access_token)}`,
  ).then((x) => x.json())
  saveSecret('instagram', {
    user_id: me.user_id ?? String(short.user_id),
    username: me.username,
    access_token: long.access_token,
    expires_at: Date.now() + long.expires_in * 1000,
  })
  console.log(`\n  Connected to Instagram: @${me.username} (${me.account_type}, ${me.followers_count ?? '?'} followers)`)
  if (me.account_type && !['BUSINESS', 'MEDIA_CREATOR', 'CREATOR'].includes(me.account_type)) {
    console.log('  Note: switch the account to Professional (Creator or Business) in the Instagram app, or publishing will be refused.')
  }
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
  } catch {
    /* printed above */
  }
}
