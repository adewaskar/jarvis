/**
 * Neural speech, entirely in the browser.
 *
 * `speechSynthesis` is limited to whatever voices the operating system ships,
 * and on macOS the British male option is Daniel — a compact concatenative
 * voice from over a decade ago. It is the honest ceiling of the built-in API
 * and it sounds like a satnav.
 *
 * Kokoro is an 82M-parameter TTS model that runs on WebGPU via ONNX. No cloud,
 * no API key, nothing leaves the machine — but it sounds like a person. It
 * carries four British male voices, which is what this project actually wants.
 *
 * The cost is a one-time ~86MB model download, cached by the browser
 * afterwards. It's fetched during the boot sequence so the first "Hey Jarvis"
 * isn't waiting on it, and anything that goes wrong falls back to Daniel.
 */

import { KOKORO_VOICE } from '../config'

type Kokoro = {
  generate: (
    text: string,
    opts: { voice: string; speed?: number },
  ) => Promise<{ toBlob: () => Blob }>
}

let model: Kokoro | null = null
let loading: Promise<Kokoro | null> | null = null
let failed = false

/** 0..1 while the model downloads, for the boot readout. */
let progress = 0
export const loadProgress = () => progress
export const isReady = () => model !== null
export const isUnavailable = () => failed

/** Exposed for diagnosis — the console warning alone is easy to miss. */
export let lastError = ''

/**
 * British male voices, in the order they suit the character. George is the
 * closest to a measured RP baritone; Fable is warmer, Lewis lower, Daniel
 * brighter.
 */
export const VOICES = ['bm_george', 'bm_fable', 'bm_lewis', 'bm_daniel'] as const

/**
 * A voice id the model doesn't carry throws inside generate(), once per
 * sentence, for the life of the page — and a typo in an env var is the likeliest
 * way to get there. Check it once at module load and fall back audibly in the
 * console instead.
 */
function resolveVoice(): string {
  if ((VOICES as readonly string[]).includes(KOKORO_VOICE)) return KOKORO_VOICE
  console.warn(
    `[jarvis] VITE_KOKORO_VOICE="${KOKORO_VOICE}" is not one of ${VOICES.join(', ')} — using ${VOICES[0]}.`,
  )
  return VOICES[0]
}

const voice = resolveVoice()

/**
 * Generation failures latch after this many in a row. One is worth retrying —
 * a WebGPU device can be lost and recovered — but a run of them means the
 * engine is not going to work on this machine, and it is better to drop to the
 * system voice for good than to alternate between the two mid-conversation.
 */
const MAX_FAILURES = 3
let failures = 0

export async function load(): Promise<Kokoro | null> {
  if (model) return model
  if (failed) return null
  if (loading) return loading

  loading = (async () => {
    try {
      const { KokoroTTS } = await import('kokoro-js')
      const tts = await KokoroTTS.from_pretrained(
        'onnx-community/Kokoro-82M-v1.0-ONNX',
        {
          // q8 is about 86MB against fp32's 330MB, and the difference is
          // inaudible through laptop speakers. WebGPU keeps generation ahead
          // of playback; without it this would be too slow to converse with.
          dtype: 'q8',
          device: 'webgpu',
          // The callback is a union across several event shapes; only the
          // download-progress one carries a percentage.
          progress_callback: (p: unknown) => {
            const pct = (p as { progress?: number })?.progress
            if (typeof pct === 'number') progress = pct / 100
          },
        },
      )
      progress = 1
      model = tts as unknown as Kokoro
      return model
    } catch (err) {
      console.log('[Voice] kokoro unavailable, using the system voice:', err)
      lastError = String((err as Error)?.message ?? err)
      failed = true
      return null
    } finally {
      loading = null
    }
  })()

  return loading
}

/** Synthesise one sentence. Returns null if the model isn't usable. */
export async function speak(text: string): Promise<string | null> {
  const tts = await load()
  if (!tts) {
    console.warn('[jarvis] kokoro model not loaded, failed:', lastError || 'unknown')
    return null
  }
  try {
    console.log('[jarvis] kokoro generating speech for:', text.slice(0, 50))
    const audio = await tts.generate(text, {
      voice,
      // Slightly under natural pace — the character is never hurried, and the
      // steadiness is most of the characterisation.
      speed: 0.95,
    })
    failures = 0
    const url = URL.createObjectURL(audio.toBlob())
    console.log('[jarvis] kokoro generated', url.length, 'bytes')
    return url
  } catch (err) {
    // Surfaced rather than swallowed: a silent null here just looks like the
    // voice quietly reverting to the system one with no explanation.
    console.error('[jarvis] kokoro generation failed:', err)
    lastError = String((err as Error)?.message ?? err)
    failures++
    if (failures >= MAX_FAILURES) {
      // Nothing else sets this on the generation path, so without it tts.ts
      // keeps routing every sentence here and every sentence keeps throwing.
      failed = true
      console.warn(
        `[jarvis] kokoro failed ${failures} times running — the system voice from here on.`,
      )
    }
    return null
  }
}

/** Voice ids this build of the model actually carries. */
export async function availableVoices(): Promise<string[]> {
  const tts = (await load()) as unknown as { voices?: Record<string, unknown> } | null
  return tts?.voices ? Object.keys(tts.voices) : []
}
