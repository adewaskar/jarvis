import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { systemSnapshot } from './system.mjs'
import { myChannel } from './youtube.mjs'
import { tiktokProfile } from './tiktok.mjs'
import { instagramProfile } from './instagram.mjs'

/**
 * GET /deck: one JSON snapshot for the command-deck HUD. The machine, the
 * channels, the pipelines, the autopilot queue and a crypto ticker, each
 * cached for as long as it is worth, so the page can poll every few seconds
 * without hammering any API.
 */

function cached(ms, fn) {
  let at = 0
  let value = null
  let pending = null
  return async () => {
    if (Date.now() - at < ms) return value
    pending ??= fn()
      .then((v) => ((value = v), (at = Date.now()), v))
      .catch(() => value)
      .finally(() => (pending = null))
    return pending
  }
}

const readJson = (p, fallback) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return fallback
  }
}

const num = (v) => (v == null ? null : Number(v))

export function createDeck({ workspace, pipelines, on, model, effort, writes, brainLabel }) {
  const system = cached(2500, systemSnapshot)

  const crypto = cached(60_000, async () => {
    const r = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true',
      { signal: AbortSignal.timeout(8000) },
    )
    if (!r.ok) throw new Error(String(r.status))
    const d = await r.json()
    return [
      ['BTC', d.bitcoin],
      ['ETH', d.ethereum],
      ['SOL', d.solana],
    ].map(([symbol, v]) => ({ symbol, usd: v?.usd ?? null, change24h: v?.usd_24h_change ?? null }))
  })

  const channels = cached(5 * 60_000, async () => {
    const settle = async (onFlag, fn) => (onFlag ? fn().catch((e) => ({ error: e.message })) : null)
    const [yt, tt, ig] = await Promise.all([
      settle(on.youtube, async () => {
        const c = await myChannel()
        return { name: c.snippet?.title, followers: num(c.statistics?.subscriberCount), views: num(c.statistics?.viewCount), posts: num(c.statistics?.videoCount) }
      }),
      settle(on.tiktok, async () => {
        const p = await tiktokProfile()
        return { name: p.display_name, followers: num(p.follower_count), likes: num(p.likes_count), posts: num(p.video_count) }
      }),
      settle(on.instagram, async () => {
        const p = await instagramProfile()
        return { name: p.username, followers: num(p.followers_count), posts: num(p.media_count) }
      }),
    ])
    return { youtube: yt, tiktok: tt, instagram: ig }
  })

  // Winnipeg weather from Open-Meteo (free, no key, no account).
  const weather = cached(10 * 60_000, async () => {
    const r = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=49.90&longitude=-97.14&current=temperature_2m,weather_code,is_day&timezone=America%2FWinnipeg',
      { signal: AbortSignal.timeout(8000) },
    )
    if (!r.ok) throw new Error(String(r.status))
    const c = (await r.json()).current ?? {}
    return { place: 'Winnipeg, MB', tempC: c.temperature_2m ?? null, code: c.weather_code ?? null, day: c.is_day === 1 }
  })

  // The read-only security check JARVIS also runs daily (tools/security-check.ps1).
  const security = cached(30 * 60_000, () => new Promise((resolve) => {
    const script = join(workspace, 'tools', 'security-check.ps1')
    if (!existsSync(script)) return resolve(null)
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { timeout: 90_000, windowsHide: true }, (err, out) => {
      if (err && !out) return resolve({ ok: null, issues: [], checked: new Date().toISOString() })
      const lines = String(out).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      const issues = lines.filter((l) => l.startsWith('!!')).map((l) => l.slice(2).trim())
      const av = lines.filter((l) => l.startsWith('antivirus:') && /on=True/.test(l)).map((l) => l.replace(/^antivirus:\s*/, '').split(' on=')[0])
      resolve({ ok: issues.length === 0, issues, antivirus: av, checked: new Date().toISOString() })
    })
  }))

  // Today's memory log, newest first: what JARVIS (and Claude) actually did.
  const activity = () => {
    const d = new Date()
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    try {
      return readFileSync(join(workspace, 'memory', 'log', `${day}.md`), 'utf8')
        .split(/\r?\n/)
        .map((l) => l.match(/^-\s*(\d{1,2}:\d{2})\s*[—-]\s*(.+)$/))
        .filter(Boolean)
        .map(([, time, text]) => ({ time, text: text.length > 140 ? `${text.slice(0, 137)}…` : text }))
        .reverse()
        .slice(0, 8)
    } catch {
      return []
    }
  }

  // JARVIS's standing jobs, read from the settings files that drive them.
  const agents = () => {
    const auto = readJson(join(workspace, 'autopilot', 'settings.json'), {})
    const agency = readJson(join(workspace, 'projects', 'agency', 'settings.json'), {})
    let nextScout = null
    try {
      nextScout = readFileSync(join(workspace, 'memory', 'core.md'), 'utf8').match(/Next GitHub check due:\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null
    } catch {}
    return [
      { name: 'YouTube Autopilot', state: auto.enabled ? 'on' : 'off', detail: auto.enabled ? `Shorts at ${(auto.times ?? []).join(' & ')}` : 'switched off' },
      { name: 'Studio', state: 'on', detail: 'images · Kokoro voice · renders' },
      { name: 'Research', state: 'on', detail: 'web search & browser' },
      { name: 'Security Watch', state: 'on', detail: 'daily read-only check' },
      { name: 'GitHub Scout', state: 'on', detail: nextScout ? `next check ${nextScout}` : 'every 2 weeks' },
      { name: 'Agency (websites)', state: agency.enabled ? 'on' : 'paused', detail: agency.enabled ? 'finding leads' : 'paused by owner' },
    ]
  }

  async function snapshot() {
    const [sys, coins, ch, wx, sec] = await Promise.all([system(), crypto(), channels(), weather(), security()])
    const settings = readJson(join(workspace, 'autopilot', 'settings.json'), {})
    const queue = readJson(join(workspace, 'autopilot', 'queue.json'), [])
    const recent = [...queue]
      .sort((a, b) => String(b.at ?? b.created ?? '').localeCompare(String(a.at ?? a.created ?? '')))
      .slice(0, 6)
      .map((q) => ({
        title: q.title,
        at: q.at ?? q.created ?? null,
        platforms: q.platforms ?? [],
        status: q.done ? 'posted' : Object.values(q.results ?? {}).some((r) => r?.error) ? 'error' : 'queued',
      }))
    return {
      at: new Date().toISOString(),
      core: { model: brainLabel ? brainLabel() : model, effort, writes },
      system: sys,
      channels: ch,
      pipelines: pipelines ? ['agency', 'youtube'].map((b) => pipelines.summary(b)) : [],
      autopilot: {
        enabled: Boolean(settings.enabled),
        niche: settings.niche ?? null,
        times: settings.times ?? [],
        queued: queue.filter((q) => !q.done).length,
        recent,
      },
      crypto: coins ?? [],
      weather: wx ?? null,
      security: sec ?? null,
      activity: activity(),
      agents: agents(),
    }
  }

  return { snapshot }
}
