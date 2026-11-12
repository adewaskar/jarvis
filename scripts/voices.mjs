/**
 * Audition ElevenLabs voices for JARVIS.
 *
 *   npm run voices                 British male voices on your account
 *   npm run voices -- --all        every voice on your account
 *   npm run voices -- <voice id>   one voice
 *
 * Saves one line read by each voice to ~/.jarvis/voice-samples/ and prints the
 * id to put in ~/.jarvis/.env as JARVIS_VOICE_ID. Uses the same key and model
 * as the bridge. Each sample costs about a hundred characters of your
 * ElevenLabs quota.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadPrivateEnv } from '../bridge/secrets.mjs'

loadPrivateEnv()
const key = process.env.ELEVENLABS_API_KEY
if (!key) {
  console.error(
    'No ELEVENLABS_API_KEY. Put it in ~/.jarvis/.env as\n\n  ELEVENLABS_API_KEY=your-key\n\nand run this again.',
  )
  process.exit(1)
}

const LINE =
  'Good evening, sir. The render is complete, but I am afraid the battery is at eleven percent. Shall I dim the lab?'
const MODEL = process.env.JARVIS_TTS_MODEL || 'eleven_flash_v2_5'
const OUT = join(homedir(), '.jarvis', 'voice-samples')
const api = (path, init = {}) =>
  fetch(`https://api.elevenlabs.io${path}`, { ...init, headers: { 'xi-api-key': key, ...(init.headers ?? {}) } })

const args = process.argv.slice(2)
const all = args.includes('--all')
const only = args.find((a) => !a.startsWith('--'))

const res = await api('/v1/voices')
if (!res.ok) {
  console.error(`ElevenLabs refused the voice list (${res.status}): ${(await res.text()).slice(0, 300)}`)
  process.exit(1)
}
const { voices = [] } = await res.json()
const label = (v, k) => String(v.labels?.[k] ?? '').toLowerCase()
const picked = voices.filter((v) =>
  only ? v.voice_id === only : all || (label(v, 'accent').includes('british') && label(v, 'gender') === 'male'),
)
if (!picked.length) {
  console.error(only ? `No voice ${only} on this account.` : 'No matching voices on this account; try --all.')
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
for (const v of picked) {
  const tts = await api(`/v1/text-to-speech/${v.voice_id}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: LINE, model_id: MODEL, voice_settings: { stability: 0.4, similarity_boost: 0.75, speed: 1.05 } }),
  })
  const name = String(v.name ?? v.voice_id).replace(/[^\w.-]+/g, '_')
  if (!tts.ok) {
    console.log(`  ${name.padEnd(24)} failed (${tts.status})`)
    continue
  }
  const file = join(OUT, `${name}.mp3`)
  writeFileSync(file, Buffer.from(await tts.arrayBuffer()))
  const about = [label(v, 'accent'), label(v, 'age'), label(v, 'description') || label(v, 'descriptive')].filter(Boolean).join(', ')
  console.log(`  ${name.padEnd(24)} JARVIS_VOICE_ID=${v.voice_id}   ${about}`)
}
console.log(`\nSamples are in ${OUT}. Put the id you like in ~/.jarvis/.env and restart the bridge.`)
