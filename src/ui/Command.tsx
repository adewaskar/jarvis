import { useEffect, useState, type ReactNode } from 'react'
import { useStore, type Phase } from '../store'
import { BrainSwitch, compact, useDeck, type Snapshot } from './Deck'
import { Holo } from './Holo'
import './command.css'

/**
 * The Command Center: JARVIS's full-screen dashboard, laid out around the
 * reactor. Every number comes from the bridge's GET /deck (the laptop, the
 * channels, the pipelines, the autopilot, security, weather and today's log).
 * Anything not connected or not tracked says so; nothing here is invented.
 *
 * Buttons and the command bar send text to JARVIS through a `jarvis:command`
 * window event, which App.tsx answers exactly like a spoken request.
 */

export const sendCommand = (text: string) => {
  const t = text.trim()
  if (t) window.dispatchEvent(new CustomEvent('jarvis:command', { detail: t }))
}

const PHASE_LABEL: Record<Phase, string> = {
  offline: 'OFFLINE',
  boot: 'STARTING',
  dormant: 'ONLINE • READY',
  waking: 'ONLINE',
  listening: 'LISTENING',
  thinking: 'THINKING',
  tooling: 'WORKING',
  speaking: 'SPEAKING',
}

const NAV: { icon: string; label: string; ask?: string }[] = [
  { icon: '◈', label: 'Command Center' },
  { icon: '◎', label: 'Agents', ask: 'Give me a short status report on every one of your agents and standing jobs.' },
  { icon: '▤', label: 'Business', ask: 'Show me the agency pipeline and where every lead stands.' },
  { icon: '▦', label: 'Websites', ask: 'Show me the websites and demos we have built so far.' },
  { icon: '▶', label: 'YouTube', ask: 'Show me the YouTube channel stats and the next Shorts in the queue.' },
  { icon: '⌕', label: 'Research', ask: 'What is trending in our YouTube niche this week? Show me the top examples.' },
  { icon: '$', label: 'Finance', ask: 'Show me the crypto prices and any money we are tracking.' },
  { icon: '▣', label: 'Calendar', ask: 'What is on my calendar this week?' },
  { icon: '◔', label: 'Notifications', ask: 'Is there anything that needs my attention right now?' },
  { icon: '⚙', label: 'Settings' },
  { icon: '⌘', label: 'System', ask: 'Run the security check and give me a quick system health report.' },
]

const QUICK = [
  { icon: '▶', label: 'Make a YouTube Short', ask: 'Make the next YouTube Short in our cinematic format and show it to me before uploading.' },
  { icon: '▤', label: 'Channel report', ask: 'Give me a report on the YouTube channel: views, subscribers and what is working.' },
  { icon: '⌕', label: 'Research task', ask: 'Research the three best "What if" space topics for our next Shorts and show them to me.' },
  { icon: '⛨', label: 'Security check', ask: 'Run the security check now and tell me the result.' },
  { icon: '◔', label: 'What needs me?', ask: 'What needs my attention or approval right now?' },
]

/* -------------------------------------------------------------- helpers */

function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

const weatherIcon = (code: number | null | undefined, day = true) => {
  if (code == null) return '·'
  if (code === 0) return day ? '☀' : '☾'
  if (code <= 2) return day ? '⛅' : '☁'
  if (code === 3 || code === 45 || code === 48) return '☁'
  if (code >= 71 && code <= 77) return '❄'
  if (code >= 85 && code <= 86) return '❄'
  if (code >= 95) return '⚡'
  return '☂'
}

const greeting = (h: number) => (h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening')

function Panel({ title, link, area, children, className = '' }: { title: string; link?: { label: string; ask: string }; area: string; children: ReactNode; className?: string }) {
  return (
    <section className={`cmd-panel ${className}`} style={{ gridArea: area }}>
      <header className="cmd-panel-head">
        <span className="cmd-panel-title">{title}</span>
        {link && (
          <button className="cmd-link" onClick={() => sendCommand(link.ask)}>
            {link.label} →
          </button>
        )}
      </header>
      <div className="cmd-panel-body">{children}</div>
    </section>
  )
}

function Check({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  return (
    <div className="cmd-check">
      <span className={`cmd-tick ${ok === true ? 'ok' : ok === false ? 'bad' : 'idle'}`}>{ok === true ? '✓' : ok === false ? '!' : '–'}</span>
      <span>{children}</span>
    </div>
  )
}

function HealthRing({ value }: { value: number }) {
  const r = 34
  const c = 2 * Math.PI * r
  const label = value >= 90 ? 'Excellent' : value >= 70 ? 'Good' : 'Needs attention'
  return (
    <div className="cmd-health">
      <svg viewBox="0 0 84 84" className="cmd-ring">
        <circle cx="42" cy="42" r={r} className="cmd-ring-track" />
        <circle cx="42" cy="42" r={r} className="cmd-ring-fill" strokeDasharray={`${(c * value) / 100} ${c}`} />
        <text x="42" y="47" textAnchor="middle" className="cmd-ring-text">{value}%</text>
      </svg>
      <div>
        <div className="cmd-dim">Overall health</div>
        <div className={`cmd-health-label ${value >= 70 ? 'ok' : 'bad'}`}>{label}</div>
      </div>
    </div>
  )
}

function Bar({ value, tone = '' }: { value: number; tone?: string }) {
  return (
    <div className="cmd-bar">
      <div className={`cmd-bar-fill ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

/** How healthy the setup is, from checks that are actually measured. */
function health(d: Snapshot | null, online: boolean) {
  if (!d) return 0
  let score = 0
  if (online) score += 25
  if (d.security?.ok) score += 30
  else if (d.security?.ok == null) score += 15
  if (d.system.cpu.percent < 85) score += 10
  if (d.system.memory.percent < 90) score += 10
  const bat = d.system.battery
  if (!bat || bat.status !== 'on battery' || bat.percent > 20) score += 10
  if (d.channels.youtube && !d.channels.youtube.error) score += 15
  return score
}

const stageCount = (d: Snapshot | null, board: string, stages: string[]) =>
  d?.pipelines.find((p) => p.board === board)?.stages.filter((s) => stages.includes(s.stage)).reduce((n, s) => n + s.count, 0) ?? 0

/* ---------------------------------------------------------------- pieces */

function Header({ d }: { d: Snapshot | null }) {
  const now = useNow()
  const turns = useStore((s) => s.turns)
  const phase = useStore((s) => s.phase)
  const last = [...turns].reverse().find((t) => t.role === 'jarvis' && t.text.trim())
  const line =
    phase === 'listening' ? 'Listening…' : phase === 'thinking' || phase === 'tooling' ? 'Working on it…' : last ? last.text : `${greeting(now.getHours())}! What shall we accomplish today?`
  const wx = d?.weather
  return (
    <>
      <div className="cmd-brand" style={{ gridArea: 'brand' }}>
        <div className="cmd-brand-mark">JARVIS</div>
        <div className="cmd-brand-sub">AI OPERATING SYSTEM</div>
        <div className="cmd-brand-tag">Plan · Automate · Execute · Grow</div>
      </div>
      <div className="cmd-greet" style={{ gridArea: 'greet' }}>
        <Wave />
        <span className="cmd-greet-text">{line.length > 150 ? `${line.slice(0, 147)}…` : line}</span>
      </div>
      <div className="cmd-clock" style={{ gridArea: 'clock' }}>
        <div className="cmd-date">{now.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>
        <div className="cmd-time">{now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
        <div className="cmd-place">
          {wx?.place ?? 'Winnipeg, MB'}
          <span className="cmd-wx">
            {weatherIcon(wx?.code, wx?.day)} {wx?.tempC != null ? `${Math.round(wx.tempC)}°C` : '—'}
          </span>
        </div>
      </div>
    </>
  )
}

function Wave({ bars = 28 }: { bars?: number }) {
  const level = useStore((s) => s.level)
  const phase = useStore((s) => s.phase)
  const live = phase === 'speaking' || phase === 'listening'
  return (
    <div className="cmd-wave" aria-hidden>
      {Array.from({ length: bars }, (_, i) => {
        const shape = Math.sin((i / (bars - 1)) * Math.PI)
        const h = 0.12 + shape * (live ? 0.25 + level * 0.9 : 0.22) * (0.6 + 0.4 * Math.abs(Math.sin(i * 1.7 + Date.now() / 300)))
        return <span key={i} style={{ transform: `scaleY(${Math.min(1, h)})` }} />
      })}
    </div>
  )
}

function Nav() {
  const [settings, setSettings] = useState(false)
  return (
    <nav className="cmd-nav" style={{ gridArea: 'nav' }}>
      {NAV.map((n, i) => (
        <button
          key={n.label}
          className={`cmd-nav-item ${i === 0 ? 'active' : ''}`}
          onClick={() => (n.label === 'Settings' ? setSettings((v) => !v) : n.ask && sendCommand(n.ask))}
        >
          <span className="cmd-nav-icon">{n.icon}</span>
          {n.label}
        </button>
      ))}
      {settings && (
        <div className="cmd-settings">
          <div className="cmd-dim">Brain</div>
          <BrainSwitch />
        </div>
      )}
    </nav>
  )
}

function SystemStatus({ d, online }: { d: Snapshot | null; online: boolean }) {
  const agents = d?.agents ?? []
  const active = agents.filter((a) => a.state === 'on').length
  const yt = d?.channels.youtube
  const sec = d?.security
  return (
    <Panel title="SYSTEM STATUS" area="status">
      <Check ok={online}>Core AI: <b className={online ? 'ok' : 'bad'}>{online ? 'Online' : 'Offline'}</b></Check>
      <Check ok={agents.length ? active > 0 : null}>Agents: <b>{active}/{agents.length || '—'} active</b></Check>
      <Check ok={yt ? !yt.error : false}>YouTube: <b className={yt && !yt.error ? 'ok' : 'bad'}>{yt && !yt.error ? 'Connected' : 'Not connected'}</b></Check>
      <Check ok={Boolean(d?.channels.instagram && !d.channels.instagram.error)}>Instagram: <b>{d?.channels.instagram && !d.channels.instagram.error ? 'Connected' : 'Not connected'}</b></Check>
      <Check ok={sec ? sec.ok : null}>
        Security: <b className={sec?.ok ? 'ok' : sec?.ok === false ? 'bad' : ''}>{sec ? (sec.ok ? 'Secure' : `${sec.issues.length} issue${sec.issues.length === 1 ? '' : 's'}`) : 'checking…'}</b>
      </Check>
      <HealthRing value={health(d, online)} />
    </Panel>
  )
}

function TaskProgress({ d }: { d: Snapshot | null }) {
  const ap = d?.autopilot
  const today = new Date().toDateString()
  const postedToday = (ap?.recent ?? []).filter((r) => r.status === 'posted' && r.at && new Date(r.at).toDateString() === today).length
  const perDay = ap?.times.length || 2
  const ytInWork = stageCount(d, 'youtube', ['research', 'sources_verified', 'script', 'script_approved', 'editing', 'upload_draft'])
  const ytAll = d?.pipelines.find((p) => p.board === 'youtube')?.stages.reduce((n, s) => n + s.count, 0) ?? 0
  const sys = d?.system
  const rows: { icon: string; label: string; pct: number; note: string; tone?: string }[] = [
    { icon: '▶', label: 'Shorts posted today', pct: (postedToday / perDay) * 100, note: `${postedToday}/${perDay}` },
    { icon: '▦', label: 'YouTube pipeline in progress', pct: ytAll ? (ytInWork / ytAll) * 100 : 0, note: `${ytInWork}/${ytAll}` },
    { icon: '◷', label: 'Autopilot queue', pct: Math.min(100, (ap?.queued ?? 0) * 25), note: `${ap?.queued ?? 0} queued` },
    { icon: '⛁', label: 'Disk used', pct: sys?.disks[0]?.usedPercent ?? 0, note: `${sys?.disks[0]?.usedPercent ?? '—'}%` },
    { icon: '▥', label: 'Memory in use', pct: sys?.memory.percent ?? 0, note: `${sys?.memory.percent ?? '—'}%`, tone: (sys?.memory.percent ?? 0) > 85 ? 'warn' : '' },
  ]
  return (
    <Panel title="TASK PROGRESS" area="tasks" link={{ label: 'View all', ask: 'Show me everything in progress across the YouTube pipeline and autopilot.' }}>
      {rows.map((r) => (
        <div key={r.label} className="cmd-task">
          <span className="cmd-task-icon">{r.icon}</span>
          <div className="cmd-task-main">
            <div className="cmd-task-top">
              <span>{r.label}</span>
              <span className="cmd-dim">{r.note}</span>
            </div>
            <Bar value={r.pct} tone={r.tone} />
          </div>
        </div>
      ))}
    </Panel>
  )
}

function Core() {
  const phase = useStore((s) => s.phase)
  const tool = useStore((s) => s.activeTool)
  return (
    <div className="cmd-core" style={{ gridArea: 'core' }}>
      <Holo />
      <div className="cmd-core-plate">
        <div className="cmd-core-name">JARVIS</div>
        <div className={`cmd-core-state ${phase === 'offline' ? 'bad' : 'ok'}`}>
          {tool && phase === 'tooling' ? `WORKING • ${tool.replace(/^mcp__\w+?__/, '').replace(/[_-]/g, ' ').toUpperCase()}` : PHASE_LABEL[phase]}
        </div>
      </div>
    </div>
  )
}

function Agents({ d }: { d: Snapshot | null }) {
  const agents = d?.agents ?? []
  return (
    <Panel title="AGENT NETWORK" area="agents" link={{ label: 'View all', ask: 'Give me a short status report on every one of your agents and standing jobs.' }}>
      <div className="cmd-big-line">
        <span className="cmd-big">{agents.filter((a) => a.state === 'on').length}</span> Active agents
      </div>
      {agents.map((a) => (
        <div key={a.name} className="cmd-agent">
          <span className={`cmd-dot ${a.state}`} />
          <span className="cmd-agent-name">{a.name}</span>
          <span className="cmd-agent-detail">{a.detail}</span>
        </div>
      ))}
    </Panel>
  )
}

function Business({ d }: { d: Snapshot | null }) {
  const leads = stageCount(d, 'agency', ['researched', 'scored', 'approved_lead'])
  const projects = stageCount(d, 'agency', ['demo_ready', 'approved_to_send', 'contacted', 'replied', 'meeting', 'proposal'])
  const won = stageCount(d, 'agency', ['won'])
  const paused = d?.agents?.find((a) => a.name.startsWith('Agency'))?.state === 'paused'
  return (
    <Panel title="BUSINESS OVERVIEW" area="biz">
      <div className="cmd-money">
        $0 <span className="cmd-dim small">revenue tracked</span>
      </div>
      <div className="cmd-dim small">{paused ? 'Agency paused: focus is the YouTube channel' : 'No payment link set yet'}</div>
      <div className="cmd-kv"><span>Leads</span><b>{leads}</b></div>
      <div className="cmd-kv"><span>Projects</span><b>{projects}</b></div>
      <div className="cmd-kv"><span>Won</span><b>{won}</b></div>
    </Panel>
  )
}

function Crm({ d }: { d: Snapshot | null }) {
  const rows = [
    { label: 'New leads', n: stageCount(d, 'agency', ['researched', 'scored', 'approved_lead']), c: 'c1' },
    { label: 'Demo ready', n: stageCount(d, 'agency', ['demo_ready', 'approved_to_send']), c: 'c2' },
    { label: 'Contacted', n: stageCount(d, 'agency', ['contacted', 'replied', 'meeting']), c: 'c3' },
    { label: 'Proposal sent', n: stageCount(d, 'agency', ['proposal']), c: 'c4' },
    { label: 'Closed won', n: stageCount(d, 'agency', ['won']), c: 'c5' },
  ]
  return (
    <Panel title="CRM PIPELINE" area="crm" link={{ label: 'View board', ask: 'Show me the agency leads board.' }}>
      <div className="cmd-funnel">
        {rows.map((r, i) => (
          <div key={r.label} className="cmd-funnel-row">
            <span className={`cmd-funnel-bar ${r.c}`} style={{ width: `${100 - i * 15}%` }} />
            <span className="cmd-funnel-label">{r.label}</span>
            <b>{r.n}</b>
          </div>
        ))}
      </div>
    </Panel>
  )
}

function YouTube({ d }: { d: Snapshot | null }) {
  const yt = d?.channels.youtube
  return (
    <Panel title="YOUTUBE STUDIO" area="yt" link={{ label: 'Channel', ask: 'Show me the YouTube channel stats and the next Shorts in the queue.' }}>
      {yt && !yt.error ? (
        <>
          <div className="cmd-yt-name">
            <span className="cmd-yt-logo">▶</span>
            {yt.name ?? 'Your channel'}
          </div>
          <div className="cmd-kv"><span>Total views</span><b>{compact(yt.views)}</b></div>
          <div className="cmd-kv"><span>Subscribers</span><b>{compact(yt.followers)}</b></div>
          <div className="cmd-kv"><span>Videos</span><b>{compact(yt.posts)}</b></div>
          {d?.autopilot.channels?.length ? (
            <div className="cmd-dim small">Channels: {d.autopilot.channels.filter((c) => c.enabled).map((c) => c.id).join(', ') || '—'}</div>
          ) : (
            <div className="cmd-dim small">Next Shorts: {(d?.autopilot.times ?? []).join(' & ') || '—'}</div>
          )}
        </>
      ) : (
        <div className="cmd-dim">{yt?.error ? `Error: ${yt.error}` : 'Not connected'}</div>
      )}
    </Panel>
  )
}

function Voice() {
  const phase = useStore((s) => s.phase)
  const label =
    phase === 'listening' ? 'Listening…' : phase === 'speaking' ? 'Speaking…' : phase === 'thinking' || phase === 'tooling' ? 'Working…' : phase === 'offline' ? 'Click INITIALISE to start' : 'Say “Hey Jarvis” or press Space'
  return (
    <Panel title="VOICE ASSISTANT" area="voice" className="cmd-voice">
      <div className="cmd-voice-row">
        <div className={`cmd-mic ${phase === 'listening' ? 'live' : ''}`}>🎙</div>
        <Wave bars={22} />
      </div>
      <div className="cmd-voice-label">{label}</div>
    </Panel>
  )
}

function CommandBar() {
  const [text, setText] = useState('')
  const submit = () => {
    sendCommand(text)
    setText('')
  }
  return (
    <div className="cmd-bar-area" style={{ gridArea: 'cmd' }}>
      <div className="cmd-quick">
        {QUICK.map((q) => (
          <button key={q.label} className="cmd-quick-btn" onClick={() => sendCommand(q.ask)}>
            <span>{q.icon}</span>
            {q.label}
          </button>
        ))}
      </div>
      <form
        className="cmd-input"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <span className="cmd-input-icon">◌</span>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask JARVIS anything… or give a command" aria-label="Command for JARVIS" />
        <button type="submit" className="cmd-send" aria-label="Send">➤</button>
      </form>
    </div>
  )
}

function Activity({ d }: { d: Snapshot | null }) {
  const items = d?.activity ?? []
  return (
    <Panel title="RECENT ACTIVITY" area="recent" link={{ label: 'View all', ask: 'Summarise everything you and Claude did today.' }}>
      {items.length === 0 && <div className="cmd-dim">Nothing logged yet today.</div>}
      {items.slice(0, 5).map((a, i) => (
        <div key={i} className="cmd-act">
          <span className="cmd-tick ok">✓</span>
          <span className="cmd-act-text">{a.text}</span>
          <span className="cmd-dim small">{a.time}</span>
        </div>
      ))}
    </Panel>
  )
}

/* ------------------------------------------------------------------ root */

export function Command() {
  const { data, down } = useDeck()
  const dim = useStore((s) => s.blades.length > 0)
  const online = Boolean(data) && !down
  return (
    <div className={`cmd ${dim ? 'cmd-dim-all' : ''}`}>
      <Header d={data} />
      <Nav />
      <SystemStatus d={data} online={online} />
      <TaskProgress d={data} />
      <Core />
      <Agents d={data} />
      <Business d={data} />
      <Crm d={data} />
      <YouTube d={data} />
      <Voice />
      <CommandBar />
      <Activity d={data} />
      <footer className="cmd-footer" style={{ gridArea: 'foot' }}>
        JARVIS <span>·</span> Your Personal AI Executive Assistant <span>·</span> Always Working for You
      </footer>
    </div>
  )
}
