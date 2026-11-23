import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { z } from 'zod'
import { safe } from './secrets.mjs'

/**
 * JARVIS's edit suite: vertical 1080x1920 videos for Shorts, Reels and TikTok.
 *
 * Built on ffmpeg (FFMPEG_PATH / FFPROBE_PATH, else whatever is on PATH).
 * Voiceovers and auto-captions use ElevenLabs when a key is configured.
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

async function probe(path) {
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
  const lines = []
  for (let i = 0; i < words.length; i += perLine) {
    const chunk = words.slice(i, i + perLine)
    lines.push(`${lines.length + 1}\n${srtTime(chunk[0].start)} --> ${srtTime(chunk.at(-1).end)}\n${chunk.map((w) => w.text).join(' ').toUpperCase()}\n`)
  }
  return lines.join('\n')
}

/** ElevenLabs character alignment -> word timings. */
function alignmentToWords(al) {
  const words = []
  let cur = null
  al.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      if (cur) words.push(cur)
      cur = null
    } else {
      cur ??= { text: '', start: al.character_start_times_seconds[i] }
      cur.text += ch
      cur.end = al.character_end_times_seconds[i]
    }
  })
  if (cur) words.push(cur)
  return words
}

/** Evenly timed captions for when there is text but no word timings. */
function evenSrt(text, duration) {
  const words = text.split(/\s+/).filter(Boolean)
  const step = duration / Math.max(words.length, 1)
  return wordsToSrt(words.map((t, i) => ({ text: t, start: i * step, end: (i + 1) * step })))
}

/**
 * @param {{ allowWrites: boolean, checkPath: (p: string) => string|null, workspace: string, elevenKey: () => string|null, voiceId?: string }} o
 */
export function studioServer({ allowWrites, checkPath, workspace, elevenKey, voiceId }) {
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

  async function voiceover({ text, voice, name, stability = 0.45, speed = 1.05 }) {
    const id = voice || voiceId || 'JBFqnCBsd6RMkjVDRZzb'
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}/with-timestamps?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key(), 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability, similarity_boost: 0.75, speed } }),
    })
    const b = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`ElevenLabs refused the voiceover: ${b.detail?.message ?? b.detail ?? res.status}`)
    const dir = await jobDir(name ?? text.slice(0, 30))
    const audio = join(dir, 'voiceover.mp3')
    const captions = join(dir, 'captions.srt')
    await writeFile(audio, Buffer.from(b.audio_base64, 'base64'))
    const words = alignmentToWords(b.normalized_alignment ?? b.alignment)
    await writeFile(captions, wordsToSrt(words))
    return { audio, captions, seconds: +(words.at(-1)?.end ?? 0).toFixed(1) }
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
  ]

  const writes = [
    tool(
      'create_voiceover',
      `Narrate a script with ElevenLabs. Returns an MP3 and word-timed captions (SRT) for render_short.
Write for the ear: short sentences, a hook in the first three seconds.`,
      {
        text: z.string().min(1).max(5000),
        voice: z.string().optional().describe('ElevenLabs voice id; default is JARVIS_VOICE_ID'),
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
        return { video: out, ...(await probe(out)) }
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
        return { video: out, ...(await probe(out)) }
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
