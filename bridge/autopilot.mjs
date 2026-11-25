import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { safe } from './secrets.mjs'
import { ACCOUNT_RE, accountKey, withAccount } from './accounts.mjs'
import { MOODS, STYLES as FILM_STYLES } from './films.mjs'

/** A film channel's fixed look: same art style, character and sign-off on every film. */
const filmSettings = z
  .object({
    style: z.enum(FILM_STYLES),
    music: z.enum(MOODS).optional(),
    watermark: z.string().max(30).optional(),
    voice: z.string().regex(/^[abefhijpz][fm]_[a-z]+$/).optional(),
    hero: z
      .object({
        skin: z.string().max(20).optional(),
        hair: z.string().max(20).optional(),
        hairStyle: z.enum(['short', 'long', 'bald', 'cap', 'bun', 'spiky']).optional(),
        outfit: z.string().max(20).optional(),
        pants: z.string().max(20).optional(),
        accent: z.string().max(20).optional(),
      })
      .optional(),
    minutes: z.number().min(1).max(10).optional(),
  })
  .optional()
  .describe('For style "films": the art style, the hero character, music mood, watermark (channel name) and target length in minutes')

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
  review: false,
  feedback: [],
  lastRuns: {},
  channels: [],
}

/**
 * What makes a channel a channel rather than a feed: who it is for, its
 * recurring format, its look, its narrator and its sign-off. The brief holds
 * every video to these, so the uploads read as one show.
 */
export const IDENTITY = ['audience', 'format', 'visualStyle', 'voice', 'callToAction']
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]))

/** The channels the autopilot runs: the named ones, or the single main channel from the top-level settings. */
export function channelList(s) {
  // Named channels hold every video for the owner's OK unless told otherwise.
  if (s.channels?.length) return s.channels.map((c) => ({ enabled: true, accounts: {}, review: true, feedback: [], ...c }))
  return [
    {
      id: 'main',
      enabled: true,
      niche: s.niche,
      style: s.style,
      platforms: s.platforms,
      times: s.times,
      postsPerDayPerPlatform: s.postsPerDayPerPlatform,
      instructions: s.instructions,
      review: Boolean(s.review),
      feedback: s.feedback ?? [],
      ...pick(s, IDENTITY),
      ...(s.film ? { film: s.film } : {}),
      accounts: {},
    },
  ]
}

const STOP = new Set(['the', 'and', 'for', 'you', 'your', 'this', 'that', 'with', 'how', 'why', 'what', 'are', 'was', 'from', 'into', 'about', 'will', 'can', 'its', 'these', 'those', 'shorts'])
const titleWords = (t) => new Set(String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2 && !STOP.has(w)))
/** Share of meaningful words two titles have in common (0-1). */
export function titleOverlap(a, b) {
  const A = titleWords(a)
  const B = titleWords(b)
  if (!A.size || !B.size) return 0
  let both = 0
  for (const w of A) if (B.has(w)) both++
  return both / (A.size + B.size - both)
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
 *   probe?: ((path: string) => Promise<{ duration: number, width?: number, height?: number, hasAudio: boolean }>) | null,
 *   onReview?: ((item: object) => void) | null,
 *   runAgent: (prompt: string) => Promise<string>,
 * }} o
 */
export function createAutopilot({ workspace, allowWrites, checkPath, publishers, isConnected = () => true, probe = null, onReview = null, runAgent }) {
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
        // 'review' = waiting for the owner's OK (approve_scheduled_post).
        if (item.status === 'done' || item.status === 'cancelled' || item.status === 'review' || new Date(item.at) > new Date()) continue
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
      s.lastRuns[slotKey(c, slot)] = today()
      db.write('settings', s)
      await runChannel(c, c.id === 'main' ? slot : `${c.id} ${slot}`)
      return
    }
  }

  /** One unattended video run for a channel. Callers check `creating` first. */
  async function runChannel(c, name) {
    creating = true
    // runs.log: the console window is gone after a restart, this file is not.
    const log = (line) => {
      console.log(`[autopilot] ${line}`)
      try {
        appendFileSync(join(workspace, 'autopilot', 'runs.log'), `${new Date().toISOString()} ${line}\n`)
      } catch {
        /* logging must never stop a run */
      }
    }
    log(`creating the ${name} video`)
    try {
      const out = await runAgent(brief(c))
      log(`${name} run finished: ${String(out).replace(/s+/g, ' ').slice(0, 400)}`)
    } catch (e) {
      log(`${name} run failed: ${e?.stack ?? e}`)
    } finally {
      creating = false
    }
  }

  function brief(c) {
    if (c.style === 'films') return filmBrief(c)
    const products = db.read('products', []).filter((p) => p.active !== false)
    const named = c.id !== 'main'
    const recent = queue()
      .filter((q) => (q.channel ?? 'main') === c.id && q.status !== 'cancelled')
      .slice(-15)
      .map((q) => `- ${q.title}`)
    const liked = (c.feedback ?? []).filter((x) => x.kind === 'approved' && x.note).slice(-5)
    const disliked = (c.feedback ?? []).filter((x) => x.kind === 'rejected').slice(-6)
    const line = (label, v) => (v ? `${label}: ${v}\n` : '')
    return `AUTOPILOT RUN — nobody is listening; do not speak, just work.

Make ONE short vertical video for the ${named ? `"${c.id}" channel` : "user's channel"} and queue it. This is a real
channel with a real audience, not a content farm: one video a viewer is glad they watched beats
five forgettable ones. If you cannot make it good today, queue nothing and say why.

THE CHANNEL
${line('Niche', c.niche)}${line('Made for', c.audience)}${line('Recurring format', c.format)}${line('Look', c.visualStyle)}${line('Narrator voice (create_voiceover voice)', c.voice)}${line('Sign-off / call to action', c.callToAction)}Style: ${c.style === 'clips' ? "cut the best moment from the user's own footage in the workspace folder 'footage' (skip if empty and say so)" : c.style === 'both' ? "alternate: AI short today if the last queued post was a clip, otherwise a clip from the user's footage in 'footage'" : 'faceless short: script, narration, generated visuals, word-by-word captions'}
Platforms: ${(c.platforms ?? []).join(', ')}
${c.instructions ? `Standing instructions from the user: ${c.instructions}\n` : ''}${products.length ? `Products/links you may mention (at most one, only when it truly fits): ${products.map((p) => `${p.name} — ${p.link ?? 'link in bio'}`).join('; ')}\n` : ''}${recent.length ? `\nAlready made (do NOT repeat these topics or angles):\n${recent.join('\n')}\n` : ''}${liked.length ? `\nThe owner liked: ${liked.map((x) => x.note).join(' | ')}\n` : ''}${disliked.length ? `The owner turned these down, avoid the same mistakes: ${disliked.map((x) => `"${x.title}"${x.note ? ` (${x.note})` : ''}`).join(' | ')}\n` : ''}
STEPS
1. Topic. Look at what is working in the niche right now (search_youtube, web search) and pick
   ONE specific, surprising angle this channel has not covered. Specific beats general:
   "Why octopuses taste with their arms" beats "Amazing ocean facts".
2. Research. Get the facts from reliable sources (web search) and keep only what you can back up.
   No invented numbers, quotes or studies. If it is a story, it must be true or clearly framed as fiction.
3. Script, 25–50 seconds, written for the ear:
   - Hook in the first 2 seconds that makes a promise ("This fish can walk on land.").
   - Pay it off with 2–4 beats, each adding something new. Short sentences. No filler.
   - End with a twist, a payoff or a line that loops back to the start${c.callToAction ? ', then the sign-off' : ''}.
   Then reread it as a strict editor: cut every sentence that does not earn its place, make the
   hook sharper, check every fact. Rewrite once.
4. Visuals: 5–8 scenes with create_image, one per beat, all in the channel's look${c.visualStyle ? '' : ' (pick one consistent style and stick to it)'},
   each showing exactly what the narration says at that moment. No text, logos or brands in the
   images. Never use footage, music or images you were not given or did not generate.
5. Narrate with create_voiceover${c.voice ? ` (voice "${c.voice}")` : ''}, then render_short with the scenes timed to the beats.
6. Check the result with get_media_info before queueing: vertical, 15–60 seconds, has sound.
7. Queue it with create_scheduled_post${named ? ` (channel: "${c.id}")` : ''} for this channel's platforms at the next
   free slot. Title: honest and curiosity-driven, under 70 characters, no clickbait the video
   does not deliver. Captions written for each platform, with 3–5 specific hashtags.
   Mark brandOrganic if it promotes the user's own product.${c.review ? '\n   This channel holds every video for the owner to approve first; it will not post until they do.' : ''}
8. Finish with one line: what you made and when it will post.

Never post directly — only queue. Never use copyrighted music or footage you were not given.`
  }

  /** The faceless animated-story format: a researched true story, told scene by scene, drawn by make_film. */
  function filmBrief(c) {
    const named = c.id !== 'main'
    const f = c.film ?? {}
    const minutes = f.minutes ?? 2.5
    const voice = f.voice ?? c.voice
    const recent = queue()
      .filter((q) => (q.channel ?? 'main') === c.id && q.status !== 'cancelled')
      .slice(-20)
      .map((q) => `- ${q.title}`)
    const disliked = (c.feedback ?? []).filter((x) => x.kind === 'rejected').slice(-6)
    const liked = (c.feedback ?? []).filter((x) => x.kind === 'approved' && x.note).slice(-5)
    const others = (c.platforms ?? []).filter((p) => p !== 'youtube')
    const yt = (c.platforms ?? []).includes('youtube')
    const line = (label, v) => (v ? `${label}: ${v}\n` : '')
    const queueStep = [
      yt ? "the 16:9 film for youtube only, with thumbnail set to the film's thumbnail" : '',
      others.length ? `the 9:16 cut for ${others.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ')
    let n = 5
    const step = () => ++n
    return `AUTOPILOT RUN — nobody is listening; do not speak, just work.

Make ONE animated story film for the ${named ? `"${c.id}" channel` : "user's channel"} and queue it. This is the
faceless animated-channel format: a channel character, one art style, a true story told well. One
film a viewer finishes beats five they skip. If you cannot make it good today, queue nothing and say why.

THE CHANNEL
${line('Niche', c.niche)}${line('Made for', c.audience)}${line('Recurring format', c.format)}Art style (make_film style, the same on EVERY film): ${f.style ?? 'paper-cutout'}
Hero character (make_film hero, never change it): ${JSON.stringify(f.hero ?? {})}
Watermark: ${f.watermark ?? c.id}
Music mood: ${f.music ?? 'pick the mood that fits this story'}
${line('Narrator voice', voice)}${line('Sign-off / call to action', c.callToAction)}Platforms: ${(c.platforms ?? []).join(', ')}
${c.instructions ? `Standing instructions from the user: ${c.instructions}\n` : ''}${recent.length ? `\nAlready made (do NOT repeat these stories):\n${recent.join('\n')}\n` : ''}${liked.length ? `\nThe owner liked: ${liked.map((x) => x.note).join(' | ')}\n` : ''}${disliked.length ? `The owner turned these down, avoid the same mistakes: ${disliked.map((x) => `"${x.title}"${x.note ? ` (${x.note})` : ''}`).join(' | ')}\n` : ''}
STEPS
1. Demand first. search_youtube the niche and find OUTLIERS: videos with far more views than their
   channel has subscribers (a 3,000-subscriber channel with a 1M-view video). That proves people want
   the topic. Pick ONE specific story in that space this channel has not told. Never copy another
   channel's script, characters or art: same topic area, your own story, your own telling.
2. Research it from reliable sources (web search). Keep only facts you can back up; a true story stays
   true, invented details are not allowed. Note the 3-5 most surprising facts and any striking numbers.
3. Write it as ${Math.round(minutes * 12)}-${Math.round(minutes * 16)} scenes, ${Math.round(minutes * 140)}-${Math.round(minutes * 165)} words of narration (about ${minutes} minutes):
   - Scene 1: the hook, the most impossible fact or question, with a title card. No intro, no channel name.
   - Escalate: each scene adds something new; a turn or twist by the middle; a payoff near the end;
     a last line that makes the viewer think${c.callToAction ? ', then the sign-off' : ''}.
   - Each scene is one beat: 1-2 short sentences for the ear, plus what we SEE: a setting that fits,
     the hero's pose and expression acting out the line, 1-3 props that show what is said, a camera
     move on strong beats (push-in for tension, shake for shocks), big-number for any striking number
     (dates, days, money, distances), a transition between places. Something moves or appears every
     few seconds; vary settings and poses so no two scenes in a row look the same.
4. Reread it as a strict editor: is the hook strong, does every scene earn its place, is every fact
   backed up, does it flow when read aloud? Rewrite once.
5. make_film with that style, hero and watermark, aspect 16:9, the music mood${voice ? `, voice "${voice}"` : ''}. It takes a few
   minutes. Check it is ${Math.max(1, minutes - 1)}-${minutes + 1.5} minutes long and has sound (get_media_info).
${others.length ? `${step()}. For ${others.join(', ')}: make a second, 9:16 cut of the same story: its best 30-50 seconds as 8-12
   scenes (make_film, aspect 9:16, same style and hero), ending on a cliffhanger${yt ? ' and "full story on our channel"' : ''}.
` : ''}${step()}. Queue with create_scheduled_post${named ? ` (channel: "${c.id}")` : ''}: ${queueStep}.
   Title: the story's hook as a question or a promise, honest, under 70 characters. Description: two
   lines on what the story is, then 3-5 specific hashtags.${c.review ? '\n   This channel holds every film for the owner to approve first; it will not post until they do.' : ''}
${step()}. Finish with one line: what you made and when it will post.

Never post directly — only queue. Never use music, footage or art you were not given or did not make.`
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
      'The posting queue: upcoming, done and failed posts with per-platform results and links; status "review" means waiting for the owner to approve. Pass channel to see one channel only.',
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
      `Turn the autopilot on or off and set what it makes: niche, style (ai-shorts, clips, both, or films:
2-3 minute animated story films with the channel's own character, see jarvis_films),
platforms, local times to create a video (HH:MM, 24h), posts per platform per day (max ${HARD_CAP}),
and any standing instructions (tone, topics to avoid, call to action).`,
      {
        enabled: z.boolean().optional(),
        niche: z.string().max(300).optional(),
        style: z.enum(['ai-shorts', 'clips', 'both', 'films']).optional(),
        film: filmSettings,
        platforms: z.array(z.enum(PLATFORMS)).optional(),
        times: z.array(z.string().regex(/^\d\d:\d\d$/)).max(10).optional(),
        postsPerDayPerPlatform: z.number().int().min(1).max(HARD_CAP).optional(),
        instructions: z.string().max(2000).optional(),
        audience: z.string().max(300).optional().describe('Who the channel is for'),
        format: z.string().max(600).optional().describe('The recurring structure every video follows, e.g. "one myth, the truth, one practical tip"'),
        visualStyle: z.string().max(300).optional().describe('One consistent look, e.g. "moody cinematic photos, teal and orange"'),
        voice: z.string().regex(/^[abefhijpz][fm]_[a-z]+$/).optional().describe('Kokoro narrator, e.g. bm_george, bm_fable, am_michael, af_heart'),
        callToAction: z.string().max(200).optional(),
        review: z.boolean().optional().describe('Hold each video until the owner approves it'),
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
Give it an identity (audience, format, visualStyle, voice, callToAction) so it reads as one show.
New channels hold every video for the owner's approval (review); set review:false to post unattended.
Each channel needs a different niche: near-identical channels get flagged as mass-produced content.`,
      {
        id: z.string().regex(ACCOUNT_RE).describe('Short lowercase name, e.g. "cooking"'),
        remove: z.boolean().optional(),
        enabled: z.boolean().optional(),
        niche: z.string().min(3).max(300).optional(),
        style: z.enum(['ai-shorts', 'clips', 'both', 'films']).optional(),
        film: filmSettings,
        platforms: z.array(z.enum(PLATFORMS)).min(1).optional(),
        times: z.array(z.string().regex(/^\d\d:\d\d$/)).max(10).optional(),
        postsPerDayPerPlatform: z.number().int().min(1).max(HARD_CAP).optional(),
        instructions: z.string().max(2000).optional(),
        audience: z.string().max(300).optional().describe('Who the channel is for'),
        format: z.string().max(600).optional().describe('The recurring structure every video follows, e.g. "one myth, the truth, one practical tip"'),
        visualStyle: z.string().max(300).optional().describe('One consistent look, e.g. "moody cinematic photos, teal and orange"'),
        voice: z.string().regex(/^[abefhijpz][fm]_[a-z]+$/).optional().describe('Kokoro narrator, e.g. bm_george, bm_fable, am_michael, af_heart'),
        callToAction: z.string().max(200).optional(),
        review: z.boolean().optional().describe('Hold each video until the owner approves it'),
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
            : { id, enabled: true, style: 'ai-shorts', platforms: [...PLATFORMS], times: ['10:00'], postsPerDayPerPlatform: 1, instructions: '', review: true, feedback: [], accounts: {} }
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
        thumbnail: z.string().optional().describe('YouTube thumbnail image (JPG/PNG), e.g. the one make_film returns'),
        youtubePrivacy: z.enum(['public', 'unlisted', 'private']).optional(),
        brandOrganic: z.boolean().optional(),
        brandContent: z.boolean().optional(),
      },
      safe(async (p) => {
        const problem = checkPath(p.video) ?? (p.thumbnail ? checkPath(p.thumbnail) : null)
        if (problem) throw new Error(problem)
        if (!existsSync(p.video)) throw new Error('That video file does not exist.')
        const at = p.at ? new Date(p.at) : new Date()
        if (Number.isNaN(at.getTime())) throw new Error('at must be an ISO date/time.')
        const channel = channelOf(settings(), p.channel ?? 'main')
        if (!channel) throw new Error(`No channel called "${p.channel}". Add it with update_autopilot_channel first.`)
        const q = queue()
        // Originality: refuse a near-repeat of something this channel already made.
        const twin = q
          .filter((x) => (x.channel ?? 'main') === channel.id && x.status !== 'cancelled')
          .slice(-30)
          .find((x) => titleOverlap(x.title, p.title) >= 0.6)
        if (twin) throw new Error(`Too close to "${twin.title}", which this channel already made. Pick a different topic or angle.`)
        // Quality: the file has to be a watchable vertical short with sound.
        if (probe) {
          const m = await probe(p.video).catch(() => null)
          if (!m) throw new Error('Could not read that video file; render it again.')
          const wide = m.width && m.height && m.height < m.width
          if (!m.hasAudio) throw new Error('The video has no sound. Add the narration and render again.')
          if (wide) {
            // A regular (16:9) YouTube video: only YouTube takes those; the others need a vertical cut.
            if (p.platforms.some((x) => x !== 'youtube')) throw new Error('A 16:9 video can only go to YouTube. Make a 9:16 cut for the other platforms and queue it separately.')
            if (m.duration < 30 || m.duration > 900) throw new Error(`The video is ${m.duration.toFixed(0)} s long; a YouTube video here needs 30 s to 15 minutes.`)
          } else if (m.duration < 8 || m.duration > 180) throw new Error(`The video is ${m.duration.toFixed(0)} s long; shorts need 8-180 s (aim for 25-50).`)
        }
        const status = channel.review ? 'review' : 'queued'
        const item = { id: randomUUID().slice(0, 8), status, created: new Date().toISOString(), ...p, at: at.toISOString(), results: {} }
        q.push(item)
        db.write('queue', q)
        if (status === 'review') {
          try {
            onReview?.(item)
          } catch {}
        }
        return {
          queued: item.id,
          at: item.at,
          platforms: item.platforms,
          willPost: status === 'review' ? 'after the owner approves it' : allowWrites ? 'automatically' : 'when JARVIS runs with writes',
        }
      }),
    ),
    tool(
      'delete_scheduled_post',
      'Cancel a queued post by id (platforms it already went to are not affected). When the owner turns a video down, pass their reason as feedback: future videos for that channel avoid it.',
      { id: z.string(), feedback: z.string().max(300).optional() },
      safe(async ({ id, feedback }) => {
        const q = queue()
        const item = q.find((x) => x.id === id)
        if (!item) throw new Error('No queued post with that id.')
        const wasReview = item.status === 'review'
        item.status = 'cancelled'
        db.write('queue', q)
        if (wasReview || feedback) remember(item, 'rejected', feedback)
        return { cancelled: id, learned: Boolean(wasReview || feedback) }
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

  /** Keep the owner's verdicts per channel (last 12) so the brief learns their taste. */
  function remember(item, kind, note) {
    const s = settings()
    const entry = { kind, title: item.title, ...(note ? { note } : {}), at: today() }
    const id = item.channel ?? 'main'
    if (id === 'main' && !s.channels?.length) s.feedback = [...(s.feedback ?? []), entry].slice(-12)
    else {
      const c = (s.channels ?? []).find((x) => x.id === id)
      if (!c) return
      c.feedback = [...(c.feedback ?? []), entry].slice(-12)
    }
    db.write('settings', s)
  }

  // Only the owner, in a live session, can let a held video out.
  const approvals = [
    tool(
      'approve_scheduled_post',
      'Let a video that is waiting for review post. Only when the owner has watched it and said yes. Optional at (ISO) to post later; optional feedback on what they liked.',
      { id: z.string(), at: z.string().optional(), feedback: z.string().max(300).optional() },
      safe(async ({ id, at, feedback }) => {
        const q = queue()
        const item = q.find((x) => x.id === id)
        if (!item) throw new Error('No queued post with that id.')
        if (item.status !== 'review') throw new Error(`That post is ${item.status}, not waiting for review.`)
        if (at) {
          const d = new Date(at)
          if (Number.isNaN(d.getTime())) throw new Error('at must be an ISO date/time.')
          item.at = d.toISOString()
        }
        item.status = 'queued'
        item.approved = new Date().toISOString()
        db.write('queue', q)
        remember(item, 'approved', feedback)
        return { approved: id, at: item.at, platforms: item.platforms }
      }),
    ),
    tool(
      'run_channel_now',
      'Start a channel\'s next video right away instead of waiting for its scheduled time, when the owner asks. It runs in the background (a film takes 10-30 minutes) and goes through the same research, quality gate and queue as a scheduled run. Its scheduled slots still run.',
      { channel: z.string().optional() },
      safe(async ({ channel }) => {
        const s = settings()
        if (!s.enabled) throw new Error('The autopilot is off. Turn it on first.')
        const c = channelOf(s, channel ?? 'main')
        if (!c) throw new Error('No channel with that id.')
        if (!c.niche) throw new Error('That channel has no niche yet.')
        if (creating) throw new Error('A video is being made right now. Try again when it is done.')
        // It stands in for today's next unused slot, so the schedule does not
        // make a second video straight after it.
        const slot = (c.times ?? []).find((t) => s.lastRuns?.[slotKey(c, t)] !== today())
        if (slot) {
          s.lastRuns = { ...(s.lastRuns ?? {}), [slotKey(c, slot)]: today() }
          db.write('settings', s)
        }
        void runChannel(c, `${c.id} (on request)`)
        return { started: c.id, style: c.style, note: 'Running in the background. It will appear on http://localhost:8787/videos and in the queue when done.' }
      }),
    ),
  ]

  // One server instance per agent session, like the bridge's other servers.
  // Headless runs (live: false) never get the approval tool.
  const makeServer = ({ live = true } = {}) => createSdkMcpServer({
    name: 'jarvis_autopilot',
    version: '1.0.0',
    instructions:
      'The posting queue, the autopilot schedule, and the business ledger (products, affiliate links, brand deals). ' +
      'Posting to several platforms goes through create_scheduled_post. Selling or transferring social accounts is not supported: it breaks platform rules.',
    alwaysLoad: true,
    tools: allowWrites ? [...reads, ...writes, ...(live ? approvals : [])] : reads,
  })

  /** The brief a channel's next run would get (for tests and "what will you make next?"). */
  const briefFor = (id) => {
    const c = channelOf(settings(), id)
    return c ? brief(c) : null
  }

  return { makeServer, start, publishDue, briefFor }
}
