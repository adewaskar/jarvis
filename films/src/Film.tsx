import React from 'react'
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from 'remotion'
import type { Actor, FilmProps, PropItem, Scene, TextItem, Word } from './types'
import { Defs, STYLE_DEFS, objectFilter, type StyleDef } from './styles'
import { Backdrop } from './Backdrop'
import { Character } from './Character'
import { PropShape } from './Props'
import { clamp, easeInOut, easeOut, pop } from './paint'

/** Frames the next scene slides in over the last one. */
const OVERLAP = 12

export const sceneFrames = (sc: Scene, fps: number) => Math.max(1, Math.round(sc.seconds * fps))

export const Film: React.FC<FilmProps> = (props) => {
  const { fps } = useVideoConfig()
  let start = 0
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {props.scenes.map((sc, i) => {
        const d = sceneFrames(sc, fps)
        const lead = i > 0 && (sc.transition ?? 'cut') !== 'cut' ? Math.min(OVERLAP, start) : 0
        const el = (
          <Sequence key={i} from={start - lead} durationInFrames={d + lead}>
            <SceneView film={props} scene={sc} index={i} lead={lead} frames={d} />
          </Sequence>
        )
        start += d
        return el
      })}
    </AbsoluteFill>
  )
}

const enterAnim = (enter: string | undefined, k: number) => {
  switch (enter ?? 'pop') {
    case 'none':
      return { scale: 1, dx: 0, dy: 0, opacity: 1 }
    case 'drop':
      return { scale: 1, dx: 0, dy: -(1 - easeOut(k)) * 900, opacity: 1 }
    case 'slide':
      return { scale: 1, dx: (1 - easeOut(k)) * -1400, dy: 0, opacity: 1 }
    case 'fade':
      return { scale: 1, dx: 0, dy: 0, opacity: k }
    default:
      return { scale: pop(k), dx: 0, dy: 0, opacity: k > 0 ? 1 : 0 }
  }
}

const SceneView: React.FC<{ film: FilmProps; scene: Scene; index: number; lead: number; frames: number }> = ({ film, scene, index, lead, frames }) => {
  const raw = useCurrentFrame()
  const { fps, width: W, height: H } = useVideoConfig()
  const s = STYLE_DEFS[film.style] ?? STYLE_DEFS['paper-cutout']
  const portrait = H > W
  const frame = raw - lead
  const q = s.step > 1 ? Math.floor(raw / s.step) * s.step - lead : frame
  const t = Math.max(0, q / fps)
  const tSmooth = Math.max(0, frame / fps)
  const p = clamp(frame / frames)
  const boil = Math.floor(raw / (s.step * 2 || 2))
  const gy = H * (portrait ? 0.7 : 0.8)

  // Camera
  const cam = scene.camera ?? 'still'
  let zoom = 1
  let pan = 0
  let sx = 0
  let sy = 0
  if (cam === 'push-in') zoom = 1 + 0.12 * easeInOut(p)
  if (cam === 'pull-out') zoom = 1.12 - 0.12 * easeInOut(p)
  if (cam === 'pan-left' || cam === 'pan-right') pan = (cam === 'pan-left' ? 1 : -1) * W * 0.08 * (easeInOut(p) * 2 - 1)
  if (cam === 'shake') {
    const k = Math.max(0, 1 - tSmooth / 0.6)
    sx = Math.sin(raw * 2.3) * 16 * k
    sy = Math.cos(raw * 3.1) * 12 * k
  }
  const cx = W / 2
  const cy = gy * 0.75
  const cameraT = `translate(${cx + sx} ${cy + sy}) scale(${zoom}) translate(${-cx} ${-cy})`

  // Transition in, over the previous scene
  const tr = scene.transition ?? 'cut'
  const inK = lead > 0 ? clamp(raw / lead) : 1
  const clipId = `clip-${index}`
  let stageStyle: React.CSSProperties = {}
  let clip: React.ReactNode = null
  if (lead > 0 && inK < 1) {
    if (tr === 'fade') stageStyle = { opacity: inK }
    if (tr === 'slide') stageStyle = { transform: `translateX(${(1 - easeOut(inK)) * W}px)` }
    if (tr === 'wipe')
      clip = (
        <clipPath id={clipId}>
          <rect x={0} y={0} width={W * easeInOut(inK)} height={H} />
        </clipPath>
      )
  }

  const filt = objectFilter(s)
  const stageFilter = [s.rough > 0 ? 'url(#rough)' : '', s.pixel ? 'url(#pixel)' : ''].filter(Boolean).join(' ') || undefined

  return (
    <AbsoluteFill style={{ ...stageStyle, filter: s.grade, boxShadow: tr === 'slide' && inK < 1 ? '-30px 0 40px rgba(0,0,0,.45)' : undefined }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0 }}>
        <Defs s={s} boil={boil} W={W} H={H} />
        {clip && <defs>{clip}</defs>}
        <g clipPath={clip ? `url(#${clipId})` : undefined}>
          <g filter={stageFilter}>
            <g transform={cameraT}>
              <Backdrop setting={scene.setting} time={scene.time ?? 'day'} s={s} W={W} H={H} gy={gy} seed={index + 1} pan={pan} t={t} />
              <g transform={`translate(${pan} 0)`}>
                {(scene.props ?? []).map((pr, i) => (
                  <PropView key={i} pr={pr} s={s} W={W} H={H} t={t} filt={filt} />
                ))}
                {(scene.actors ?? []).map((a, i) => (
                  <ActorView key={i} a={a} film={film} s={s} W={W} H={H} gy={gy} t={t} p={p} filt={filt} portrait={portrait} />
                ))}
              </g>
              {scene.weather === 'rain' &&
                Array.from({ length: 90 }, (_, i) => {
                  const x = ((i * 137) % W) + ((tSmooth * 300) % 60)
                  const y = ((i * 251 + tSmooth * 1600) % (H + 200)) - 100
                  return <line key={i} x1={x} y1={y} x2={x - 10} y2={y + 38} stroke="#cfe6ff" strokeOpacity={0.6} strokeWidth={3} />
                })}
              {scene.weather === 'snow' &&
                Array.from({ length: 80 }, (_, i) => {
                  const x = ((i * 173) % W) + Math.sin(tSmooth + i) * 20
                  const y = ((i * 211 + tSmooth * 120) % (H + 40)) - 20
                  return <circle key={i} cx={x} cy={y} r={4 + (i % 3) * 2} fill="#ffffff" opacity={0.85} />
                })}
            </g>
          </g>
          <Overlays s={s} W={W} H={H} raw={raw} />
          {scene.text && <TextView tx={scene.text} s={s} W={W} H={H} t={tSmooth} portrait={portrait} />}
          {film.subtitles !== false && scene.words?.length ? <Subtitles words={scene.words} t={tSmooth} s={s} W={W} H={H} portrait={portrait} /> : null}
          {film.watermark && (
            <text x={W - 36} y={52} textAnchor="end" fontFamily={s.font} fontSize={H * 0.028} fontWeight={700} fill="#ffffff" stroke="#000" strokeOpacity={0.35} strokeWidth={4} paintOrder="stroke" opacity={0.75}>
              {film.watermark}
            </text>
          )}
        </g>
      </svg>
    </AbsoluteFill>
  )
}

const PropView: React.FC<{ pr: PropItem; s: StyleDef; W: number; H: number; t: number; filt?: string }> = ({ pr, s, W, H, t, filt }) => {
  const at = pr.at ?? 0
  if (t < at) return null
  const k = clamp((t - at) / 0.4)
  const e = enterAnim(pr.enter, k)
  const scale = (pr.size ?? 1) * (H / 1080) * e.scale
  const bob = pr.float ? Math.sin(t * 2.2) * 12 : 0
  return (
    <g transform={`translate(${pr.x * W + e.dx} ${pr.y * H + e.dy + bob}) scale(${scale})`} opacity={e.opacity} filter={filt}>
      <PropShape kind={pr.kind} s={s} t={t - at} color={pr.color} label={pr.label} />
    </g>
  )
}

const ActorView: React.FC<{ a: Actor; film: FilmProps; s: StyleDef; W: number; H: number; gy: number; t: number; p: number; filt?: string; portrait: boolean }> = ({
  a,
  film,
  s,
  W,
  H,
  gy,
  t,
  p,
  filt,
  portrait,
}) => {
  const x0 = a.x ?? 0.4
  const moving = a.to !== undefined && Math.abs(a.to - x0) > 0.01
  const x = moving ? x0 + (a.to! - x0) * easeInOut(p) : x0
  const pose = moving && (a.pose === 'stand' || a.pose === 'talk') ? 'walk' : a.pose
  const facing = a.facing ?? (moving && a.to! < x0 ? 'left' : 'right')
  const k = clamp(t / 0.35)
  const e = a.enter ? enterAnim(a.enter, k) : { scale: 1, dx: 0, dy: 0, opacity: 1 }
  const scale = (a.size ?? 1) * (H / 1080) * (portrait ? 0.95 : 1.05) * e.scale
  const look = a.who === 'other' && film.other ? film.other : film.hero
  return (
    <g transform={`translate(${x * W + e.dx} ${gy + 8 + e.dy}) scale(${facing === 'left' ? -scale : scale} ${scale})`} opacity={e.opacity} filter={filt}>
      <ellipse cx={0} cy={4} rx={70} ry={12} fill="#000" opacity={0.18} />
      <Character look={look} pose={pose} expression={a.expression ?? 'neutral'} t={t} talking={Boolean(a.talking)} s={s} />
    </g>
  )
}

const wrap = (text: string, max: number) => {
  const out: string[] = []
  let line = ''
  for (const w of text.split(/\s+/)) {
    if ((line + ' ' + w).trim().length > max && line) {
      out.push(line)
      line = w
    } else line = (line + ' ' + w).trim()
  }
  if (line) out.push(line)
  return out
}

const TextView: React.FC<{ tx: TextItem; s: StyleDef; W: number; H: number; t: number; portrait: boolean }> = ({ tx, s, W, H, t, portrait }) => {
  const at = tx.at ?? 0
  if (t < at) return null
  const k = clamp((t - at) / 0.45)
  const kind = tx.kind ?? 'caption'
  const ink = s.chalk || s.glow ? '#ffffff' : s.text
  if (kind === 'big-number') {
    const m = /^([^\d]*)([\d][\d,.]*)(.*)$/.exec(tx.value)
    let shown = tx.value
    if (m) {
      const target = Number(m[2].replace(/,/g, ''))
      const n = Math.round(target * easeOut(clamp((t - at) / 1.1)))
      shown = `${m[1]}${n.toLocaleString('en-US')}${m[3]}`
    }
    return (
      <g transform={`translate(${W / 2} ${H * (portrait ? 0.3 : 0.32)}) scale(${pop(k)})`}>
        <text textAnchor="middle" fontFamily={s.font} fontWeight={900} fontSize={H * (portrait ? 0.11 : 0.17)} fill={s.glow ? s.accent2 : s.accent} stroke={s.chalk ? 'none' : '#ffffff'} strokeWidth={10} paintOrder="stroke" filter={s.glow ? 'url(#glow)' : undefined}>
          {shown}
        </text>
      </g>
    )
  }
  if (kind === 'title') {
    const lines = wrap(tx.value, portrait ? 14 : 22)
    const fs = H * (portrait ? 0.055 : 0.085)
    const bw = Math.min(W * 0.9, Math.max(...lines.map((l) => l.length)) * fs * 0.62 + fs * 1.2)
    const bh = lines.length * fs * 1.2 + fs * 0.8
    return (
      <g transform={`translate(${W / 2} ${H * (portrait ? 0.3 : 0.4)}) rotate(${-2 + (1 - k) * 6}) scale(${pop(k)})`} filter={s.shadow ? 'url(#shadow)' : s.glow ? 'url(#glow)' : undefined}>
        <rect x={-bw / 2} y={-bh / 2} width={bw} height={bh} rx={s.pixel ? 0 : 16} fill={s.textBg} stroke={s.line ? s.ink : 'none'} strokeWidth={s.line} />
        {lines.map((l, i) => (
          <text key={i} x={0} y={-bh / 2 + fs * 1.15 + i * fs * 1.2} textAnchor="middle" fontFamily={s.font} fontWeight={900} fontSize={fs} fill={ink}>
            {l}
          </text>
        ))}
      </g>
    )
  }
  if (kind === 'label') {
    const fs = H * 0.04
    const w = tx.value.length * fs * 0.6 + fs * 1.4
    return (
      <g transform={`translate(${40 + (1 - easeOut(k)) * -400} ${H * 0.08})`}>
        <rect x={0} y={-fs * 1.1} width={w} height={fs * 1.6} rx={s.pixel ? 0 : 10} fill={s.accent} />
        <text x={fs * 0.7} y={0} fontFamily={s.font} fontWeight={800} fontSize={fs} fill="#ffffff">
          {tx.value}
        </text>
      </g>
    )
  }
  const lines = wrap(tx.value, portrait ? 20 : 34)
  const fs = H * (portrait ? 0.036 : 0.05)
  return (
    <g transform={`translate(${W / 2} ${H * (portrait ? 0.14 : 0.13) - (1 - easeOut(k)) * 60})`} opacity={k}>
      {lines.map((l, i) => (
        <text key={i} x={0} y={i * fs * 1.25} textAnchor="middle" fontFamily={s.font} fontWeight={900} fontSize={fs} fill={ink} stroke={s.chalk || s.glow ? '#000' : s.textBg} strokeWidth={fs * 0.22} paintOrder="stroke" strokeLinejoin="round">
          {l}
        </text>
      ))}
    </g>
  )
}

/** Word-timed subtitles, a few words at a time, the spoken word picked out in the accent colour. */
const Subtitles: React.FC<{ words: Word[]; t: number; s: StyleDef; W: number; H: number; portrait: boolean }> = ({ words, t, s, W, H, portrait }) => {
  const per = portrait ? 3 : 5
  const groups: Word[][] = []
  let cur: Word[] = []
  for (const w of words) {
    cur.push(w)
    if (cur.length >= per || /[.!?,;:]["'”’)]*$/.test(w.text)) {
      groups.push(cur)
      cur = []
    }
  }
  if (cur.length) groups.push(cur)
  const g = groups.find((gr) => t >= gr[0].start - 0.05 && t <= gr[gr.length - 1].end + 0.15)
  if (!g) return null
  const fs = H * (portrait ? 0.045 : 0.052)
  const y = H * (portrait ? 0.8 : 0.9)
  return (
    <text x={W / 2} y={y} textAnchor="middle" fontFamily={s.font} fontWeight={900} fontSize={fs} stroke="#000" strokeWidth={fs * 0.2} paintOrder="stroke" strokeLinejoin="round">
      {g.map((w, i) => (
        <tspan key={i} fill={t >= w.start && t <= w.end + 0.05 ? (s.glow ? s.accent2 : '#ffd23f') : '#ffffff'}>
          {(i ? ' ' : '') + w.text.replace(/[.,;:]+$/, '')}
        </tspan>
      ))}
    </text>
  )
}

const Overlays: React.FC<{ s: StyleDef; W: number; H: number; raw: number }> = ({ s, W, H, raw }) => (
  <g pointerEvents="none">
    {(s.paper || s.chalk) && <rect x={0} y={0} width={W} height={H} filter="url(#texture)" opacity={s.chalk ? 0.1 : 0.13} style={{ mixBlendMode: 'multiply' }} />}
    {s.grain && <rect x={0} y={0} width={W} height={H} filter="url(#texture)" opacity={0.16} style={{ mixBlendMode: 'overlay' }} />}
    {s.vignette && <rect x={0} y={0} width={W} height={H} fill="url(#vignette)" />}
    {s.flicker && <rect x={0} y={0} width={W} height={H} fill="#000" opacity={((raw * 7919) % 13) / 13 > 0.85 ? 0.08 : 0.02} />}
  </g>
)
