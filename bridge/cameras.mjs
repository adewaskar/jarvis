/**
 * IP-camera viewing: a still per camera for the grid, one live MJPEG for the
 * camera the user zoomed into. Everything goes through ffmpeg on this machine;
 * the browser never sees an RTSP URL or a credential.
 *
 * Credentials live in bridge/cameras.json (gitignored), never in chat or code:
 *   {
 *     "default": { "user": "...", "pass": "...",
 *                  "path": "/Streaming/Channels/101", "sub": "/Streaming/Channels/102" },
 *     "10.0.0.100": { "name": "Entrada" }          // per-camera override, any field
 *   }
 * `path` is the main stream (live view), `sub` the light one (thumbnails). The
 * defaults are the Hikvision-style paths these cameras' fingerprint suggests —
 * override per brand if a camera answers 404.
 *
 * Only IPs that the LAN scan classified as cameras are reachable, so this is
 * not a way to point ffmpeg at arbitrary hosts.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lanSnapshot } from './lan.mjs'

const CONFIG = join(dirname(fileURLToPath(import.meta.url)), 'cameras.json')
const SNAP_TTL_MS = 8000
const MAX_SNAPS = 3 // ffmpeg processes at once for thumbnails
const MAX_LIVE = 2

const snaps = new Map() // ip -> { at, buf?, pending? }
let running = 0
let live = 0
const waiting = []

function config() {
  try {
    return JSON.parse(readFileSync(CONFIG, 'utf8'))
  } catch {
    return {}
  }
}

function rtspFor(ip, sub) {
  const cfg = config()
  const c = { path: '/Streaming/Channels/101', sub: '/Streaming/Channels/102', ...cfg.default, ...cfg[ip] }
  if (!c.user || !c.pass) return null
  // ponytail: credentials are in ffmpeg's argv, visible to other local processes.
  return `rtsp://${encodeURIComponent(c.user)}:${encodeURIComponent(c.pass)}@${ip}:554${sub ? c.sub : c.path}`
}

const slot = () =>
  running < MAX_SNAPS ? (running++, Promise.resolve()) : new Promise((r) => waiting.push(r))
const release = () => {
  const next = waiting.shift()
  if (next) next()
  else running--
}

const ffmpeg = (args) =>
  spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', ...args], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  })

function snapshot(url, ip) {
  const cached = snaps.get(ip)
  if (cached?.pending) return cached.pending
  if (cached?.buf && Date.now() - cached.at < SNAP_TTL_MS) return Promise.resolve(cached.buf)
  const pending = (async () => {
    await slot()
    try {
      return await new Promise((res, rej) => {
        const p = ffmpeg(['-i', url, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '6', '-f', 'image2pipe', '-c:v', 'mjpeg', '-'])
        const chunks = []
        const timer = setTimeout(() => p.kill('SIGKILL'), 9000)
        p.stdout.on('data', (d) => chunks.push(d))
        p.on('error', () => rej(new Error('ffmpeg no encontrado')))
        p.on('close', () => {
          clearTimeout(timer)
          const buf = Buffer.concat(chunks)
          buf.length ? res(buf) : rej(new Error('sin imagen'))
        })
      })
    } finally {
      release()
    }
  })()
  snaps.set(ip, { at: Date.now(), pending })
  pending.then(
    (buf) => snaps.set(ip, { at: Date.now(), buf }),
    () => snaps.delete(ip),
  )
  return pending
}

/** Returns true when the request was a /cam/ one and has been answered. */
export function handleCamera(req, res, cors, originAllowed) {
  const m = req.method === 'GET' && /^\/cam\/(\d{1,3}(?:\.\d{1,3}){3})\/(snap|live)(?:\?|$)/.exec(req.url ?? '')
  if (!m) return false
  const [, ip, mode] = m
  const fail = (code, msg) => (res.writeHead(code, { ...cors, 'content-type': 'text/plain' }), res.end(msg), true)

  // <img> loads carry no Origin, so the Referer is the only thing that tells the
  // HUD from some other page in the browser trying to embed a camera.
  let from = ''
  try {
    from = new URL(req.headers.referer ?? '').origin
  } catch {}
  if (!from || !originAllowed(from)) return fail(403, 'forbidden')

  const isCamera = lanSnapshot()?.devices.some((d) => d.ip === ip && d.kind === 'camera')
  if (!isCamera) return fail(404, 'not a known camera')
  const url = rtspFor(ip, mode === 'snap')
  if (!url) return fail(401, 'sin credenciales')

  if (mode === 'snap') {
    snapshot(url, ip).then(
      (buf) => {
        res.writeHead(200, { ...cors, 'content-type': 'image/jpeg', 'cache-control': 'no-store' })
        res.end(buf)
      },
      (err) => fail(502, err.message),
    )
    return true
  }

  if (live >= MAX_LIVE) return fail(429, 'demasiadas vistas en vivo')
  live++
  const p = ffmpeg(['-i', url, '-an', '-vf', 'scale=1280:-2', '-r', '10', '-q:v', '5', '-f', 'mpjpeg', '-boundary_tag', 'frame', '-'])
  res.writeHead(200, { ...cors, 'content-type': 'multipart/x-mixed-replace;boundary=frame', 'cache-control': 'no-store' })
  p.stdout.pipe(res)
  // Closing the viewer must stop the stream, or ffmpeg keeps pulling video forever.
  const stop = () => {
    if (p.exitCode === null) p.kill('SIGKILL')
  }
  res.on('close', stop)
  p.on('close', () => {
    live--
    res.end()
  })
  return true
}
