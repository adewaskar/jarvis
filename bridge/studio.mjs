import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { z } from 'zod'
import { safe } from './secrets.mjs'

/**
 * JARVIS's edit suite: vertical 1080x1920 videos for Shorts, Reels and TikTok.
 *
 * Built on ffmpeg (FFMPEG_PATH / FFPROBE_PATH, else whatever is on PATH).
 * Voiceovers use Kokoro, a free voice running on this laptop; transcribing
 * existing footage (create_captions) still uses ElevenLabs when a key is set.
 * Every output lands in <workspace>/studio/<job>/, inside the folders the
 * posting tools are allowed to read, so "render it, then post it" just works.
 */

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg'
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe'
const W = 1080
const H = 1920
const FPS = 30
const IMAGE = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp'])
const CAPTION_STYLE =
  "Fontname=Arial,Fontsize=13,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=0,Alignment=2,MarginV=70"

function run(bin, args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd, windowsHide: true })
    let err = ''
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err = (err + d).slice(-4000)))
    p.on('error', (e) =>
      reject(new Error(e.code === 'ENOENT' ? `${bin} is not installed. Install it with: winget install Gyan.FFmpeg` : e.message)),
    )
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${basename(bin)} failed: ${err.split('\n').slice(-4).join(' ')}`))))
  })
}

export const ffmpegAvailable = () => run(FFMPEG, ['-version']).then(() => true, () => false)

export async function probe(path) {
  const out = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path])
  const j = JSON.parse(out)
  const v = j.streams.find((s) => s.codec_type === 'video')
  return {
    duration: Number(j.format.duration ?? 0),
    width: v?.width,
    height: v?.height,
    hasAudio: j.streams.some((s) => s.codec_type === 'audio'),
    sizeMB: +(Number(j.format.size ?? 0) / 1e6).toFixed(1),
  }
}

const slug = (s) => String(s || 'video').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'video'
const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const srtTime = (t) => {
  const ms = Math.max(0, Math.round(t * 1000))
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`
}

/** Words with timings -> short, punchy caption lines (the Shorts look). */
function wordsToSrt(words, perLine = 3) {
  // A line never runs across the end of a sentence.
  const groups = []
  let cur = []
  for (const w of words) {
    cur.push(w)
    if (cur.length >= perLine || /[.!?]["'”’)\]]*$/.test(w.text)) {
      groups.push(cur)
      cur = []
    }
  }
  if (cur.length) groups.push(cur)
  return groups
    .map((chunk, i) => `${i + 1}\n${srtTime(chunk[0].start)} --> ${srtTime(chunk.at(-1).end)}\n${chunk.map((w) => w.text).join(' ').toUpperCase()}\n`)
    .join('\n')
}

/*
 * Voiceovers: Kokoro (github.com/hexgrad/kokoro, Apache-2.0), an 82M neural
 * voice that runs on this laptop's CPU. Free, offline, no key. The owner picked
 * bm_george on 2026-11-24 to replace ElevenLabs. About 1.25 s of work per
 * second of speech here; the model (q8, ~90 MB) is cached in ~/.jarvis/models/hf.
 */
const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const KOKORO_DEFAULT_VOICE = process.env.JARVIS_KOKORO_VOICE || 'bm_george'
let kokoroLoading = null
function kokoro() {
  kokoroLoading ??= (async () => {
    const { env } = await import('@huggingface/transformers')
    env.cacheDir = join(homedir(), '.jarvis', 'models', 'hf')
    const { KokoroTTS } = await import('kokoro-js')
    return KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype: 'q8', device: 'cpu' })
  })().catch((e) => {
    kokoroLoading = null
    throw new Error(`The Kokoro voice failed to load: ${e.message}`)
  })
  return kokoroLoading
}

/** First and last sample louder than the noise floor, so word timings skip the silence Kokoro pads with. */
function speechSpan(samples, rate) {
  const thr = 0.01
  let a = 0
  let b = samples.length - 1
  while (a < b && Math.abs(samples[a]) < thr) a++
  while (b > a && Math.abs(samples[b]) < thr) b--
  return [a / rate, b / rate]
}

/** Spread a sentence's words over its spoken span, weighted by length, with extra room after commas. */
function timeWords(sentence, from, to) {
  const parts = sentence.split(/\s+/).filter(Boolean)
  const weight = (w) => Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, '').length) + (/[,;:—–-]$/.test(w) ? 3 : 0) + 1
  const total = parts.reduce((s, w) => s + weight(w), 0) || 1
  let t = from
  return parts.map((text) => {
    const d = ((to - from) * weight(text)) / total
    const w = { text, start: t, end: t + d }
    t += d
    return w
  })
}

function wavBuffer(samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + samples.length * 2, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2)
  return buf
}

/** Evenly timed captions for when there is text but no word timings. */
function evenSrt(text, duration) {
  const words = text.split(/\s+/).filter(Boolean)
  const step = duration / Math.max(words.length, 1)
  return wordsToSrt(words.map((t, i) => ({ text: t, start: i * step, end: (i + 1) * step })))
}

/**
 * @param {{ allowWrites: boolean, checkPath: (p: string) => string|null, workspace: string, elevenKey: () => string|null, onRendered?: ((r: object) => void)|null }} o
 */
export function studioServer({ allowWrites, checkPath, workspace, elevenKey, onRendered = null }) {
  const need = (p) => {
    const problem = checkPath(p)
    if (problem) throw new Error(problem)
    return p
  }
  const jobDir = async (name) => {
    const dir = join(workspace, 'studio', `${stamp()}-${slug(name)}`)
    await mkdir(dir, { recursive: true })
    return dir
  }
  const key = () => {
    const k = elevenKey()
    if (!k) throw new Error('This needs an ElevenLabs API key (ELEVENLABS_API_KEY). Without one, pass caption text instead.')
    return k
  }

  /** Kokoro, one sentence at a time: exact sentence timings, word timings estimated inside each sentence. */
  async function voiceover({ text, voice, name, speed = 1 }) {
    const id = /^[abefhijpz][fm]_[a-z]+$/.test(voice ?? '') ? voice : KOKORO_DEFAULT_VOICE
    const tts = await kokoro()
    const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+["'”’)\]]*|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? []
    if (!sentences.length) throw new Error('The script is empty.')
    const chunks = []
    const words = []
    let rate = 24000
    let at = 0
    for (const s of sentences) {
      const out = await tts.generate(s, { voice: id, speed })
      rate = out.sampling_rate
      const [a, b] = speechSpan(out.audio, rate)
      words.push(...timeWords(s, at + a, at + b))
      chunks.push(out.audio, new Float32Array(Math.round(rate * 0.12)))
      at += out.audio.length / rate + 0.12
    }
    const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0))
    let o = 0
    for (const c of chunks) all.set(c, (o += c.length) - c.length)
    const dir = await jobDir(name ?? text.slice(0, 30))
    const wav = join(dir, 'voiceover.wav')
    const audio = join(dir, 'voiceover.mp3')
    const captions = join(dir, 'captions.srt')
    await writeFile(wav, wavBuffer(all, rate))
    await run(FFMPEG, ['-y', '-v', 'error', '-i', wav, '-af', 'highpass=f=60,loudnorm=I=-16:TP=-1.5', '-ar', '44100', '-b:a', '160k', audio])
    await writeFile(captions, wordsToSrt(words))
    return { audio, captions, voice: id, seconds: +(all.length / rate).toFixed(1) }
  }

  async function transcribe(path) {
    const form = new FormData()
    form.set('model_id', 'scribe_v1')
    form.set('timestamps_granularity', 'word')
    form.set('file', new Blob([await readFile(path)]), basename(path))
    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key() }, body: form })
    const b = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`Transcription failed: ${b.detail?.message ?? b.detail ?? res.status}`)
    return { text: b.text, words: (b.words ?? []).filter((w) => w.type === 'word') }
  }

  /** Burn captions + mix audio over a silent or voiced video. cwd trick avoids Windows path escaping in the subtitles filter. */
  async function finish({ dir, video, voice, music, musicVolume = 0.12, keepOriginalAudio, captionsFile, out }) {
    const args = ['-y', '-i', video]
    const inputs = []
    if (voice) inputs.push(voice)
    if (music) inputs.push(music)
    for (const i of inputs) args.push('-i', i)
    const vf = captionsFile ? `subtitles=${basename(captionsFile)}:force_style='${CAPTION_STYLE}'` : 'null'
    const chains = []
    const mix = []
    if (keepOriginalAudio) mix.push('[0:a]')
    let idx = 1
    if (voice) mix.push(`[${idx++}:a]`)
    if (music) {
      chains.push(`[${idx}:a]volume=${musicVolume},aloop=loop=-1:size=2e9[m]`)
      mix.push('[m]')
    }
    const filter = [`[0:v]${vf}[v]`, ...chains]
    if (mix.length) filter.push(`${mix.join('')}amix=inputs=${mix.length}:duration=first:dropout_transition=0:normalize=0[a]`)
    args.push('-filter_complex', filter.join(';'), '-map', '[v]')
    if (mix.length) args.push('-map', '[a]', '-c:a', 'aac', '-b:a', '192k')
    args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', '-shortest', out)
    await run(FFMPEG, args, dir)
    return out
  }

  const reads = [
    tool(
      'get_media_info',
      'Duration, resolution, audio presence and size of a local video, image or audio file.',
      { path: z.string() },
      safe(async ({ path }) => probe(need(path))),
    ),
    tool(
      'list_studio_videos',
      'The videos JARVIS has rendered, newest first: path, title, size, when. Use it to find "the last video you made".',
      { limit: z.number().int().min(1).max(30).optional() },
      safe(async ({ limit = 10 }) => {
        const root = join(workspace, 'studio')
        const dirs = await readdir(root).catch(() => [])
        const found = []
        for (const d of dirs) {
          for (const name of await readdir(join(root, d)).catch(() => [])) {
            // The finished video is <title>.mp4; the rest are working files.
            if (!/.mp4$/i.test(name) || /^(silent|cut|scene-d+).mp4$/i.test(name)) continue
            const p = join(root, d, name)
            const st = await stat(p).catch(() => null)
            if (st?.isFile()) found.push({ path: p, title: d.replace(/^d[d-]*-/, '').replace(/-/g, ' '), mb: +(st.size / 1e6).toFixed(1), made: st.mtime.toISOString() })
          }
        }
        return found.sort((a, b) => b.made.localeCompare(a.made)).slice(0, limit)
      }),
    ),
    ...(onRendered
      ? [
          tool(
            'show_video',
            'Put a local video on the screen and play it (a render from list_studio_videos, or a file in the footage folder). Finished renders already show themselves; use this to replay one.',
            { path: z.string(), title: z.string().optional() },
            safe(async ({ path, title }) => {
              need(path)
              onRendered({ path, title: title ?? basename(path) })
              return { showing: path }
            }),
          ),
        ]
      : []),
  ]

  const writes = [
    tool(
      'create_image',
      'Generate a vertical 1080x1920 picture for a video scene from a text prompt (free, no account: Pollinations). Describe subject, setting, lighting and style ("cinematic photo", "3D render", "anime"). No text in the image: captions are added later. Returns the saved file path for render_short.',
      { prompt: z.string().min(3).max(800), seed: z.number().int().optional(), width: z.number().int().min(256).max(1920).optional(), height: z.number().int().min(256).max(1920).optional() },
      safe(async ({ prompt, seed, width = 1080, height = 1920 }) => {
        const dir = join(workspace, 'studio', 'images')
        await mkdir(dir, { recursive: true })
        const q = new URLSearchParams({ width: String(width), height: String(height), nologo: 'true', seed: String(seed ?? Math.floor(Math.random() * 1e9)) })
        let lastError = ''
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const token = process.env.POLLINATIONS_TOKEN
            const r = await fetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${q}`, {
              headers: token ? { authorization: `Bearer ${token}` } : {},
              signal: AbortSignal.timeout(120000),
            })
            const type = r.headers.get('content-type') ?? ''
            if (!r.ok || !type.startsWith('image/')) throw new Error(`image service answered ${r.status}`)
            const base = join(dir, `${stamp()}-${slug(prompt)}`)
            const raw = `${base}.raw.${type.includes('png') ? 'png' : 'jpg'}`
            const out = `${base}.jpg`
            await writeFile(raw, Buffer.from(await r.arrayBuffer()))
            // Free Pollinations images carry a "pollinations.ai" mark in the bottom-right
            // corner even with nologo=true. Cut the bottom 7% off so no video shows it;
            // the Ken Burns crop in render_short fills the frame again.
            await run(FFMPEG, ['-y', '-v', 'error', '-i', raw, '-vf', 'crop=iw:trunc(ih*0.93/2)*2:0:0', '-q:v', '2', out])
            await rm(raw, { force: true })
            // The free tier often sends a smaller picture than asked; report what arrived.
            const got = await probe(out).catch(() => null)
            return { image: out, width: got?.width ?? width, height: got?.height ?? height }
          } catch (e) {
            lastError = e.message
            await new Promise((res) => setTimeout(res, attempt * 3000))
          }
        }
        throw new Error(`Image generation failed after 3 tries: ${lastError}`)
      }),
    ),
    tool(
      'create_voiceover',
      `Narrate a script with Kokoro, the free voice that runs on this laptop (no key, no cost). Returns an MP3 and word-timed captions (SRT) for render_short.
Takes about 1.25 s per second of speech, plus a few seconds to load the first time.
Write for the ear: short sentences, a hook in the first three seconds.`,
      {
        text: z.string().min(1).max(5000),
        voice: z.string().optional().describe('Kokoro voice id; default bm_george (the owner\'s pick). Others: bm_fable, bm_lewis, bm_daniel, am_michael, am_fenrir, af_heart'),
        name: z.string().optional(),
        speed: z.number().min(0.7).max(1.2).optional(),
      },
      safe(voiceover),
    ),
    tool(
      'create_captions',
      'Transcribe the speech in a local video or audio file (ElevenLabs Scribe) and write word-timed captions (SRT). Also returns the transcript, useful for picking the best clip moments.',
      { path: z.string() },
      safe(async ({ path }) => {
        const { text, words } = await transcribe(need(path))
        const dir = await jobDir(`captions-${basename(path, extname(path))}`)
        const captions = join(dir, 'captions.srt')
        await writeFile(captions, wordsToSrt(words))
        return {
          captions,
          transcript: text,
          // Timestamped sentences so the model can choose clip ranges.
          lines: words.reduce((acc, w) => {
            const last = acc.at(-1)
            if (!last || /[.!?]$/.test(last.text)) acc.push({ start: +w.start.toFixed(1), text: w.text })
            else last.text += ' ' + w.text
            return acc
          }, []),
        }
      }),
    ),
    tool(
      'render_short',
      `Make a vertical 1080x1920 video from scenes (images get a slow Ken Burns zoom; video clips are
cropped to fill). Optional voiceover, captions (SRT from create_voiceover, or captionText to time
evenly), and background music mixed under the voice. When a voiceover is given, scenes without
seconds share its length. Output is ready for TikTok, Reels and Shorts.`,
      {
        title: z.string().describe('Used for the output folder name'),
        scenes: z.array(z.object({ path: z.string(), seconds: z.number().min(0.5).max(60).optional() })).min(1).max(40),
        voiceover: z.string().optional(),
        captions: z.string().optional().describe('SRT file path'),
        captionText: z.string().optional(),
        music: z.string().optional(),
        musicVolume: z.number().min(0).max(1).optional(),
      },
      safe(async ({ title, scenes, voiceover: vo, captions, captionText, music, musicVolume }) => {
        for (const s of scenes) need(s.path)
        for (const p of [vo, captions, music]) if (p) need(p)
        const dir = await jobDir(title)
        const total = vo ? (await probe(vo)).duration : null
        const unset = scenes.filter((s) => !s.seconds).length
        const fixed = scenes.reduce((a, s) => a + (s.seconds ?? 0), 0)
        const fill = unset ? Math.max(1, ((total ?? unset * 4) - fixed) / unset) : 0

        const parts = []
        for (const [i, s] of scenes.entries()) {
          const secs = s.seconds ?? fill
          const out = join(dir, `scene-${String(i).padStart(2, '0')}.mp4`)
          const frames = Math.ceil(secs * FPS)
          if (IMAGE.has(extname(s.path).toLowerCase())) {
            const zoomIn = i % 2 === 0
            const z = zoomIn ? `min(1+0.15*on/${frames},1.15)` : `max(1.15-0.15*on/${frames},1)`
            await run(FFMPEG, [
              '-y', '-loop', '1', '-i', s.path, '-t', String(secs),
              '-vf', `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},format=yuv420p`,
              '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', out,
            ])
          } else {
            await run(FFMPEG, [
              '-y', '-stream_loop', '-1', '-i', s.path, '-t', String(secs),
              '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},format=yuv420p`,
              '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', out,
            ])
          }
          parts.push(basename(out))
        }
        await writeFile(join(dir, 'list.txt'), parts.map((p) => `file '${p}'`).join('\n'))
        await run(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'silent.mp4'], dir)

        let captionsFile
        if (captions) {
          captionsFile = join(dir, 'captions.srt')
          await copyFile(captions, captionsFile)
        } else if (captionText) {
          captionsFile = join(dir, 'captions.srt')
          await writeFile(captionsFile, evenSrt(captionText, (await probe(join(dir, 'silent.mp4'))).duration))
        }
        const out = join(dir, `${slug(title)}.mp4`)
        await finish({ dir, video: join(dir, 'silent.mp4'), voice: vo, music, musicVolume, captionsFile, out })
        onRendered?.({ path: out, title })
        return { video: out, shownOnScreen: Boolean(onRendered), ...(await probe(out)) }
      }),
    ),
    tool(
      'render_clip',
      `Cut a moment out of the user's own footage and turn it into a vertical 1080x1920 clip:
crops to fill the frame, keeps the original sound, optionally burns captions (captions:"auto"
transcribes the clip with ElevenLabs, or give an SRT path) and adds quiet background music.
Use create_captions on the full video first to find the best start and end times.`,
      {
        path: z.string(),
        start: z.number().min(0),
        end: z.number().min(0.5),
        title: z.string(),
        captions: z.string().optional().describe('"auto" or an SRT path'),
        music: z.string().optional(),
        musicVolume: z.number().min(0).max(1).optional(),
      },
      safe(async ({ path, start, end, title, captions, music, musicVolume = 0.08 }) => {
        need(path)
        if (music) need(music)
        if (end <= start) throw new Error('end must be after start.')
        const dir = await jobDir(title)
        const info = await probe(path)
        await run(FFMPEG, [
          '-y', '-ss', String(start), '-to', String(end), '-i', path,
          '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},format=yuv420p`,
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
          ...(info.hasAudio ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an']),
          'cut.mp4',
        ], dir)
        let captionsFile
        if (captions === 'auto') {
          const { words } = await transcribe(join(dir, 'cut.mp4'))
          captionsFile = join(dir, 'captions.srt')
          await writeFile(captionsFile, wordsToSrt(words))
        } else if (captions) {
          need(captions)
          captionsFile = join(dir, 'captions.srt')
          await copyFile(captions, captionsFile)
        }
        const out = join(dir, `${slug(title)}.mp4`)
        await finish({ dir, video: join(dir, 'cut.mp4'), music, musicVolume, keepOriginalAudio: info.hasAudio, captionsFile, out })
        onRendered?.({ path: out, title })
        return { video: out, shownOnScreen: Boolean(onRendered), ...(await probe(out)) }
      }),
    ),
  ]

  return createSdkMcpServer({
    name: 'jarvis_studio',
    version: '1.0.0',
    instructions:
      'Video edit suite on this machine (ffmpeg): voiceovers, captions, vertical shorts from images and clips, and clips cut from the user\'s footage.' +
      (allowWrites ? '' : ' Rendering needs write mode; only get_media_info is available now.'),
    alwaysLoad: true,
    tools: allowWrites ? [...reads, ...writes] : reads,
  })
}
