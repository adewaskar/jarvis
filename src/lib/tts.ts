import {
  env,
  USE_ELEVENLABS,
  BACKEND,
  TTS_ENGINE,
  KOKORO_VOICE,
  BRIDGE_HTTP_URL,
} from '../config'
import * as kokoro from './kokoro'
import { caps } from './capabilities'

/**
 * Speech output.
 *
 * The browser's own speechSynthesis is the default because it is by far the
 * fastest thing available: it runs on-device, so there is no request, no
 * generation wait and no download — speech starts on the next frame. A cloud
 * voice sounds better but costs a few hundred milliseconds per sentence, and in
 * conversation that gap is much more noticeable than the timbre.
 *
 * Either way, text is cut at sentence boundaries as it streams in and spoken a
 * sentence at a time, so JARVIS starts talking while Claude is still writing.
 *
 * The queue is an explicit array with a single pump rather than a promise
 * chain. A chain cannot be cut: cancelling mid-sentence left the chain's tail
 * unresolved forever, which wedged the whole assistant. An array can simply be
 * emptied.
 */

type Speaker = {
  /** Feed streamed text in. Complete sentences are spoken as they appear. */
  push: (delta: string) => void
  /** Speak a phrase ahead of anything still queued. Used for filler like
   *  "Working on it, sir" while a tool runs. */
  say: (text: string) => void
  /** No more text coming — flush the remainder and resolve when audio ends. */
  end: () => Promise<void>
  /** Cut it off mid-sentence (barge-in). Always settles `end()`. */
  cancel: () => void
  /** 0..1 output loudness for the visualiser. */
  level: () => number
}

// ---------------------------------------------------------------------------
// What he is saying right now
// ---------------------------------------------------------------------------

let speaking = ''
let recent = ''
let recentUntil = 0

/** Recognition lags the speakers by a few hundred milliseconds, so a sentence
 *  keeps arriving at the microphone well after it has finished playing. */
const ECHO_TAIL_MS = 1800

/**
 * Why you cannot hear him.
 *
 * Published on `window.__tts`. Speech has exactly four ways to fail silently —
 * the engine never started, the OS voice errored, every line was cancelled by
 * a barge-in, or nothing was ever queued — and from outside the page they are
 * indistinguishable. This tells them apart at a glance.
 */
export const diag = {
  engine: 'system' as 'system' | 'kokoro' | 'elevenlabs' | 'fish',
  /** Utterances handed to an engine — the OS voice or an audio element. */
  spoken: 0,
  /**
   * Of those, how many actually began producing sound.
   *
   * Counted for EVERY engine, which it did not used to be: this was incremented
   * only in speakNative's onstart, so on the ElevenLabs path — the good path,
   * the one a configured machine actually uses — it stayed at zero forever.
   * The diagnostics panel reads this to decide whether he is audible at all, so
   * a working cloud voice reported "no sound produced", and the T self-test
   * raised that as an error on screen. The verdict has to be about sound, not
   * about which code path produced it.
   */
  started: 0,
  /** Genuine engine failures, excluding deliberate cancels. */
  failures: 0,
  /** Last SpeechSynthesis error code, e.g. 'synthesis-failed'. */
  lastError: '',
  /** Set once the OS voice has proved unusable; the cloud voice takes over. */
  nativeBroken: false,
  /** Sentences rescued by the bridge's ElevenLabs proxy. */
  rescued: 0,
  voice: '',
  lastText: '',
}

if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__tts = diag
}

/**
 * Once the OS voice has failed, stop asking it.
 *
 * A broken system voice is not a transient condition — it fails identically on
 * every sentence — so retrying it per line would make the whole answer stutter
 * through the same dead path. After the first real failure everything routes to
 * the bridge's speech proxy instead, which holds an ElevenLabs key already.
 */
let nativeBroken = false

let speakingAt = 0

/** When the current sentence started, or 0 if nothing is being spoken. The
 *  voice loop uses this to refuse to interrupt him in his own first syllable. */
export function speakingSince(): number {
  return speaking ? speakingAt : 0
}

function setSpeaking(text: string) {
  if (text) {
    speaking = text
    speakingAt = Date.now()
    return
  }
  if (speaking) {
    recent = speaking
    recentUntil = Date.now() + ECHO_TAIL_MS
  }
  speaking = ''
}

/**
 * What the microphone is likely to be hearing from the speakers right now.
 *
 * The voice loop reads this to recognise itself: the mic stays open while he
 * talks, so it hears every word he says and would otherwise treat his own
 * answer as a barge-in. Includes a short tail of the previous sentence,
 * because the gap between two sentences is exactly when the echo of the first
 * one lands. See `isEcho` in voice.ts.
 */
export function speakingNow(): string {
  const tail = Date.now() < recentUntil ? recent : ''
  return `${speaking} ${tail}`.trim()
}

// ---------------------------------------------------------------------------
// Sentence boundaries
// ---------------------------------------------------------------------------

/** Sentence end, allowing a closing quote or bracket — curly ones included,
 *  since models emit typographic punctuation far more often than ASCII. */
const SENTENCE_END = /([.!?]["'')\]”’]?\s)|(\n\n)/

/** Full stops that are not sentence ends. Cutting on these puts an audible
 *  gap inside "Mr. Stark" and reads as a stutter. */
const ABBREVIATION =
  /(?:^|\s)(mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e|approx|inc|ltd|co|no|vol|fig|dept|est|min|max|hr|hrs|a\.m|p\.m|u\.s|u\.k|no)\.$/i

/**
 * Nobody punctuates forever, but a model occasionally writes a long clause
 * with no terminator at all — and while it does, nothing is spoken. Past this
 * many characters, cut at the last word boundary and start talking.
 */
const MAX_UNSPOKEN = 220

// ---------------------------------------------------------------------------
// Voice selection
// ---------------------------------------------------------------------------

const VOICE_PREF_KEY = 'jarvis.voice'

/**
 * Rank installed voices by how close they are to the character: a British
 * male, low and level, not a novelty voice.
 *
 * The big win on macOS is the Enhanced/Premium variant of Daniel. The stock
 * "Daniel" is a compact voice from a decade ago and sounds it; the Enhanced
 * download is free (System Settings → Accessibility → Spoken Content → System
 * Voice → Manage Voices) and once installed it appears here automatically.
 */
function score(v: SpeechSynthesisVoice): number {
  const n = v.name.toLowerCase()
  let s = 0

  // The macOS British male, and the closest thing to the character available
  // without leaving the machine.
  if (n.startsWith('daniel')) s += 100
  else if (n.includes('google uk english male')) s += 85
  else if (/\b(oliver|arthur|jamie|malcolm)\b/.test(n)) s += 80
  // Newer macOS en-GB male voices — casual, but serviceable.
  else if (/\b(reed|rocko|eddy)\b/.test(n)) s += 40

  // Higher-quality variants of whatever matched above.
  if (n.includes('premium')) s += 30
  else if (n.includes('enhanced')) s += 20

  if (/en[-_]gb/i.test(v.lang)) s += 25
  else if (/^en/i.test(v.lang)) s += 5

  // Voices that clearly aren't a butler.
  if (/grandma|grandpa|bubbles|jester|bells|boing|whisper|zarvox|superstar|trinoids|wobble|bahh|organ|cellos|bad news|good news/.test(n)) {
    s -= 200
  }
  // Female-presenting names across the English sets.
  if (/\b(flo|sandy|shelley|kate|serena|fiona|moira|karen|tessa|samantha|zoe|allison|ava|susan)\b/.test(n)) {
    s -= 60
  }

  return s
}

/** Only voices that scored on a name match, not merely on being English —
 *  otherwise the picker cycles through a dozen US novelty voices. */
const USABLE = 40

/** Best-first list of usable voices — also what the voice picker cycles. */
export function candidateVoices(): SpeechSynthesisVoice[] {
  return speechSynthesis
    .getVoices()
    .filter((v) => /^en/i.test(v.lang))
    .map((v) => ({ v, s: score(v) }))
    .filter((x) => x.s >= USABLE)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.v)
}

let cachedVoice: SpeechSynthesisVoice | null | undefined

function pickVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice !== undefined) return cachedVoice
  const all = speechSynthesis.getVoices()
  if (!all.length) return null // not loaded yet — try again next utterance

  // Honour an explicit choice made with the voice picker. A saved name that no
  // longer resolves is dropped rather than left to resurrect itself silently
  // if that voice is ever reinstalled.
  const saved = localStorage.getItem(VOICE_PREF_KEY)
  if (saved) {
    const hit = all.find((v) => v.name === saved)
    if (hit) return (cachedVoice = hit)
    localStorage.removeItem(VOICE_PREF_KEY)
  }

  cachedVoice = candidateVoices()[0] ?? all.find((v) => /^en/i.test(v.lang)) ?? null
  return cachedVoice
}

/** What the HUD should show. Reports the engine actually in use rather than
 *  always naming a speechSynthesis voice that a cloud or neural engine has
 *  quietly replaced. */
export function currentVoiceName(): string {
  if (caps().tts && caps().voice === 'fish') return 'Fish Audio'
  if (USE_ELEVENLABS || caps().tts) return 'ElevenLabs'
  if (TTS_ENGINE === 'kokoro' && !kokoro.isUnavailable()) {
    return KOKORO_VOICE.replace(/^bm_/, '')
  }
  return pickVoice()?.name ?? 'default'
}

/** Step to the next candidate — lets you audition voices on your own machine
 *  rather than trusting a ranking to be right about how they sound. */
export function cycleVoice(): string {
  const list = candidateVoices()
  if (!list.length) return 'default'
  const now = pickVoice()
  const i = list.findIndex((v) => v.name === now?.name)
  const next = list[(i + 1) % list.length]
  localStorage.setItem(VOICE_PREF_KEY, next.name)
  cachedVoice = next
  return next.name
}

// Voices load asynchronously in Chrome; the first call usually returns nothing.
if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.addEventListener('voiceschanged', () => {
    cachedVoice = undefined
    pickVoice()
  })
  pickVoice()
}

// ---------------------------------------------------------------------------
// Shared output analyser
// ---------------------------------------------------------------------------

/**
 * One AudioContext for every sentence ever spoken.
 *
 * Blink caps a document at roughly six concurrent hardware contexts. Building
 * one per sentence and never closing it meant the visualiser died partway
 * through the first long answer, silently, because the constructor throw was
 * caught and ignored.
 */
let outCtx: AudioContext | null = null

function outputContext(): AudioContext | null {
  try {
    if (!outCtx) outCtx = new AudioContext()
    if (outCtx.state === 'suspended') void outCtx.resume()
    return outCtx
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------

/**
 * Nudge the delivery toward JARVIS's cadence.
 *
 * speechSynthesis ignores SSML, so punctuation is the only prosody control
 * available — the engine pauses on commas and full stops. Making sure the
 * vocative "sir" is always set off by a comma buys the small beat before it
 * that does most of the characterisation.
 */
function shape(text: string): string {
  return (
    text
      // Models leak markdown even when told not to, and a synthesiser will
      // happily read "https colon slash slash" out loud. Strip the syntax and
      // keep the words.
      .replace(/^\s*Sources?:.*$/gim, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [label](url) -> label
      // Stop before trailing punctuation, so "See https://x.com." keeps the
      // full stop that ends the sentence rather than having it eaten.
      .replace(/https?:\/\/[^\s]*[^\s.,;:!?)\]]/g, '')
      .replace(/[*_`#>]+/g, '')
      .replace(/^\s*[-•]\s+/gm, '')
      // The vocative wants its comma — that small beat before "sir" does most
      // of the characterisation. Anchored to a following pause or end of line
      // so the honorific is left alone: "Sir Isaac Newton" is not a vocative.
      .replace(/([^,\s])\s+(sir)(\s*[.,!?;:]|\s*$)/gi, '$1, $2$3')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/** Generated audio, tagged with the engine that actually produced it — the
 *  bridge can fail and the direct ElevenLabs key answer instead. */
type AudioResult = { url: string; engine: 'kokoro' | 'elevenlabs' | 'fish' }

type Item = {
  text: string
  /** Generation starts one sentence ahead, not all at once. */
  audio?: Promise<AudioResult | null> | null
}

export function createSpeaker(): Speaker {
  const queue: Item[] = []
  let buffer = ''
  let cancelled = false
  let outLevel = 0
  let pumping = false

  let currentAudio: HTMLAudioElement | null = null
  let nativeInFlight = false
  let drained: Array<() => void> = []

  const settleDrained = () => {
    const waiting = drained
    drained = []
    for (const r of waiting) r()
  }

  const enqueue = (sentence: string, priority = false) => {
    if (cancelled) return
    // Shape once here so both engines get the same text — stripped markdown,
    // and the comma before "sir" that buys the beat.
    const text = shape(sentence)
    if (!text) return

    const item: Item = { text }
    if (priority) {
      // Genuinely ahead of the queue this time. The old `say()` appended to the
      // same chain and only appeared to preempt because it was called when the
      // queue happened to be empty.
      queue.unshift(item)
    } else {
      queue.push(item)
    }
    void pump()
  }

  /** null means "no audio pipeline, use the system voice directly". */
  function synthesise(text: string): Promise<AudioResult | null> | null {
    // Prefer the ElevenLabs voice whenever the bridge reports it is available —
    // for a demo the timbre is worth the round trip, and this is what makes the
    // premium path automatic with no flag to set. It falls back to the browser
    // voice on any failure, so a student without a key still hears him speak.
    // `nativeBroken` latches on once the system voice has proved unusable.
    if (USE_ELEVENLABS || caps().tts || nativeBroken) {
      // Recorded at the moment the tier is chosen rather than only when the
      // native voice latches over. Without this the panel reported 'system'
      // for a session that had spoken every one of its sentences through
      // ElevenLabs, which makes the one field naming the engine useless
      // exactly when you are trying to work out which engine is at fault.
      diag.engine = caps().voice === 'fish' ? 'fish' : 'elevenlabs'
      return fetchCloudAudio(text).catch(() => null)
    }
    if (TTS_ENGINE === 'kokoro' && !kokoro.isUnavailable()) {
      diag.engine = 'kokoro'
      return kokoro
        .speak(text)
        .then((url) => (url ? { url, engine: 'kokoro' as const } : null))
        .catch(() => null)
    }
    diag.engine = 'system'
    return null
  }

  /** Start generating an item's audio if it hasn't begun. */
  const prime = (item: Item | undefined) => {
    if (item && item.audio === undefined) item.audio = synthesise(item.text)
  }

  async function pump(): Promise<void> {
    if (pumping) return
    pumping = true
    try {
      for (;;) {
        if (cancelled) break
        const item = queue.shift()
        if (!item) break

        prime(item)
        // Exactly one sentence ahead. Priming the whole queue fires every
        // request at once — four parallel cloud POSTs, or four concurrent
        // generations against a single ONNX session.
        prime(queue[0])

        await speakOne(item)
      }
    } finally {
      pumping = false
      if (cancelled || !queue.length) settleDrained()
    }
  }

  async function speakOne(item: Item): Promise<void> {
    if (cancelled) return
    setSpeaking(item.text)
    try {
      const audio = item.audio ? await item.audio : null
      if (cancelled) return
      // A failed generation is not a failed turn — drop to the system voice.
      // diag.engine is set again here, at playback, so it names the engine
      // that was actually heard rather than the one that was attempted.
      if (audio) {
        diag.engine = audio.engine
        await playUrl(audio.url, item.text)
        return
      }

      diag.engine = 'system'
      const spoke = await speakNative(item.text)
      if (spoke || cancelled) return

      // The OS voice produced no sound. That is not recoverable by retrying it,
      // so latch it off and rescue this sentence through the bridge's speech
      // proxy — which already holds an ElevenLabs key borrowed from the MCP
      // config. Losing the better timbre is a far smaller failure than a
      // assistant that answers in silence.
      if (!nativeBroken) {
        nativeBroken = true
        diag.nativeBroken = true
        diag.engine = caps().voice === 'fish' ? 'fish' : 'elevenlabs'
        console.warn('[jarvis] system voice is not producing sound — using the bridge speech proxy from here on')
      }
      const rescue = await fetchCloudAudio(item.text).catch(() => null)
      if (rescue && !cancelled) {
        diag.rescued++
        diag.engine = rescue.engine
        await playUrl(rescue.url, item.text)
      }
    } finally {
      if (speaking === item.text) setSpeaking('')
    }
  }

  const speakNative = (text: string) =>
    new Promise<boolean>((resolve) => {
      // Chrome's speechSynthesis wedges after cancel().
      //
      // This is the single most likely reason a whole session goes silent. The
      // engine is a global singleton, `cancel()` can leave its queue in a state
      // where every subsequent speak() is accepted and then never spoken — no
      // error, no events, just silence for the rest of the page's life. Barge-in
      // calls cancel() constantly now that the microphone stays open, so what
      // used to be a rare quirk became the common case.
      //
      // resume() is the documented un-wedge. It is a no-op when nothing is
      // paused, so it is safe to fire before every utterance.
      speechSynthesis.resume()

      const u = new SpeechSynthesisUtterance(text)
      const voice = pickVoice()
      if (voice) u.voice = voice
      u.lang = voice?.lang ?? 'en-GB'
      // Deliberate, and deliberately invariant — the character's pace does not
      // change with stakes, and that steadiness is most of the effect. This
      // lands around 130 wpm, below the median for film dialogue.
      u.rate = 0.92
      // Mid-baritone, and *not* pushed lower for gravitas. The voice is
      // clarity-weighted rather than chest-weighted; dropping it further reads
      // as a film-trailer voiceover, which is the wrong character entirely.
      u.pitch = 0.95

      // speechSynthesis exposes no amplitude, so drive the reactor from a
      // synthetic envelope. It only has to look like speech, not match it.
      let raf = 0
      let t = 0
      const tick = () => {
        t += 0.08
        outLevel =
          0.35 +
          Math.abs(Math.sin(t * 2.1)) * 0.3 +
          Math.abs(Math.sin(t * 5.7)) * 0.2
        raf = requestAnimationFrame(tick)
      }
      tick()

      let done = false
      let started = false
      let watchdog: ReturnType<typeof setTimeout> | null = null
      let keepalive: ReturnType<typeof setInterval> | null = null

      const finish = () => {
        if (done) return
        done = true
        nativeInFlight = false
        if (watchdog) clearTimeout(watchdog)
        if (keepalive) clearInterval(keepalive)
        cancelAnimationFrame(raf)
        // Held rather than zeroed, so the orb doesn't collapse in the gap
        // between two sentences of the same answer.
        outLevel = 0.12
        // The whole point of the boolean: `true` only if sound actually began.
        resolve(started)
      }

      u.onstart = () => {
        started = true
        diag.started++
        diag.lastError = ''
        if (watchdog) clearTimeout(watchdog)
        // Chrome stops speaking after roughly fifteen seconds unless the engine
        // is nudged. A pause/resume pair is the standard keepalive and is
        // inaudible; without it long answers cut off mid-sentence.
        keepalive = setInterval(() => {
          if (done) return
          speechSynthesis.pause()
          speechSynthesis.resume()
        }, 5000)
      }
      u.onend = finish
      // Swallowing this was a mistake. When the OS voice fails there is no
      // other signal at all — no exception, no silence you can detect from
      // code — so an unlogged onerror turns a broken voice into an unexplained
      // quiet app, which is exactly the bug that took three attempts to find.
      u.onerror = (e) => {
        const code = String((e as SpeechSynthesisErrorEvent).error ?? 'unknown')
        diag.lastError = code
        // 'interrupted' and 'canceled' are us, cancelling deliberately on a
        // barge-in. Everything else means the engine could not speak.
        if (code !== 'interrupted' && code !== 'canceled') {
          diag.failures++
          console.error(`[jarvis] speech failed (${code}) on voice "${u.voice?.name ?? 'default'}"`)
        }
        finish()
      }

      // If `start` never arrives the engine has swallowed the utterance, and
      // nothing else will ever tell us — no error fires. Un-wedge and try once
      // more; if that also goes nowhere, resolve rather than hang, because a
      // silent sentence is recoverable and a stuck queue is not.
      watchdog = setTimeout(() => {
        if (done || started) return
        console.warn('[jarvis] speech did not start — un-wedging the engine')
        speechSynthesis.cancel()
        speechSynthesis.resume()
        try {
          speechSynthesis.speak(u)
        } catch {
          finish()
          return
        }
        watchdog = setTimeout(() => {
          if (done || started) return
          console.error('[jarvis] speech engine is not responding — switching to the cloud voice')
          diag.failures++
          diag.lastError = diag.lastError || 'no-start'
          finish()
        }, 1500)
      }, 700)
      diag.spoken++
      diag.lastText = text.slice(0, 60)
      diag.voice = u.voice?.name ?? 'default'
      nativeInFlight = true
      speechSynthesis.speak(u)
    })

  const playUrl = (url: string, text: string) =>
    new Promise<void>((resolve) => {
      const audio = new Audio(url)
      currentAudio = audio
      // The generated path is an engine speaking just as much as the OS voice
      // is, so it keeps the same books. `spoken` counts the hand-off, `started`
      // is only incremented once the element reports it is actually playing —
      // see the onplaying handler below.
      diag.spoken++
      diag.lastText = text.slice(0, 60)
      diag.voice =
        diag.engine === 'kokoro' ? KOKORO_VOICE : diag.engine === 'fish' ? 'Fish Audio' : 'ElevenLabs'

      let read: (() => number) | null = null
      const ctx = outputContext()
      if (ctx) {
        try {
          const analyser = ctx.createAnalyser()
          analyser.fftSize = 256
          ctx.createMediaElementSource(audio).connect(analyser)
          analyser.connect(ctx.destination)
          const bins = new Uint8Array(analyser.frequencyBinCount)
          read = () => {
            analyser.getByteFrequencyData(bins as Uint8Array<ArrayBuffer>)
            let sum = 0
            for (let i = 2; i < bins.length; i++) sum += bins[i]
            return Math.min(1, (sum / (bins.length - 2) / 255) * 3.5)
          }
        } catch {
          /* the analyser is a nice-to-have */
        }
      }

      let raf = 0
      const tick = () => {
        outLevel = read ? read() : 0.4
        raf = requestAnimationFrame(tick)
      }
      tick()

      let done = false
      const finish = () => {
        if (done) return
        done = true
        cancelAnimationFrame(raf)
        outLevel = 0.12
        URL.revokeObjectURL(url)
        if (currentAudio === audio) currentAudio = null
        resolve()
      }
      // Sound is genuinely coming out. This is the cloud/neural counterpart of
      // SpeechSynthesisUtterance.onstart, and it is what makes the diagnostics
      // verdict — and the T self-test — tell the truth on the premium path.
      audio.onplaying = () => {
        diag.started++
        diag.lastError = ''
      }
      audio.onended = finish
      audio.onerror = () => {
        // A decode or network failure on a blob we already hold is rare, but
        // silent when it happens: the sentence simply never plays and the queue
        // moves on. Count it rather than letting it look like nothing was said.
        diag.failures++
        diag.lastError = 'audio-element'
        finish()
      }
      // The one that matters for barge-in: cancel() pauses the element, and a
      // paused element never fires `ended`. Without this the promise never
      // settles and every await behind it hangs for the life of the page.
      audio.onpause = finish
      void audio.play().catch((err) => {
        diag.failures++
        diag.lastError = String((err as Error)?.name ?? 'play-rejected')
        finish()
      })
    })

  return {
    say(text) {
      enqueue(text, true)
    },
    push(delta) {
      if (cancelled) return
      buffer += delta

      // Drain every complete sentence sitting in the buffer.
      for (;;) {
        const m = SENTENCE_END.exec(buffer)
        if (!m) break
        const cut = m.index + m[0].length
        const candidate = buffer.slice(0, cut)
        // "Mr. Stark" is not two sentences. Leave the text in the buffer and
        // wait for a boundary that actually ends something.
        if (ABBREVIATION.test(candidate.trimEnd())) {
          const rest = buffer.slice(cut)
          if (!SENTENCE_END.test(rest)) break
          // Re-scan from after this false boundary by folding it forward.
          const next = SENTENCE_END.exec(rest)!
          const wider = cut + next.index + next[0].length
          enqueue(buffer.slice(0, wider))
          buffer = buffer.slice(wider)
          continue
        }
        enqueue(candidate)
        buffer = buffer.slice(cut)
      }

      // Unpunctuated prose would otherwise sit here silently until the answer
      // ended, defeating the whole point of streaming.
      if (buffer.length > MAX_UNSPOKEN) {
        const cut = buffer.lastIndexOf(' ', MAX_UNSPOKEN)
        if (cut > 40) {
          enqueue(buffer.slice(0, cut))
          buffer = buffer.slice(cut)
        }
      }
    },
    async end() {
      if (buffer.trim()) {
        enqueue(buffer)
        buffer = ''
      }
      if (cancelled) return
      if (!pumping && !queue.length) return
      await new Promise<void>((resolve) => drained.push(resolve))
    },
    cancel() {
      if (cancelled) return
      cancelled = true
      buffer = ''
      queue.length = 0
      // Keep the echo tail: the words already in the air still have to be
      // recognised and discarded, even though he has stopped adding to them.
      setSpeaking('')

      // Only reach for the global cancel if this speaker actually has a native
      // utterance out — speechSynthesis.cancel() is document-wide and would
      // otherwise silence an unrelated speaker mid-word.
      if (nativeInFlight) {
        nativeInFlight = false
        speechSynthesis.cancel()
        // Always pair the cancel with a resume — see the note in speakNative.
        // Leaving the engine cancelled is what silences every later sentence.
        speechSynthesis.resume()
      }
      if (currentAudio) {
        currentAudio.pause()
        currentAudio = null
      }
      outLevel = 0
      settleDrained()
    },
    level: () => outLevel,
  }
}

/** Only used when USE_ELEVENLABS is on. Bridge proxy first (it already holds
 *  the key), then a direct key, then null to fall back to the native voice. */
async function fetchCloudAudio(text: string): Promise<AudioResult | null> {
  if (BACKEND === 'bridge') {
    try {
      const res = await fetch(`${BRIDGE_HTTP_URL}/tts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (res.ok) {
        return {
          url: URL.createObjectURL(await res.blob()),
          engine: caps().voice === 'fish' ? 'fish' : 'elevenlabs',
        }
      }
    } catch {
      /* fall through */
    }
  }

  if (env.elevenKey) {
    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${env.elevenVoiceId}/stream` +
          `?output_format=mp3_22050_32&optimize_streaming_latency=3`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': env.elevenKey,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_flash_v2_5',
            voice_settings: {
              stability: 0.4,
              similarity_boost: 0.75,
              speed: 1.05,
            },
          }),
        },
      )
      if (res.ok) {
        return { url: URL.createObjectURL(await res.blob()), engine: 'elevenlabs' }
      }
    } catch {
      /* fall through */
    }
  }

  return null
}
