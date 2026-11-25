import { execFile } from 'node:child_process'
import { readSecret } from './secrets.mjs'

/**
 * Ringing the user: a real phone call through Twilio, with JARVIS's message
 * read out by a text-to-speech voice. Credentials come from TWILIO_ACCOUNT_SID,
 * TWILIO_AUTH_TOKEN and TWILIO_FROM, or ~/.jarvis/secrets/twilio.json
 * (written by `npm run phone:connect`).
 *
 * A Twilio trial account is free and can call your own verified number; the
 * call starts with a short "trial account" notice until you upgrade.
 *
 * Without Twilio, toast() shows a Windows notification instead.
 */

function creds() {
  const f = readSecret('twilio') ?? {}
  const sid = process.env.TWILIO_ACCOUNT_SID ?? f.sid
  const token = process.env.TWILIO_AUTH_TOKEN ?? f.token
  const from = process.env.TWILIO_FROM ?? f.from
  return sid && token && from ? { sid, token, from } : null
}

export const phoneReady = () => Boolean(creds())

/** "204 295 3668" -> "+12042953668" (North America when no country code). */
export function normalisePhone(raw) {
  const digits = String(raw).replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) return digits
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return digits
}

const xml = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c])

export async function callPhone(to, message) {
  const c = creds()
  if (!c) throw new Error('Twilio is not set up.')
  const twiml = `<Response><Pause length="1"/><Say voice="Polly.Brian">${xml(message)}</Say><Pause length="1"/><Say voice="Polly.Brian">${xml(message)}</Say></Response>`
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.sid)}/Calls.json`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${c.sid}:${c.token}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: normalisePhone(to), From: c.from, Twiml: twiml }),
    signal: AbortSignal.timeout(20000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Twilio refused the call: ${data.message ?? res.status}`)
  return { sid: data.sid, status: data.status }
}

/** A Windows toast notification. Best effort; never throws. */
export function toast(title, body) {
  if (process.platform !== 'win32') return Promise.resolve()
  const script = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$t = [System.Security.SecurityElement]::Escape($env:J_T); $b = [System.Security.SecurityElement]::Escape($env:J_B)
$x.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$t</text><text>$b</text></binding></visual></toast>")
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($x))`
  return new Promise((resolve) =>
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, J_T: title, J_B: body }, windowsHide: true, timeout: 15000 }, () => resolve()),
  )
}
