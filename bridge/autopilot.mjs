import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { safe } from './secrets.mjs'
import { ACCOUNT_RE, accountKey, withAccount } from './accounts.mjs'

/**
 * The autopilot: JARVIS running the channels while nobody is talking to him.
 *
 * Two loops, both inside the bridge and both only when it runs with --writes:
 *
 *   - the PUBLISHER checks the queue every minute and posts whatever is due
 *     to YouTube, TikTok, Instagram and Facebook, within a per-platform daily cap;
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
 * Channels: with no channels set up, it runs one channel ("main") from the
 * top-level settings and the main account on each platform. Up to 5 named
 * channels can be added (update_autopilot_channel), each with its own niche,
 * times, platforms, cap and accounts. A channel's account on a platform
 * defaults to the account with the channel's own name (tiktok@cooking for the
 * "cooking" channel), connected with `--account cooking`.
 *
 * State lives in <workspace>/autopilot/*.json — plain files the user can read.
 */

const HARD_CAP = 10
export const MAX_CHANNELS = 5
export const PLATFORMS = ['youtube', 'tiktok', 'instagram', 'facebook']
// YouTube's default API quota is 10,000 units a day per Google project and an
// upload costs about 1,600, so about 6 uploads a day across every channel.
const YOUTUBE_DAILY_UPLOADS = Math.max(1, Number(process.env.JARVIS_YOUTUBE_DAILY_UPLOADS) || 6)
const DEFAULTS = {
  enabled: false,
  niche: '',
  style: 'ai-shorts',
  platforms: ['youtube', 'tiktok', 'instagram'],
  times: ['09:00', '18:00'],
  postsPerDayPerPlatform: 3,
  instructions: '',
  lastRuns: {},
  channels: [],
}

/** The channels the autopilot runs: the named ones, or the single main channel from the top-level settings. */
export function channelList(s) {
  if (s.channels?.length) return s.channels.map((c) => ({ enabled: true, accounts: {}, ...c }))
  return [{ id: 'main', enabled: true, niche: s.niche, style: s.style, platforms: s.platforms, times: s.times, postsPerDayPerPlatform: s.postsPerDayPerPlatform, instructions: s.instructions, accounts: {} }]
}

/** Which account a channel posts to on a platform: an explicit choice, else the channel's own name, else main. */
export function channelAccount(channel, platform) {
  const pick = channel?.accounts?.[platform]
  if (pick) return accountKey(pick)
  return !channel || channel.id === 'main' ? null : channel.id
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
 *   isConnected?: (platform: string, account: string|null) => boolean,
 *   runAgent: (prompt: string) => Promise<string>,
 * }} o
 */
export function createAutopilot({ workspace, allowWrites, checkPath, publishers, isConnected = () => true, runAgent }) {
  const db = store(join(workspace, 'autopilot'))
  const settings = () => ({ ...DEFAULTS, ...db.read('settings', DEFAULTS) })
  const queue = () => db.read('queue', [])
  const channelOf = (s, id = 'main') => channelList(s).find((c) => c.id === id) ?? null

  const isToday = (iso) => Boolean(iso) && new Date(iso).toLocaleDateString('en-CA') === today()
  /** Posts that went out today on a platform; for one channel when channelId is given. */
  function postedToday(platform, channelId) {
    return queue().filter((q) => q.results?.[platform]?.ok && isToday(q.results[platform].at) && (channelId === undefined || (q.channel ?? 'main') === channelId)).length
  }

  let publishing = false
  async function publishDue() {
    if (publishing) return
    publishing = true
    try {
      const s = settings()
      const items = queue()
      for (const item of items) {
        if (item.status === 'done' || item.status === 'cancelled' || new Date(item.at) > new Date()) continue
        item.results ??= {}
        const channel = channelOf(s, item.channel ?? 'main')
        const cap = Math.min(HARD_CAP, channel?.postsPerDayPerPlatform ?? s.postsPerDayPerPlatform)
        for (const platform of item.platforms) {
          if (item.results[platform]?.ok) continue
          if ((item.results[platform]?.attempts ?? 0) >= 3) continue
          const account = channelAccount(channel, platform)
          const label = account ? `${platform} account "${account}"` : platform
          if (!publishers[platform] || !isConnected(platform, account)) {
            // Not a failure: the video waits and posts once the platform is connected.
            item.results[platform] = { ok: false, error: `${label} is not connected yet; it will post once it is`, attempts: 0 }
            continue
          }
          if (postedToday(platform, item.channel ?? 'main') >= cap) continue // waits for tomorrow
          if (platform === 'youtube' && postedToday('youtube') >= YOUTUBE_DAILY_UPLOADS) continue // daily API quota, all channels
          const problem = existsSync(item.video) ? checkPath(item.video) : 'video file is missing'
          if (problem) {
            item.results[platform] = { ok: false, error: problem, attempts: 3 }
            continue
          }
          try {
            const r = await withAccount(account, () => publishers[platform](item))
            item.results[platform] = { ok: true, at: new Date().toISOString(), ...(account ? { account } : {}), ...r }
            console.log(`[autopilot] posted "${item.title}" to ${label}`)
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
  /** Run key for a channel's time slot. The main channel keeps the old plain "HH:MM" keys. */
  const slotKey = (c, t) => (c.id === 'main' ? t : `${c.id}@${t}`)

  async function createDue() {
    const s = settings()
    if (!s.enabled || creating) return
    const now = hhmm()
    // One video at a time, the first channel whose slot is due.
    for (const c of channelList(s)) {
      if (!c.enabled || !c.niche) continue
      const slot = (c.times ?? []).find((t) => t <= now && s.lastRuns[slotKey(c, t)] !== today())
      if (!slot) continue
      // Don't pile up videos the caps won't let out today.
      const pending = queue().filter((q) => (q.channel ?? 'main') === c.id && q.status !== 'done' && q.status !== 'cancelled').length
      if (pending >= (c.postsPerDayPerPlatform ?? s.postsPerDayPerPlatform) * 2) continue
      creating = true
      s.lastRuns[slotKey(c, slot)] = today()
      db.write('settings', s)
      const name = c.id === 'main' ? slot : `${c.id} ${slot}`
      console.log(`[autopilot] creating the ${name} video`)
      try {
        const out = await runAgent(brief(c))
        console.log(`[autopilot] ${name} run finished: ${String(out).slice(0, 200)}`)
      } catch (e) {
        console.warn(`[autopilot] ${name} run failed: ${e.message}`)
      } finally {
        creating = false
      }
      return
    }
  }

  function brief(c) {
    const products = db.read('products', []).filter((p) => p.active !== false)
    const named = c.id !== 'main'
    return `AUTOPILOT RUN — nobody is listening; do not speak, just work.

Make ONE short vertical video for the ${named ? `"${c.id}" channel` : "user's channels"} and queue it.

${named ? `Channel: ${c.id} (one of several channels the user runs; each has its own audience and niche)
` : ''}Niche: ${c.niche}
Style: ${c.style === 'clips' ? "cut the best moment from the user's own footage in the workspace folder 'footage' (skip if empty and say so)" : c.style === 'both' ? "alternate: AI short today if the last queued post was a clip, otherwise a clip from the user's footage in 'footage'" : 'AI faceless short: script, voiceover, generated visuals, word-by-word captions, music if available'}
Platforms: ${(c.platforms ?? []).join(', ')}
${c.instructions ? `Extra instructions from the user: ${c.instructions}
` : ''}${products.length ? `Products/links you may mention (at most one, only when relevant): ${products.map((p) => `${p.name} — ${p.link ?? 'link in bio'}`).join('; ')}
` : ''}
Steps:
1. Check what is trending in the niche (search_youtube) and what this channel already made
   (list_queue${named ? ` with channel "${c.id}"` : ''}). ${named ? 'The analytics tools read the main accounts only, so judge this channel by its queue.' : 'Check what performed best recently (YouTube analytics, TikTok and Instagram lists).'}
   Pick an angle that has not been done in the last 10 queued posts.
2. Write a 20–45 second script with a hook in the first two seconds. It must be genuinely
   useful or entertaining on its own: a real fact, story or tip, not filler. Platforms refuse
   to pay mass-produced, repetitive videos, so vary the format, visuals and voice of each post.
3. Build it with the studio tools: create_image for each scene (4-8 scenes, consistent style),
   create_voiceover (free, on this laptop), then render_short; or render_clip for footage.
4. Queue it with create_scheduled_post${named ? ` (channel: "${c.id}")` : ''} for all of this channel's platforms at the
   next free slot, with a platform-appropriate caption and 3–6 relevant hashtags. YouTube
   title under 70 characters. Mark brandOrganic if it promotes the user's own product.
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
      'The autopilot configuration: whether it is on, and each channel (niche, style, platforms, daily times, caps, accounts) with how many posts went out today and which accounts are connected.',
      {},
      safe(async () => {
        const s = settings()
        const channels = channelList(s).map((c) => ({
          ...c,
          accounts: Object.fromEntries(
            (c.platforms ?? []).map((p) => {
              const a = channelAccount(c, p)
              return [p, { account: a ?? 'main', connected: Boolean(publishers[p]) && isConnected(p, a) }]
            }),
          ),
          postedToday: Object.fromEntries((c.platforms ?? []).map((p) => [p, postedToday(p, c.id)])),
        }))
        return {
          ...s,
          channels,
          maxChannels: MAX_CHANNELS,
          youtubeUploadsToday: `${postedToday('youtube')}/${YOUTUBE_DAILY_UPLOADS} (API quota, all channels)`,
          running: Boolean(timer),
          connected: Object.keys(publishers),
          note: allowWrites ? undefined : 'Autopilot only runs when JARVIS is started with writes.',
        }
      }),
    ),
    tool(
      'list_queue',
      'The posting queue: upcoming, done and failed posts with per-platform results and links. Pass channel to see one channel only.',
      { includeDone: z.boolean().optional().catch(undefined), channel: z.string().optional().catch(undefined) },
      safe(async ({ includeDone = true, channel }) =>
        queue()
          .filter((q) => (includeDone || q.status !== 'done') && (!channel || (q.channel ?? 'main') === channel))
          .slice(-30),
      ),
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
        platforms: z.array(z.enum(PLATFORMS)).optional(),
        times: z.array(z.string().regex(/^\d\d:\d\d$/)).max(10).optional(),
        postsPerDayPerPlatform: z.number().int().min(1).max(HARD_CAP).optional(),
        instructions: z.string().max(2000).optional(),
      },
      safe(async (patch) => {
        const s = { ...settings(), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) }
        if (s.enabled && !channelList(s).some((c) => c.enabled && c.niche)) {
          throw new Error('Set a niche (or add a channel with one) before turning the autopilot on.')
        }
        db.write('settings', s)
        return { saved: true, ...s }
      }),
    ),
    tool(
      'update_autopilot_channel',
      `Add, change or remove one of the user's channels (up to ${MAX_CHANNELS}). Each channel has its own niche, style,
platforms (youtube, tiktok, instagram, facebook), creation times (HH:MM, 24h), posts per platform per day
(max ${HARD_CAP}), instructions and accounts. By default a channel posts with the accounts named after it
(connected with --account <id>); set accounts to use others, e.g. { "youtube": "main" }.
Each channel needs a different niche: near-identical channels get flagged as mass-produced content.`,
      {
        id: z.string().regex(ACCOUNT_RE).describe('Short lowercase name, e.g. "cooking"'),
        remove: z.boolean().optional(),
        enabled: z.boolean().optional(),
        niche: z.string().min(3).max(300).optional(),
        style: z.enum(['ai-shorts', 'clips', 'both']).optional(),
        platforms: z.array(z.enum(PLATFORMS)).min(1).optional(),
        times: z.array(z.string().regex(/^\d\d:\d\d$/)).max(10).optional(),
        postsPerDayPerPlatform: z.number().int().min(1).max(HARD_CAP).optional(),
        instructions: z.string().max(2000).optional(),
        accounts: z.record(z.enum(PLATFORMS), z.string().regex(ACCOUNT_RE)).optional(),
      },
      safe(async ({ id, remove, ...patch }) => {
        if (id === 'main') throw new Error('"main" is the default channel; set it with update_autopilot_settings.')
        const s = settings()
        const list = [...(s.channels ?? [])]
        const i = list.findIndex((c) => c.id === id)
        if (remove) {
          if (i < 0) throw new Error(`No channel called "${id}".`)
          list.splice(i, 1)
          db.write('settings', { ...s, channels: list })
          return { removed: id, channels: list.map((c) => c.id) }
        }
        if (i < 0 && list.length >= MAX_CHANNELS) throw new Error(`There are already ${MAX_CHANNELS} channels; remove one first.`)
        const base =
          i >= 0
            ? list[i]
            : { id, enabled: true, style: 'ai-shorts', platforms: [...PLATFORMS], times: ['10:00'], postsPerDayPerPlatform: 1, instructions: '', accounts: {} }
        const next = { ...base, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), id }
        if (!next.niche) throw new Error('A new channel needs a niche.')
        const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
        const twin = list.find((c) => c.id !== id && c.niche && norm(c.niche) === norm(next.niche))
        if (twin) throw new Error(`The "${twin.id}" channel already has that niche. Give each channel its own audience.`)
        if (i >= 0) list[i] = next
        else list.push(next)
        db.write('settings', { ...s, channels: list })
        return { saved: true, channel: next, accountsUsed: Object.fromEntries(next.platforms.map((p) => [p, channelAccount(next, p) ?? 'main'])) }
      }),
    ),
    tool(
      'create_scheduled_post',
      `Queue a finished video to post to one or more platforms at a time (ISO 8601; omit for "as soon
as the daily cap allows"). Give one caption, or per-platform captions. youtubeTitle is required
for YouTube. Set channel to post with that channel's accounts (default: the main channel).
The publisher posts it automatically and respects the daily caps.`,
      {
        video: z.string(),
        title: z.string().max(100),
        channel: z.string().regex(ACCOUNT_RE).optional(),
        platforms: z.array(z.enum(PLATFORMS)).min(1),
        at: z.string().optional(),
        caption: z.string().max(2200).optional(),
        captions: z
          .object({
            youtube: z.string().max(5000).optional(),
            tiktok: z.string().max(2200).optional(),
            instagram: z.string().max(2200).optional(),
            facebook: z.string().max(2200).optional(),
          })
          .optional(),
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
        if (p.channel && p.channel !== 'main' && !channelOf(settings(), p.channel)) {
          throw new Error(`No channel called "${p.channel}". Add it with update_autopilot_channel first.`)
        }
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
