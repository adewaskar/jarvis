// Kokoro runs here, on its own thread. Synthesis is CPU-heavy and, on the main
// thread, froze the bridge for minutes during a film: no voice turns, no
// /videos page, no websocket pings. The bridge talks to it through kokoro() in
// studio.mjs, which keeps the KokoroTTS-shaped generate() its callers expect.
import { parentPort, workerData } from 'node:worker_threads'

const { cacheDir, model } = workerData
let tts = null

async function load() {
  const { env } = await import('@huggingface/transformers')
  env.cacheDir = cacheDir
  const { KokoroTTS } = await import('kokoro-js')
  tts = await KokoroTTS.from_pretrained(model, { dtype: 'q8', device: 'cpu' })
}

const ready = load()

parentPort.on('message', async ({ id, text, voice, speed }) => {
  try {
    await ready
    const out = await tts.generate(text, { voice, speed })
    const audio = out.audio instanceof Float32Array ? out.audio : Float32Array.from(out.audio)
    parentPort.postMessage({ id, audio, sampling_rate: out.sampling_rate }, [audio.buffer])
  } catch (e) {
    parentPort.postMessage({ id, error: e?.message ?? String(e) })
  }
})
