import { readFileSync } from 'node:fs'
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

  async function snapshot() {
    const [sys, coins, ch] = await Promise.all([system(), crypto(), channels()])
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
    }
  }

  return { snapshot }
}
