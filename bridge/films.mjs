import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { safe } from './secrets.mjs'
import { FFMPEG, KOKORO_DEFAULT_VOICE, kokoro, probe, run, slug, speechSpan, stamp, timeWords, wavBuffer } from './studio.mjs'

/**
 * Animated story films: the "faceless animated channel" format. A story is
 * written as scenes (data, not code); films/ (Remotion) draws them in one of
 * eight art styles with the channel's own character, and this module adds the
 * Kokoro narration, word-timed subtitles, sound effects on every action and a
 * music bed ducked under the voice. Everything is made on this laptop for free.
 *
 * The lists below must match films/src/types.ts (a test checks).
 */

export const FILMS_DIR = fileURLToPath(new URL('../films/', import.meta.url))
export const filmsInstalled = () => existsSync(join(FILMS_DIR, 'node_modules', 'remotion'))

export const STYLES = ['paper-cutout', 'pixel-art', 'ink-wash', 'retro-cartoon', 'clay', 'chalkboard', 'flat-vector', 'neon-night']
export const POSES = ['stand', 'walk', 'run', 'sit', 'think', 'shock', 'celebrate', 'sad', 'point', 'wave', 'sleep', 'talk']
export const EXPRESSIONS = ['neutral', 'happy', 'sad', 'angry', 'scared', 'surprised', 'sleepy']
export const SETTINGS = ['plain', 'city', 'room', 'office', 'forest', 'island', 'ocean', 'desert', 'mountains', 'space', 'road', 'village', 'cave', 'school']
export const PROPS = [
  'tree', 'palm', 'rock', 'house', 'building', 'boat', 'raft', 'phone', 'money', 'coin',
  'clock', 'fire', 'cloud', 'sun', 'moon', 'star', 'arrow', 'question', 'exclaim', 'heart',
  'skull', 'chart-up', 'chart-down', 'crate', 'car', 'bottle', 'book', 'lightbulb', 'sign',
  'map', 'key', 'door', 'bed', 'desk', 'computer', 'coffee', 'trophy', 'warning', 'zzz',
  'lightning', 'fish', 'bird', 'tent', 'flag', 'gem', 'bag', 'calendar', 'rocket', 'planet',
]
export const SOUNDS = ['whoosh', 'pop', 'thud', 'ding', 'boom', 'tick', 'rise', 'sparkle', 'sad', 'click']
export const MOODS = ['calm', 'mystery', 'tense', 'upbeat', 'sad', 'none']

/** Synthesised sound effects (ffmpeg lavfi), made once and cached. No samples, no licences. */
const SFX = {
  whoosh: ['anoisesrc=d=0.6:c=pink:a=0.7', 'bandpass=f=900:width_type=h:w=1400,afade=t=in:d=0.3,afade=t=out:st=0.3:d=0.3,volume=1.6'],
  pop: ["aevalsrc='0.8*sin(2*PI*(950-750*t/0.12)*t)*exp(-t*32)':d=0.16", 'volume=1'],
  thud: ["aevalsrc='0.95*sin(2*PI*(120-70*t)*t)*exp(-t*11)':d=0.45", 'lowpass=f=400'],
  ding: ["aevalsrc='0.45*(sin(2*PI*1320*t)+0.5*sin(2*PI*2640*t)+0.25*sin(2*PI*3960*t))*exp(-t*3.5)':d=1.3", 'volume=1'],
  boom: ["aevalsrc='0.95*sin(2*PI*(68-32*t)*t)*exp(-t*3)':d=1.6", 'lowpass=f=300,volume=1.4'],
  tick: ["aevalsrc='0.6*sin(2*PI*2200*t)*exp(-t*140)':d=0.07", 'volume=1'],
  rise: ["aevalsrc='0.32*sin(2*PI*(180+520*t*t)*t)*min(1,t*2)*(1-t/1.1)':d=1.1", 'volume=1'],
  sparkle: ["aevalsrc='0.25*sin(2*PI*(1700+500*sin(38*t))*t)*exp(-t*2.8)+0.15*sin(2*PI*2600*t)*exp(-t*5)':d=0.9", 'volume=1'],
  sad: ["aevalsrc='0.3*sin(2*PI*(392-150*t)*t)*exp(-t*1.4)':d=1.3", 'lowpass=f=1500'],
  click: ["aevalsrc='0.7*sin(2*PI*1500*t)*exp(-t*220)':d=0.05", 'volume=1'],
}

/** A soft pad that changes chord every 8 s; tense and upbeat add a pulse. */
function musicExpr(mood) {
  const seg = 'mod(t,32)'
  const pick = (a, b, c, d) => `if(lt(${seg},8),${a},if(lt(${seg},16),${b},if(lt(${seg},24),${c},${d})))`
  const env = 'min(1,min(mod(t,8)*3,(8-mod(t,8))*3))'
  const pad = (r1, r2, r3) => `(sin(2*PI*${r1}*t)+0.8*sin(2*PI*${r2}*t)+0.6*sin(2*PI*${r3}*t)+0.3*sin(2*PI*${r1}*2*t))`
  switch (mood) {
    case 'mystery':
      return `0.07*${env}*${pick(pad(110, 130.8, 164.8), pad(87.3, 110, 130.8), pad(130.8, 164.8, 196), pad(98, 123.5, 146.8))}*(0.8+0.2*sin(2*PI*0.2*t))`
    case 'sad':
      return `0.07*${env}*${pick(pad(110, 130.8, 164.8), pad(98, 116.5, 146.8), pad(87.3, 110, 130.8), pad(82.4, 98, 123.5))}`
    case 'tense':
      return `0.06*(sin(2*PI*55*t)+0.6*sin(2*PI*82.4*t)+0.4*sin(2*PI*58.3*t))*(0.6+0.4*abs(sin(2*PI*1*t)))`
    case 'upbeat':
      return `0.05*${env}*${pick(pad(130.8, 164.8, 196), pad(110, 130.8, 164.8), pad(87.3, 110, 130.8), pad(98, 123.5, 146.8))}+0.05*sin(2*PI*${pick(523, 440, 349, 392)}*t)*exp(-mod(t,0.25)*14)`
    default:
      return `0.065*${env}*${pick(pad(110, 138.6, 164.8), pad(92.5, 110, 138.6), pad(73.4, 92.5, 110), pad(82.4, 103.8, 123.5))}*(0.85+0.15*sin(2*PI*0.15*t))`
  }
}

/** Sound effects that follow from what happens on screen, so every action has a sound. */
export function autoSfx(scenes) {
  const out = []
  let at = 0
  for (const [i, sc] of scenes.entries()) {
    if (i > 0 && (sc.transition ?? 'cut') !== 'cut') out.push({ sound: 'whoosh', at: Math.max(0, at - 0.3) })
    if (sc.camera === 'shake') out.push({ sound: 'boom', at })
    if (sc.text) {
      const t = at + (sc.text.at ?? 0)
      const kind = sc.text.kind ?? 'caption'
      out.push({ sound: kind === 'title' ? 'ding' : kind === 'big-number' ? 'rise' : 'click', at: t })
    }
    for (const p of sc.props ?? []) {
      const t = at + (p.at ?? 0)
      const e = p.enter ?? 'pop'
      if (e === 'pop') out.push({ sound: 'pop', at: t })
      else if (e === 'drop') out.push({ sound: 'thud', at: t + 0.3 })
      else if (e === 'slide') out.push({ sound: 'whoosh', at: t })
    }
    for (const a of sc.actors ?? []) {
      if (a.pose === 'shock') out.push({ sound: 'rise', at })
      if (a.pose === 'celebrate') out.push({ sound: 'sparkle', at })
      if (a.pose === 'sad') out.push({ sound: 'sad', at })
      if (a.enter && a.enter !== 'none') out.push({ sound: a.enter === 'drop' ? 'thud' : a.enter === 'slide' ? 'whoosh' : 'pop', at })
    }
    for (const s of sc.sfx ?? []) out.push({ sound: s.sound, at: at + (s.at ?? 0) })
    at += sc.seconds
  }
  // Two of the same sound within 0.15 s is one sound.
  return out
    .sort((a, b) => a.at - b.at)
    .filter((s, i, all) => !all.slice(0, i).some((o) => o.sound === s.sound && Math.abs(o.at - s.at) < 0.15))
}

const DEFAULT_HERO = { skin: '#f1c7a3', hair: '#3b2a20', hairStyle: 'short', outfit: '#3f7cc4', pants: '#2f3b52', accent: '#f2c14e' }
const DEFAULT_OTHER = { skin: '#c98f68', hair: '#1d1d1d', hairStyle: 'bun', outfit: '#d9534f', pants: '#3b3b3b', accent: '#ffffff' }

function runFilmRenderer(args, onProgress) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [join(FILMS_DIR, 'render.mjs'), ...args], { cwd: FILMS_DIR, windowsHide: true })
    let err = ''
    let last = null
    p.stdout.on('data', (d) => {
      for (const line of String(d).split('\n')) {
        try {
          const j = JSON.parse(line)
          if (j.progress !== undefined) onProgress?.(j.progress)
          if (j.done) last = j
        } catch {
          /* not a progress line */
        }
      }
    })
    p.stderr.on('data', (d) => (err = (err + d).slice(-3000)))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 && last ? resolve(last) : reject(new Error(`The film renderer failed: ${err.split('\n').filter(Boolean).slice(-3).join(' ')}`))))
  })
}

/**
 * Narrate, time, draw and mix one film. Returns the finished MP4 and a thumbnail.
 * @param {object} spec  the make_film input
 * @param {{ workspace: string, onProgress?: (p: number) => void }} o
 */
export async function makeFilm(spec, { workspace, onProgress }) {
  if (!filmsInstalled()) throw new Error('The film renderer is not installed. Run: cd films && npm install')
  const dir = join(workspace, 'studio', `${stamp()}-${slug(spec.title)}`)
  await mkdir(dir, { recursive: true })
  const voice = /^[abefhijpz][fm]_[a-z]+$/.test(spec.voice ?? '') ? spec.voice : KOKORO_DEFAULT_VOICE
  const speed = spec.speed ?? 1
  const LEAD = 0.25
  const TAIL = 0.45

  // 1. Narration, scene by scene: each scene lasts as long as its words (or its own seconds).
  const needsVoice = spec.scenes.some((s) => s.narration?.trim())
  const tts = needsVoice ? await kokoro() : null
  let rate = 24000
  const clips = []
  const scenes = []
  for (const sc of spec.scenes) {
    const text = sc.narration?.replace(/\s+/g, ' ').trim()
    let words = []
    let audio = null
    if (text) {
      const sentences = text.match(/[^.!?]+[.!?]+["'”’)\]]*|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? []
      const parts = []
      let at = LEAD
      for (const s of sentences) {
        const out = await tts.generate(s, { voice, speed })
        rate = out.sampling_rate
        const [a, b] = speechSpan(out.audio, rate)
        words.push(...timeWords(s, at + a, at + b))
        parts.push(out.audio, new Float32Array(Math.round(rate * 0.12)))
        at += out.audio.length / rate + 0.12
      }
      audio = new Float32Array(parts.reduce((n, c) => n + c.length, 0))
      let o = 0
      for (const c of parts) {
        audio.set(c, o)
        o += c.length
      }
    }
    const spoken = audio ? LEAD + audio.length / rate + TAIL : 0
    const seconds = +Math.max(sc.seconds ?? 0, spoken, text ? 2 : 2.5).toFixed(2)
    clips.push(audio)
    const { narration: _n, sfx: _s, ...draw } = sc
    scenes.push({ ...draw, seconds, words: words.map((w) => ({ text: w.text, start: +w.start.toFixed(2), end: +w.end.toFixed(2) })) })
  }
  const total = scenes.reduce((n, s) => n + s.seconds, 0)

  // 2. One voice track with every scene's words at its start.
  const track = new Float32Array(Math.ceil(total * rate) + rate)
  let offset = 0
  for (const [i, sc] of scenes.entries()) {
    if (clips[i]) track.set(clips[i], Math.round((offset + LEAD) * rate))
    offset += sc.seconds
  }
  const voiceWav = join(dir, 'voice.wav')
  await writeFile(voiceWav, wavBuffer(track, rate))

  // 3. Draw it.
  const props = {
    style: spec.style,
    aspect: spec.aspect ?? '16:9',
    hero: { ...DEFAULT_HERO, ...spec.hero },
    other: { ...DEFAULT_OTHER, ...spec.other },
    watermark: spec.watermark,
    subtitles: spec.subtitles ?? true,
    scenes,
  }
  const propsFile = join(dir, 'film.json')
  await writeFile(propsFile, JSON.stringify(props, null, 1))
  const silent = join(dir, 'silent.mp4')
  await runFilmRenderer([propsFile, silent], (p) => onProgress?.(p))

  // 4. Thumbnail: the frame with the title card, else a moment into the first scene.
  let thumbAt = 1.2
  let acc = 0
  for (const sc of scenes) {
    if (sc.text && (sc.text.kind === 'title' || sc.text.kind === 'big-number')) {
      thumbAt = acc + (sc.text.at ?? 0) + 0.9
      break
    }
    acc += sc.seconds
  }
  const still = join(dir, 'thumbnail.png')
  await runFilmRenderer([propsFile, still, '--still', String(Math.min(thumbAt, total - 0.1))]).catch(() => null)

  // 5. Sound: effects on every action, music ducked under the voice, loudness for YouTube.
  const sfxDir = join(workspace, 'studio', 'sfx')
  await mkdir(sfxDir, { recursive: true })
  const cues = autoSfx(spec.scenes.map((s, i) => ({ ...s, seconds: scenes[i].seconds })))
  const used = [...new Set(cues.map((c) => c.sound))]
  for (const name of used) {
    const f = join(sfxDir, `${name}.wav`)
    if (!existsSync(f)) await run(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', SFX[name][0], '-af', SFX[name][1], '-ar', '44100', '-ac', '1', f])
  }
  const mood = spec.music ?? 'calm'
  const args = ['-y', '-v', 'error', '-i', silent, '-i', voiceWav]
  if (mood !== 'none') args.push('-f', 'lavfi', '-i', `aevalsrc='${musicExpr(mood)}':d=${(total + 1).toFixed(1)}:s=44100`)
  const sfxBase = mood !== 'none' ? 3 : 2
  for (const name of used) args.push('-i', join(sfxDir, `${name}.wav`))
  const chains = ['[1:a]aresample=44100,asplit=2[v][vk]']
  const mix = ['[v]']
  if (mood !== 'none') {
    chains.push('[2:a]lowpass=f=1800,aecho=0.8:0.7:120:0.25[m0]', '[m0][vk]sidechaincompress=threshold=0.02:ratio=8:attack=30:release=500[m]')
    mix.push('[m]')
  } else chains.push('[vk]anullsink')
  for (const [k, name] of used.entries()) {
    const mine = cues.filter((c) => c.sound === name)
    const labels = mine.map((_, j) => `[s${k}_${j}]`)
    chains.push(`[${sfxBase + k}:a]volume=0.55,asplit=${mine.length}${labels.join('')}`)
    mine.forEach((c, j) => {
      const ms = Math.max(0, Math.round(c.at * 1000))
      chains.push(`[s${k}_${j}]adelay=${ms}|${ms}[d${k}_${j}]`)
      mix.push(`[d${k}_${j}]`)
    })
  }
  chains.push(`${mix.join('')}amix=inputs=${mix.length}:duration=longest:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]`)
  const out = join(dir, `${slug(spec.title)}.mp4`)
  args.push('-filter_complex', chains.join(';'), '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', total.toFixed(2), '-movflags', '+faststart', out)
  await run(FFMPEG, args)

  let thumbnail = null
  if (existsSync(still)) {
    thumbnail = join(dir, 'thumbnail.jpg')
    await run(FFMPEG, ['-y', '-v', 'error', '-i', still, '-vf', 'scale=1280:-2', '-q:v', '3', thumbnail]).catch(() => (thumbnail = null))
  }
  const info = await probe(out)
  return { video: out, thumbnail, seconds: +info.duration.toFixed(1), width: info.width, height: info.height, sizeMB: info.sizeMB, scenes: scenes.length, sounds: cues.length, style: spec.style }
}

const look = z
  .object({
    skin: z.string().max(20).optional(),
    hair: z.string().max(20).optional(),
    hairStyle: z.enum(['short', 'long', 'bald', 'cap', 'bun', 'spiky']).optional(),
    outfit: z.string().max(20).optional(),
    pants: z.string().max(20).optional(),
    accent: z.string().max(20).optional(),
  })
  .optional()

const frac = z.number().min(-0.2).max(1.2)

export const sceneSchema = z.object({
  narration: z.string().max(700).optional().describe('What the narrator says over this scene. The scene lasts as long as it takes to say.'),
  seconds: z.number().min(0.5).max(30).optional().describe('Minimum length; only needed for scenes without narration'),
  setting: z.enum(SETTINGS),
  time: z.enum(['day', 'night', 'sunset', 'dawn']).optional(),
  weather: z.enum(['none', 'rain', 'snow']).optional(),
  actors: z
    .array(
      z.object({
        who: z.enum(['hero', 'other']).optional(),
        pose: z.enum(POSES),
        expression: z.enum(EXPRESSIONS).optional(),
        x: frac.optional().describe('0 = left edge, 1 = right edge'),
        to: frac.optional().describe('Walk to this x during the scene'),
        facing: z.enum(['left', 'right']).optional(),
        size: z.number().min(0.3).max(2.5).optional(),
        talking: z.boolean().optional(),
        enter: z.enum(['pop', 'drop', 'slide', 'fade', 'none']).optional(),
      }),
    )
    .max(4)
    .optional(),
  props: z
    .array(
      z.object({
        kind: z.enum(PROPS),
        x: frac,
        y: z.number().min(0).max(1).describe('0 = top, 1 = bottom; the ground is at about 0.8 (0.7 in 9:16)'),
        size: z.number().min(0.2).max(3).optional(),
        enter: z.enum(['pop', 'drop', 'slide', 'fade', 'none']).optional(),
        at: z.number().min(0).max(30).optional().describe('Seconds into the scene it appears'),
        color: z.string().max(20).optional(),
        label: z.string().max(16).optional(),
        float: z.boolean().optional(),
      }),
    )
    .max(8)
    .optional(),
  text: z
    .object({ value: z.string().min(1).max(60), kind: z.enum(['title', 'caption', 'big-number', 'label']).optional(), at: z.number().min(0).max(30).optional() })
    .optional(),
  camera: z.enum(['still', 'push-in', 'pull-out', 'pan-left', 'pan-right', 'shake']).optional(),
  transition: z.enum(['cut', 'fade', 'wipe', 'slide']).optional(),
  sfx: z.array(z.object({ sound: z.enum(SOUNDS), at: z.number().min(0).max(30).optional() })).max(6).optional(),
})

export const filmSchema = {
  title: z.string().min(1).max(100),
  style: z.enum(STYLES),
  aspect: z.enum(['16:9', '9:16']).optional().describe('16:9 for a YouTube video (default), 9:16 for Shorts, TikTok and Reels'),
  voice: z.string().optional().describe('Kokoro voice id; default bm_george'),
  speed: z.number().min(0.8).max(1.2).optional(),
  music: z.enum(MOODS).optional(),
  watermark: z.string().max(30).optional().describe('The channel name, small in a corner'),
  hero: look,
  other: look,
  subtitles: z.boolean().optional(),
  scenes: z.array(sceneSchema).min(1).max(90),
}

/** @param {{ allowWrites: boolean, checkPath: (p: string) => string|null, workspace: string, onRendered?: ((r: object) => void)|null }} o */
export function filmsServer({ allowWrites, workspace, onRendered = null }) {
  const tools = allowWrites
    ? [
        tool(
          'make_film',
          `Make an animated story film, the faceless animated-channel format: a channel character drawn in
one art style, simple animation (walks, reactions, props popping in, camera moves), a title card,
big numbers that count up, word-timed subtitles, Kokoro narration, sound effects on every action
and a music bed. Free and offline. Write the story scene by scene: each scene is one beat of
narration (1-3 short sentences) with what the viewer sees. 2-3 minutes = about 25-45 scenes and
300-450 words. Keep the same style, hero look and watermark on every film of a channel. Takes a
few minutes (about 1-2 minutes of rendering per minute of film). The finished film opens on screen.`,
          filmSchema,
          safe(async (spec) => {
            const r = await makeFilm(spec, { workspace })
            onRendered?.({ path: r.video, title: spec.title })
            return { ...r, shownOnScreen: Boolean(onRendered) }
          }),
        ),
      ]
    : []
  return createSdkMcpServer({
    name: 'jarvis_films',
    version: '1.0.0',
    instructions:
      'Animated story films (make_film): the channel character, eight art styles (' + STYLES.join(', ') + '), narration, subtitles, sound effects and music, rendered on this laptop.' +
      (allowWrites ? '' : ' Making films needs write mode.'),
    alwaysLoad: true,
    tools,
  })
}
