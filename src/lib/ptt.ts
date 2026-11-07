import { BRIDGE_HTTP_URL } from '../config'
import { getMic, releaseMic } from './audio'
import { caps } from './capabilities'

/**
 * Push-to-talk capture: one utterance, recorded only while held.
 *
 * The always-on loop in voice.ts is built for a room where only the user
 * speaks. This is for a room where other people do. Nothing is opened until
 * start(), and finish() closes the microphone before anything is sent, so the
 * device is live exactly as long as the key is down.
 *
 * Same two engines as the loop, for the same reason: ElevenLabs Scribe through
 * the bridge when it has a key, the browser's own recogniser when it does not.
 */
export type Ptt = {
  start: () => Promise<void>
  /** Stop capturing, release the microphone, and resolve the words said. */
  finish: () => Promise<string>
  /** Stop capturing and discard. */
  cancel: () => void
  live: () => boolean
}

/** Shorter than this is a key tap, not speech — not worth a network round trip. */
const MIN_BYTES = 1200

function pickMime(): string {
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m
  }
  return ''
}

export function createPtt(onPartial: (text: string) => void): Ptt {
  return caps().stt ? scribePtt() : browserPtt(onPartial)
}

function scribePtt(): Ptt {
  let recorder: MediaRecorder | null = null
  let chunks: Blob[] = []

  const stopRecorder = () =>
    new Promise<Blob>((resolve) => {
      const r = recorder
      recorder = null
      if (!r || r.state === 'inactive') return resolve(new Blob(chunks))
      r.onstop = () => resolve(new Blob(chunks, { type: r.mimeType }))
      r.stop()
    })

  return {
    live: () => recorder !== null,
    async start() {
      if (recorder) return
      const stream = await getMic()
      const mime = pickMime()
      chunks = []
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data)
      }
      recorder.start()
    },
    async finish() {
      const blob = await stopRecorder()
      releaseMic()
      if (blob.size < MIN_BYTES) return ''
      const res = await fetch(`${BRIDGE_HTTP_URL}/stt`, {
        method: 'POST',
        headers: { 'content-type': blob.type || 'audio/webm' },
        body: blob,
      })
      if (!res.ok) throw new Error(`transcription failed (${res.status})`)
      const { text } = (await res.json()) as { text?: string }
      return (text ?? '').trim()
    },
    cancel() {
      void stopRecorder()
      releaseMic()
    },
  }
}

function browserPtt(onPartial: (text: string) => void): Ptt {
  const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
  let rec: any = null
  let finalText = ''
  let interim = ''
  let ended: Promise<void> = Promise.resolve()

  return {
    live: () => rec !== null,
    async start() {
      if (rec) return
      if (!Ctor) throw new Error('This browser has no speech recognition — use Chrome or Edge, or add an ElevenLabs key.')
      finalText = ''
      interim = ''
      rec = new Ctor()
      rec.continuous = true
      rec.interimResults = true
      rec.lang = 'en-GB'
      rec.onresult = (e: any) => {
        interim = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]
          if (r.isFinal) finalText += r[0].transcript
          else interim += r[0].transcript
        }
        onPartial((finalText + interim).trim())
      }
      ended = new Promise<void>((resolve) => {
        rec.onend = () => resolve()
        rec.onerror = () => resolve()
      })
      rec.start()
    },
    async finish() {
      const r = rec
      rec = null
      if (!r) return ''
      r.stop()
      // The last result arrives after stop(), not before; wait for the end, but
      // not for ever.
      await Promise.race([ended, new Promise((resolve) => setTimeout(resolve, 2500))])
      return (finalText || interim).trim()
    },
    cancel() {
      rec?.abort()
      rec = null
    },
  }
}
