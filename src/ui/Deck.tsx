import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BRIDGE_HTTP_URL } from '../config'
import { useStore } from '../store'
import './deck.css'

/**
 * The command deck: dense live panels framing the reactor.
 *
 * Everything on it is real. The bridge's GET /deck returns the laptop's
 * stats, the channels, both pipelines, the autopilot queue and a crypto
 * ticker; this polls it every few seconds. Anything not connected says so
 * rather than showing a made-up number.
 */

type Snapshot = {
  at: string
  core: { model: string; effort: string; writes: boolean }
  system: {
    host: string
    uptimeHours: number
    cpu: { percent: number; cores: number; model?: string }
    memory: { percent: number; usedGB: number; totalGB: number }
    battery: { percent: number; status: string; minutesLeft: number | null } | null
    disks: { drive: string; sizeGB: number; freeGB: number; usedPercent: number | null }[]
    network: { name: string; speed: string }[]
  }
  channels: Record<'youtube' | 'tiktok' | 'instagram', null | { name?: string; followers?: number | null; views?: number | null; likes?: number | null; posts?: number | null; error?: string }>
  pipelines: { board: string; title: string; stages: { stage: string; label: string; approval: boolean; count: number }[] }[]
  autopilot: { enabled: boolean; niche: string | null; times: string[]; queued: number; recent: { title: string; at: string | null; platforms: string[]; status: string }[] }
  crypto: { symbol: string; usd: number | null; change24h: number | null }[]
}

const POLL_MS = 4000

function useDeck() {
  const [data, setData] = useState<Snapshot | null>(null)
  const [down, setDown] = useState(false)
  const cpuHist = useRef<number[]>([])
  useEffect(() => {
    let alive = true
    let timer = 0
    const tick = async () => {
      try {
        const r = await fetch(`${BRIDGE_HTTP_URL}/deck`, { cache: 'no-store' })
        const d = (await r.json()) as Snapshot
        if (!alive) return
        if (d?.system) cpuHist.current = [...cpuHist.current, d.system.cpu.percent].slice(-48)
        setData(d)
        setDown(false)
      } catch {
        if (alive) setDown(true)
      }
      if (alive) timer = window.setTimeout(tick, POLL_MS)
    }
    void tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])
  return { data, down, cpuHist: cpuHist.current }
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

const compact = (n: number | null | undefined) =>
  n == null ? '—' : Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

/* ------------------------------------------------------------- primitives */

function Panel({ code, title, children, className = '' }: { code: string; title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`deck-panel ${className}`}>
      <header className="deck-head">
        <span className="deck-code">{code}</span>
        <span className="deck-title">{title}</span>
        <span className="deck-rule" />
      </header>
      {children}
      <i className="deck-notch tl" />
      <i className="deck-notch br" />
    </section>
  )
}

/** A circular gauge with a tick ring, an arc and a big readout. */
function Ring({ value, label, sub, warn = 85 }: { value: number | null; label: string; sub?: string; warn?: number }) {
  const r = 30
  const c = 2 * Math.PI * r
  const v = value == null ? 0 : Math.max(0, Math.min(100, value))
  const hot = value != null && value >= warn
  return (
    <div className={`ring ${hot ? 'hot' : ''}`}>
      <svg viewBox="0 0 80 80" aria-hidden>
        <g className="ring-ticks">
          {Array.from({ length: 36 }, (_, i) => (
            <line key={i} x1="40" y1="3" x2="40" y2={i % 3 ? 6 : 8} transform={`rotate(${i * 10} 40 40)`} />
          ))}
        </g>
        <circle className="ring-track" cx="40" cy="40" r={r} />
        <circle
          className="ring-arc"
          cx="40"
          cy="40"
          r={r}
          strokeDasharray={`${(v / 100) * c} ${c}`}
          transform="rotate(-90 40 40)"
        />
        <circle className="ring-inner" cx="40" cy="40" r="22" />
      </svg>
      <div className="ring-read">
        <b>{value == null ? '—' : Math.round(v)}</b>
        <small>%</small>
      </div>
      <div className="ring-label">{label}</div>
      {sub && <div className="ring-sub">{sub}</div>}
    </div>
  )
}

function Bar({ value }: { value: number | null }) {
  return (
    <span className="bar">
      <span style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} />
    </span>
  )
}

function Row({ k, v, bar }: { k: string; v: ReactNode; bar?: number | null }) {
  return (
    <div className="deck-row">
      <span className="deck-k">{k}</span>
      {bar !== undefined && <Bar value={bar} />}
      <span className="deck-v">{v}</span>
    </div>
  )
}

function Spark({ points }: { points: number[] }) {
  if (points.length < 2) return <div className="spark empty">sampling…</div>
  const w = 240
  const h = 40
  const step = w / (points.length - 1)
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(h - (p / 100) * h).toFixed(1)}`).join(' ')
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <path className="spark-fill" d={`${d} L${w},${h} L0,${h} Z`} />
      <path className="spark-line" d={d} />
    </svg>
  )
}

/** A slowly turning wireframe globe with pings for each linked platform. */
function Globe({ pings }: { pings: number }) {
  const [rot, setRot] = useState(0)
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const step = (t: number) => {
      setRot((r) => (r + (t - last) * 0.006) % 360)
      last = t
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [])
  const R = 54
  const meridians = Array.from({ length: 12 }, (_, i) => {
    const a = (((i * 30 + rot) % 180) * Math.PI) / 180
    return Math.abs(Math.cos(a)) * R
  })
  const sites = [
    { lon: 121, lat: 14 },
    { lon: -74, lat: 40 },
    { lon: 0, lat: 51 },
    { lon: 139, lat: 35 },
    { lon: -122, lat: 37 },
    { lon: 77, lat: 28 },
  ].slice(0, Math.max(3, pings + 3))
  return (
    <svg className="globe" viewBox="-70 -70 140 140" aria-hidden>
      <circle className="globe-halo" r={R + 9} />
      <circle className="globe-edge" r={R} />
      {[-60, -30, 0, 30, 60].map((lat) => {
        const y = Math.sin((lat * Math.PI) / 180) * R
        const rx = Math.cos((lat * Math.PI) / 180) * R
        return <ellipse key={lat} className="globe-line" cx="0" cy={-y} rx={rx} ry={rx * 0.18} />
      })}
      {meridians.map((rx, i) => (
        <ellipse key={i} className="globe-line" cx="0" cy="0" rx={rx} ry={R} />
      ))}
      {sites.map((s, i) => {
        const lon = ((s.lon + rot + 540) % 360) - 180
        if (Math.abs(lon) > 90) return null
        const x = Math.sin((lon * Math.PI) / 180) * Math.cos((s.lat * Math.PI) / 180) * R
        const y = -Math.sin((s.lat * Math.PI) / 180) * R
        return (
          <g key={i} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
            <circle className="globe-ping" r="5" style={{ animationDelay: `${i * 0.4}s` }} />
            <circle className="globe-dot" r="1.8" />
          </g>
        )
      })}
      <line className="globe-scan" x1={-R} x2={R} y1="0" y2="0" />
    </svg>
  )
}

/* ----------------------------------------------------------------- brain */

type Brain = {
  mode: 'cloud' | 'local'
  model: string | null
  cloud: string
  local: string | null
  cloudModels: { id: string; label: string }[]
  localModels: { id: string; label: string; tools: boolean }[]
  ollama: boolean
}

/**
 * Cloud or local, switched in place. The bridge saves the choice and restarts
 * the voice session; the page reconnects on its own, so nothing to reload.
 */
function BrainSwitch() {
  const [b, setB] = useState<Brain | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const load = async () => {
    try {
      setB(await (await fetch(`${BRIDGE_HTTP_URL}/brain`, { cache: 'no-store' })).json())
    } catch {
      setB(null)
    }
  }
  useEffect(() => {
    void load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [])

  const change = async (patch: Partial<Pick<Brain, 'mode' | 'cloud' | 'local'>>) => {
    setBusy(true)
    setNote('')
    try {
      const r = await fetch(`${BRIDGE_HTTP_URL}/brain`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-jarvis-brain': '1' },
        body: JSON.stringify(patch),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'refused')
      setB(d)
      setNote('switching…')
      setTimeout(() => setNote(''), 2500)
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!b) return <div className="deck-row dim">brain unavailable</div>
  const local = b.mode === 'local'
  return (
    <div className="brain-switch">
      <div className="brain-toggle" role="radiogroup" aria-label="Brain">
        {(['cloud', 'local'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={b.mode === m}
            className={b.mode === m ? 'on' : ''}
            disabled={busy || (m === 'local' && !b.ollama)}
            title={m === 'local' && !b.ollama ? 'Start the Ollama app to use a local brain' : undefined}
            onClick={() => b.mode !== m && void change({ mode: m })}
          >
            {m === 'cloud' ? 'CLOUD' : 'LOCAL'}
          </button>
        ))}
      </div>
      <select
        className="brain-model"
        aria-label="Model"
        disabled={busy}
        value={(local ? b.local : b.cloud) ?? ''}
        onChange={(e) => void change(local ? { local: e.target.value } : { cloud: e.target.value })}
      >
        {(local ? b.localModels : b.cloudModels).map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      <div className="brain-note">
        {note || (local ? 'on this PC · free · offline · weaker with tools' : 'Claude · your subscription · strongest')}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ deck */

const PLATFORM = { youtube: 'YOUTUBE', tiktok: 'TIKTOK', instagram: 'INSTAGRAM' } as const

export function Deck() {
  const { data, down, cpuHist } = useDeck()
  const now = useClock()
  const dim = useStore((s) => s.blades.length > 0)
  const s = data?.system
  const disk = s?.disks?.[0]
  const linked = data ? Object.values(data.channels).filter((c) => c && !c.error).length : 0

  return (
    <div className={`deck ${dim ? 'deck-dim' : ''}`}>
      <div className="deck-clock">
        <b>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</b>
        <span>{now.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</span>
        <span className={`deck-link ${down ? 'off' : ''}`}>{down ? 'BRIDGE OFFLINE' : `CORE · ${data?.core.model ?? '…'}`}</span>
      </div>

      <div className="deck-col deck-left">
        <Panel code="SYS-01" title="System core">
          <div className="rings">
            <Ring value={s?.cpu.percent ?? null} label="CPU" sub={s ? `${s.cpu.cores} cores` : undefined} />
            <Ring value={s?.memory.percent ?? null} label="MEMORY" sub={s ? `${s.memory.usedGB}/${s.memory.totalGB} GB` : undefined} />
            <Ring
              value={s?.battery?.percent ?? null}
              label="POWER"
              sub={s?.battery ? s.battery.status : s ? 'AC' : undefined}
              warn={101}
            />
          </div>
          <Spark points={cpuHist} />
        </Panel>

        <Panel code="SYS-02" title="Telemetry">
          <Row k="HOST" v={s?.host ?? '—'} />
          <Row k="UPTIME" v={s ? `${s.uptimeHours} h` : '—'} />
          <Row k={`DISK ${disk?.drive ?? ''}`} bar={disk?.usedPercent ?? null} v={disk ? `${disk.freeGB} GB free` : '—'} />
          <Row k="NET" v={s?.network?.[0] ? `${s.network[0].name} ${s.network[0].speed}` : 'offline'} />
          <Row k="ACCESS" v={data ? (data.core.writes ? 'FULL CONTROL' : 'READ ONLY') : '—'} />
        </Panel>

        <Panel code="MKT-03" title="Markets">
          {(data?.crypto ?? []).map((c) => (
            <div key={c.symbol} className="tick-row">
              <span className="deck-k">{c.symbol}</span>
              <span className="deck-v">{c.usd == null ? '—' : `$${c.usd.toLocaleString('en', { maximumFractionDigits: c.usd < 10 ? 3 : 0 })}`}</span>
              <span className={`chg ${(c.change24h ?? 0) >= 0 ? 'up' : 'down'}`}>
                {c.change24h == null ? '' : `${c.change24h >= 0 ? '▲' : '▼'} ${Math.abs(c.change24h).toFixed(2)}%`}
              </span>
            </div>
          ))}
          {data && data.crypto.length === 0 && <div className="deck-row dim">ticker unavailable</div>}
        </Panel>

        <Panel code="NET-04" title="Global link" className="deck-globe">
          <Globe pings={linked} />
          <div className="globe-side">
            <Row k="LINKED" v={`${linked}/3`} />
            <Row k="EFFORT" v={data?.core.effort ?? '—'} />
          </div>
        </Panel>
      </div>

      <div className="deck-col deck-right">
        <Panel code="BRN-00" title="Neural core">
          <BrainSwitch />
        </Panel>

        <Panel code="CH-04" title="Channels">
          {(Object.keys(PLATFORM) as (keyof typeof PLATFORM)[]).map((k) => {
            const c = data?.channels[k]
            return (
              <div key={k} className={`chan ${c && !c.error ? '' : 'off'}`}>
                <span className="chan-name">{PLATFORM[k]}</span>
                <span className="chan-big">{c && !c.error ? compact(c.followers) : c?.error ? 'ERROR' : 'NOT LINKED'}</span>
                <span className="chan-sub">
                  {c && !c.error ? `${compact(c.posts)} posts${c.views != null ? ` · ${compact(c.views)} views` : c.likes != null ? ` · ${compact(c.likes)} likes` : ''}` : 'followers'}
                </span>
              </div>
            )
          })}
        </Panel>

        {(data?.pipelines ?? []).map((p, i) => {
          const stages = p.stages.filter((st) => st.stage !== 'lost')
          const total = stages.reduce((a, st) => a + st.count, 0)
          return (
            <Panel key={p.board} code={`OPS-0${5 + i}`} title={p.title}>
              <div className="timeline">
                {stages.map((st) => (
                  <div key={st.stage} className={`tl-step ${st.count ? 'live' : ''} ${st.approval ? 'gate' : ''}`} title={st.label}>
                    <span className="tl-dot" />
                    <span className="tl-count">{st.count}</span>
                  </div>
                ))}
              </div>
              <div className="tl-legend">
                <span>{stages[0]?.label}</span>
                <span>{total} active</span>
                <span>{stages[stages.length - 1]?.label}</span>
              </div>
            </Panel>
          )
        })}

        <Panel code="AUTO-07" title="Autopilot">
          <Row k="STATUS" v={data ? (data.autopilot.enabled ? `ON · ${data.autopilot.niche ?? ''}` : 'STANDBY') : '—'} />
          <Row k="QUEUE" v={data ? `${data.autopilot.queued} waiting` : '—'} />
          <div className="cards">
            {(data?.autopilot.recent ?? []).slice(0, 3).map((q, i) => (
              <div key={i} className={`card card-${q.status}`}>
                <span className="card-title">{q.title}</span>
                <span className="card-meta">
                  {q.platforms.join(' · ')} · {q.status}
                </span>
              </div>
            ))}
            {data && data.autopilot.recent.length === 0 && <div className="card card-empty">No videos queued yet</div>}
          </div>
        </Panel>

      </div>
    </div>
  )
}
