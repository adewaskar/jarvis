/**
 * Live map of what is connected to the local network.
 *
 * Read-only: it pings the /24, reads the OS ARP table, and probes each NEW
 * device once for two ports (554 = IP camera, 1400 = Sonos). Nothing is sent
 * off the machine and nothing is logged in to — cameras are only tagged, never
 * opened. MACs stay local; the HUD shows only the tail.
 *
 * Names: bridge/devices.json, `{ "aa:bb:cc:dd:ee:ff": "Cámara entrada" }`.
 * Re-read every scan, so editing it takes effect without a restart.
 */
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { networkInterfaces } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LABELS = join(dirname(fileURLToPath(import.meta.url)), 'devices.json')
const WIN = process.platform === 'win32'
const EVERY_MS = 10_000

const run = (cmd, args, timeout = 4000) =>
  new Promise((res) =>
    execFile(cmd, args, { timeout, windowsHide: true }, (err, out) => res(err ? '' : String(out))),
  )

/** The /24 of the first private IPv4 interface. ponytail: /24 only. */
function localNet() {
  for (const [name, list] of Object.entries(networkInterfaces())) {
    // Hyper-V/WSL/VM/Docker adapters are private IPv4 too, but not the house LAN.
    if (/vEthernet|WSL|VMware|VirtualBox|Docker|Hyper-V/i.test(name)) continue
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal && /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(i.address)) {
        return { prefix: i.address.split('.').slice(0, 3).join('.'), self: i.address, mac: i.mac }
      }
    }
  }
  return null
}

const ping = (ip) =>
  run('ping', WIN ? ['-n', '1', '-w', '400', ip] : ['-c', '1', '-W', '1', ip], 2000)

/** Ping all 254 hosts, 64 at a time. Returns who answered ICMP (TTL= is locale-proof);
 *  the rest still get ARP-resolved, which is what lists sleeping phones. */
async function sweep(prefix) {
  const alive = new Set()
  const ips = Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`)
  let next = 0
  await Promise.all(
    Array.from({ length: 64 }, async () => {
      while (next < ips.length) {
        const ip = ips[next++]
        if ((await ping(ip)).includes('TTL=')) alive.add(ip)
      }
    }),
  )
  return alive
}

async function arpTable(prefix) {
  const out = await run('arp', ['-a'])
  const rows = new Map()
  for (const m of out.matchAll(/(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f]{2}[-:][0-9a-f:-]{14})\s+dynamic/gi)) {
    if (m[1].startsWith(prefix + '.')) rows.set(m[1], m[2].toLowerCase().replaceAll('-', ':'))
  }
  return rows
}

const open = (ip, port) =>
  new Promise((res) => {
    const s = connect({ host: ip, port, timeout: 1200 })
    s.once('connect', () => (s.destroy(), res(true)))
    s.once('timeout', () => (s.destroy(), res(false)))
    s.once('error', () => res(false))
  })

/** One-time look at a newly seen device. Cached by ip+mac. */
async function classify(ip) {
  if (await open(ip, 554)) return { kind: 'camera' }
  if (await open(ip, 1400)) {
    try {
      const xml = await (await fetch(`http://${ip}:1400/xml/device_description.xml`, { signal: AbortSignal.timeout(1500) })).text()
      return { kind: 'sonos', room: xml.match(/<roomName>([^<]*)</)?.[1] }
    } catch {
      return { kind: 'sonos' }
    }
  }
  return { kind: 'other' }
}

const known = new Map() // `${ip}|${mac}` -> { kind, room?, since }
let snapshot = null
let busy = false

function labels() {
  try {
    return JSON.parse(readFileSync(LABELS, 'utf8'))
  } catch {
    return {}
  }
}

async function scan() {
  const net = localNet()
  if (!net || busy) return
  busy = true
  try {
    const alive = await sweep(net.prefix)
    const table = await arpTable(net.prefix)
    const names = labels()
    const now = Date.now()
    const devices = []
    // ponytail: ARP keeps departed devices ~2 min; `alive` (answered ping) is the
    // trustworthy flag, the rest are "standby" — sleeping phones or just left.
    const fresh = [...table].filter(([ip, mac]) => !known.has(`${ip}|${mac}`))
    await Promise.all(
      fresh.map(async ([ip, mac]) =>
        known.set(`${ip}|${mac}`, { ...(await classify(ip)), since: now }),
      ),
    )
    for (const [ip, mac] of table) {
      const k = known.get(`${ip}|${mac}`)
      devices.push({
        alive: alive.has(ip),
        ip,
        mac,
        name: names[mac] ?? k.room ?? null,
        kind: k.kind,
        // Second hex digit 2/6/a/e = locally administered = phone privacy MAC.
        rand: '26ae'.includes(mac[1]),
        since: k.since,
      })
    }
    devices.push({ ip: net.self, mac: net.mac, name: names[net.mac] ?? 'Esta PC', kind: 'self', alive: true, rand: false, since: 0 })
    devices.sort((a, b) => a.ip.split('.')[3] - b.ip.split('.')[3])
    snapshot = { type: 'lan', at: now, devices }
    return snapshot
  } finally {
    busy = false
  }
}

export const lanSnapshot = () => snapshot

/** Scans while at least one HUD is connected; `push` gets each finished snapshot. */
export function startLan(hasClients, push) {
  const tick = async () => {
    if (!hasClients()) return
    const snap = await scan()
    if (snap) push(snap)
  }
  void tick()
  setInterval(tick, EVERY_MS).unref()
}
