import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { safe } from './secrets.mjs'

/**
 * The autopilot: JARVIS running the channels while nobody is talking to him.
 *
 * Two loops, both inside the bridge and both only when it runs with --writes:
 *
 *   - the PUBLISHER checks the queue every minute and posts whatever is due
 *     to YouTube, TikTok and Instagram, within a per-platform daily cap;
 *   - the CREATOR wakes at the configured times, starts a headless JARVIS
 *     session with the content brief, and that session makes a video and
 *     queues it (it cannot bypass the queue or the caps).
 *
 * The caps exist because platforms throttle or shadow-ban accounts that post
 * like a bot. Defaults: 3 posts per platform per day, hard ceiling 10.
 *
 * Also keeps the business ledger: the user's products, affiliate links and
 * brand deals, so captions can carry the right link and nothing is forgotten.
 *
 * State lives in <workspace>/autopilot/*.json — plain files the user can read.
 */

const HARD_CAP = 10
const DEFAULTS = {
  enabled: false,
  niche: '',
  style: 'ai-shorts',
  platforms: ['youtube', 'tiktok', 'instagram'],
  times: ['09:00', '18:00'],
  postsPerDayPerPlatform: 3,
  instructions: '',
  lastRuns: {},
}

function store(dir) {
  mkdirSync(dir, { recursive: true })
  const file = (n) => join(dir, `${n}.json`)
  return {
    read(n, fallback) {
      try {
        return JSON.parse(readFileSync(file(n), 'utf8'))
      } catch {
        return structuredClone(fallback)
      }
    },
    write(n, v) {
      const tmp = file(n) + '.tmp'
      writeFileSync(tmp, JSON.stringify(v, null, 2))
      renameSync(tmp, file(n))
    },
  }
}

const today = () => new Date().toLocaleDateString('en-CA')
const hhmm = () => new Date().toTimeString().slice(0, 5)

/**
 * @param {{
 *   workspace: string,
 *   allowWrites: boolean,
 *   checkPath: (p: string) => string|null,
 *   publishers: Record<string, (item: object) => Promise<object>>,
 *   runAgent: (prompt: string) => Promise<string>,
 * }} o
 */
export function createAutopilot({ workspace, allowWrites, checkPath, publishers, runAgent }) {
  const db = store(join(workspace, 'autopilot'))
  const settings = () => ({ ...DEFAULTS, ...db.read('settings', DEFAULTS) })
  const queue = () => db.read('queue', [])

  function postedToday(platform) {
    return queue().filter((q) => q.results?.[platform]?.ok && q.results[platform].at?.startsWith(today())).length
  }

  let publishing = false
  async function publishDue() {
    if (publishing) return
    publishing = true
    try {
      const cap = Math.min(HARD_CAP, settings().postsPerDayPerPlatform)
      const items = queue()
      for (const item of items) {
        if (item.status === 'done' || item.status === 'cancelled' || new Date(item.at) > new Date()) continue
        item.results ??= {}
        for (const platform of item.platforms) {
          if (item.results[platform]?.ok) continue
          if ((item.results[platform]?.attempts ?? 0) >= 3) continue
          if (!publishers[platform]) {
            item.results[platform] = { ok: false, error: `${platform} is not connected`, attempts: 3 }
            continue
          }
          if (postedToday(platform) >= cap) continue // waits for tomorrow
          const problem = existsSync(item.video) ? checkPath(item.video) : 'video file is missing'
          if (problem) {
            item.results[platform] = { ok: false, error: problem, attempts: 3 }
            continue
          }
          try {
            const r = await publishers[platform](item)
            item.results[platform] = { ok: true, at: new Date().toISOString(), ...r }
            console.log(`[autopilot] posted "${item.title}" to ${platform}`)
          } catch (e) {
            const attempts = (item.results[platform]?.attempts ?? 0) + 1
            item.results[platform] = { ok: false, error: e.message, attempts }
            console.warn(`[autopilot] ${platform} failed (${attempts}/3): ${e.message}`)
          }
          db.write('queue', items)
        }
        const settled = item.platforms.every((p) => item.results[p]?.ok || (item.results[p]?.attempts ?? 0) >= 3)
        if (settled) item.status = 'done'
        db.write('queue', items)
      }
    } finally {
      publishing = false
    }
  }

  let creating = false
  async function createDue() {
    const s = settings()
    if (!s.enabled || creating || !s.niche) return
    const now = hhmm()
    const slot = s.times.find((t) => t <= now && s.lastRuns[t] !== today())
    if (!slot) return
    // Don't pile up videos the caps won't let out today.
    const pending = queue().filter((q) => q.status !== 'done' && q.status !== 'cancelled').length
    if (pending >= s.postsPerDayPerPlatform * 2) return
    creating = true
    s.lastRuns[slot] = today()
    db.write('settings', s)
    console.log(`[autopilot] creating the ${slot} video`)
    try {
      const out = await runAgent(brief(s))
      console.log(`[autopilot] ${slot} run finished: ${String(out).slice(0, 200)}`)
    } catch (e) {
      console.warn(`[autopilot] ${slot} run failed: ${e.message}`)
    } finally {
      creating = false
    }
  }

  function brief(s) {
    const products = db.read('products', []).filter((p) => p.active !== false)
    return `AUTOPILOT RUN — nobody is listening; do not speak, just work.

Make ONE short vertical video for the user's channels and queue it.

Niche: ${s.niche}
Style: ${s.style === 'clips' ? "cut the best moment from the user's own footage in the workspace folder 'footage' (skip if empty and say so)" : s.style === 'both' ? "alternate: AI short today if the last queued post was a clip, otherwise a clip from the user's footage in 'footage'" : 'AI faceless short: script, voiceover, generated visuals, word-by-word captions, music if available'}
Platforms: ${s.platforms.join(', ')}
${s.instructions ? `Extra instructions from the user: ${s.instructions}\n` : ''}${products.length ? `Products/links you may mention (at most one, only when relevant): ${products.map((p) => `${p.name} — ${p.link ?? 'link in bio'}`).join('; ')}\n` : ''}
Steps:
1. Check what performed best recently (YouTube analytics, TikTok and Instagram lists) and
   what is trending in the niche (search_youtube). Pick an angle that has not been done in the
   last 10 queued posts (list_queue).
2. Write a 20–45 second script with a hook in the first two seconds.
3. Build it with the studio tools (create_voiceover, image generation from any available
   generation server, render_short) — or render_clip for footage.
4. Queue it with create_scheduled_post for all platforms at the next free slot, with a
   platform-appropriate caption and 3–6 relevant hashtags. YouTube title under 70 characters.
   Mark brandOrganic if it promotes the user's own product.
5. Finish with one line: what you made and when it will post.

Never post directly — only queue. Never use copyrighted music or footage you were not given.`
  }

  let timer = null
  function start() {
    if (!allowWrites || timer) return
    timer = setInterval(() => {
      void publishDue()
      void createDue()
    }, 60_000)
    timer.unref?.()
    setTimeout(() => void publishDue(), 5_000).unref?.()
  }

  const reads = [
    tool(
      'get_autopilot_settings',
      'The autopilot configuration: whether it is on, niche, style, platforms, daily times and caps, plus how many posts went out today.',
      {},
      safe(async () => {
        const s = settings()
        return {
          ...s,
          running: Boolean(timer),
          postedToday: Object.fromEntries(s.platforms.map((p) => [p, postedToday(p)])),
          connected: Object.keys(publishers),
          note: allowWrites ? undefined : 'Autopilot only runs when JARVIS is started with writes.',
        }
      }),
    ),
    tool(
      'list_queue',
      'The posting queue: upcoming, done and failed posts with per-platform results and links.',
      { includeDone: z.boolean().optional().catch(undefined) },
      safe(async ({ includeDone = true }) => queue().filter((q) => includeDone || q.status !== 'done').slice(-30)),
    ),
    tool('list_products', "The user's products and affiliate links available to promote.", {}, safe(async () => db.read('products', []))),
    tool('list_brand_deals', 'Brand sponsorship deals and their status, fees and deadlines.', {}, safe(async () => db.read('deals', []))),
  ]

  const writes = [
    tool(
      'update_autopilot_settings',
      `Turn the autopilot on or off and set what it makes: niche, style (ai-shorts, clips, both),
platforms, local times to create a video (HH:MM, 24h), posts per platform per day (max ${HARD_CAP}),
and any standing instructions (tone, topics to avoid, call to action).`,
      {
        enabled: z.boolean().optional(),
        niche: z.string().max(300).optional(),
        style: z.enum(['ai-shorts', 'clips', 'both']).optional(),
        platforms: z.array(z.enum(['youtube', 'tiktok', 'instagram'])).optional(),
        times: z.array(z.string().regex(/^\d\d:\d\d$/)).max(10).optional(),
        postsPerDayPerPlatform: z.number().int().min(1).max(HARD_CAP).optional(),
        instructions: z.string().max(2000).optional(),
      },
      safe(async (patch) => {
        const s = { ...settings(), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) }
        if (s.enabled && !s.niche) throw new Error('Set a niche before turning the autopilot on.')
        db.write('settings', s)
        return { saved: true, ...s }
      }),
    ),
    tool(
      'create_scheduled_post',
      `Queue a finished video to post to one or more platforms at a time (ISO 8601; omit for "as soon
as the daily cap allows"). Give one caption, or per-platform captions. youtubeTitle is required
for YouTube. The publisher posts it automatically and respects the daily caps.`,
      {
        video: z.string(),
        title: z.string().max(100),
        platforms: z.array(z.enum(['youtube', 'tiktok', 'instagram'])).min(1),
        at: z.string().optional(),
        caption: z.string().max(2200).optional(),
        captions: z.object({ youtube: z.string().max(5000).optional(), tiktok: z.string().max(2200).optional(), instagram: z.string().max(2200).optional() }).optional(),
        tags: z.array(z.string()).max(30).optional(),
        youtubePrivacy: z.enum(['public', 'unlisted', 'private']).optional(),
        brandOrganic: z.boolean().optional(),
        brandContent: z.boolean().optional(),
      },
      safe(async (p) => {
        const problem = checkPath(p.video)
        if (problem) throw new Error(problem)
        if (!existsSync(p.video)) throw new Error('That video file does not exist.')
        const at = p.at ? new Date(p.at) : new Date()
        if (Number.isNaN(at.getTime())) throw new Error('at must be an ISO date/time.')
        const item = { id: randomUUID().slice(0, 8), status: 'queued', created: new Date().toISOString(), ...p, at: at.toISOString(), results: {} }
        const q = queue()
        q.push(item)
        db.write('queue', q)
        return { queued: item.id, at: item.at, platforms: item.platforms, willPost: allowWrites ? 'automatically' : 'when JARVIS runs with writes' }
      }),
    ),
    tool(
      'delete_scheduled_post',
      'Cancel a queued post by id (platforms it already went to are not affected).',
      { id: z.string() },
      safe(async ({ id }) => {
        const q = queue()
        const item = q.find((x) => x.id === id)
        if (!item) throw new Error('No queued post with that id.')
        item.status = 'cancelled'
        db.write('queue', q)
        return { cancelled: id }
      }),
    ),
    tool(
      'update_products',
      "Add or change a product or affiliate link the user sells (matched by name). Set active:false to stop promoting it.",
      {
        name: z.string(),
        kind: z.enum(['own', 'affiliate']).optional(),
        price: z.string().optional(),
        link: z.string().url().optional(),
        cryptoChain: z.enum(['eth', 'base', 'btc', 'sol']).optional().describe('Accept crypto for it via get_crypto_invoice'),
        notes: z.string().max(500).optional(),
        active: z.boolean().optional(),
      },
      safe(async (p) => {
        const list = db.read('products', [])
        const i = list.findIndex((x) => x.name.toLowerCase() === p.name.toLowerCase())
        const merged = { ...(list[i] ?? {}), ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) }
        if (i >= 0) list[i] = merged
        else list.push(merged)
        db.write('products', list)
        return merged
      }),
    ),
    tool(
      'update_brand_deal',
      'Add or update a brand sponsorship (matched by brand): status lead/pitched/negotiating/signed/delivered/paid, fee, deliverables, due date, contact.',
      {
        brand: z.string(),
        status: z.enum(['lead', 'pitched', 'negotiating', 'signed', 'delivered', 'paid', 'lost']).optional(),
        fee: z.string().optional(),
        deliverables: z.string().max(1000).optional(),
        due: z.string().optional(),
        contact: z.string().optional(),
        notes: z.string().max(1000).optional(),
      },
      safe(async (p) => {
        const list = db.read('deals', [])
        const i = list.findIndex((x) => x.brand.toLowerCase() === p.brand.toLowerCase())
        const merged = { ...(list[i] ?? {}), ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)), updated: today() }
        if (i >= 0) list[i] = merged
        else list.push(merged)
        db.write('deals', list)
        return merged
      }),
    ),
  ]

  // One server instance per agent session, like the bridge's other servers.
  const makeServer = () => createSdkMcpServer({
    name: 'jarvis_autopilot',
    version: '1.0.0',
    instructions:
      'The posting queue, the autopilot schedule, and the business ledger (products, affiliate links, brand deals). ' +
      'Posting to several platforms goes through create_scheduled_post. Selling or transferring social accounts is not supported: it breaks platform rules.',
    alwaysLoad: true,
    tools: allowWrites ? [...reads, ...writes] : reads,
  })

  return { makeServer, start, publishDue }
}
