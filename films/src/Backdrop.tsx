import React from 'react'
import type { Setting, TimeOfDay } from './types'
import type { StyleDef } from './styles'
import { fill, rand, stroke } from './paint'
import { PropShape } from './Props'

/**
 * The world behind the action, in three depth layers so camera pans give
 * parallax. Everything is generated from the scene number, so a scene looks
 * the same on every frame and every render.
 */
export const Backdrop: React.FC<{
  setting: Setting
  time: TimeOfDay
  s: StyleDef
  W: number
  H: number
  gy: number
  seed: number
  pan: number
  t: number
}> = ({ setting, time, s, W, H, gy, seed, pan, t }) => {
  const r = rand(seed * 7919 + 13)
  const f = (c: string) => fill(s, c)
  const o = stroke(s, 0.8)
  const x0 = -W * 0.25
  const x1 = W * 1.25
  const span = x1 - x0
  const [top, bottom] = s.sky[time]
  const indoor = setting === 'room' || setting === 'office' || setting === 'school' || setting === 'cave'
  const night = time === 'night' || setting === 'space'
  const skyId = `sky-${seed}`

  const sky = (
    <>
      <defs>
        <linearGradient id={skyId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={s.chalk ? top : s.tint ? s.tint(top) : top} />
          <stop offset="1" stopColor={s.chalk ? bottom : s.tint ? s.tint(bottom) : bottom} />
        </linearGradient>
      </defs>
      <rect x={x0} y={-H * 0.2} width={span} height={H * 1.4} fill={setting === 'space' ? f('#07071a') : `url(#${skyId})`} />
      {night &&
        Array.from({ length: 70 }, (_, i) => (
          <circle key={i} cx={x0 + r() * span} cy={r() * gy * 0.9} r={1.5 + r() * 2.5} fill="#fff" opacity={0.4 + 0.6 * Math.abs(Math.sin(t * 1.5 + i))} />
        ))}
    </>
  )

  const far: React.ReactNode[] = []
  const mid: React.ReactNode[] = []
  let ground: React.ReactNode = <rect x={x0} y={gy} width={span} height={H - gy + H * 0.2} fill={f(s.ground)} />
  const skyBody =
    !indoor && setting !== 'space' ? (
      <g transform={`translate(${W * 0.8} ${gy * 0.22}) scale(${H / 1500})`}>{night ? <PropShape kind="moon" s={s} t={t} /> : time === 'day' ? <PropShape kind="sun" s={s} t={t} /> : <circle r={70} fill={f('#ffb36b')} />}</g>
    ) : null

  const hills = (color: string, amp: number, base: number, n: number) => {
    let d = `M${x0} ${base}`
    for (let i = 0; i <= n; i++) {
      const x = x0 + (span * i) / n
      d += ` Q${x - span / n / 2} ${base - amp * (0.6 + r() * 0.8)} ${x} ${base}`
    }
    d += ` L${x1} ${H * 1.2} L${x0} ${H * 1.2} Z`
    return <path d={d} fill={f(color)} {...o} />
  }

  switch (setting) {
    case 'city':
      for (let i = 0; i < 16; i++) {
        const w = W * (0.05 + r() * 0.05)
        const h = gy * (0.25 + r() * 0.45)
        far.push(<rect key={`f${i}`} x={x0 + (span * i) / 16} y={gy - h} width={w} height={h} fill={f(s.far)} {...o} />)
      }
      for (let i = 0; i < 9; i++) {
        const w = W * (0.07 + r() * 0.05)
        const h = gy * (0.2 + r() * 0.3)
        const x = x0 + (span * i) / 9 + r() * 40
        mid.push(
          <g key={`m${i}`}>
            <rect x={x} y={gy - h} width={w} height={h} fill={f(s.mid)} {...o} />
            {Array.from({ length: Math.floor(h / 70) * 2 }, (_, j) => (
              <rect key={j} x={x + 14 + (j % 2) * (w / 2)} y={gy - h + 20 + Math.floor(j / 2) * 70} width={w / 2 - 28} height={34} fill={f(night ? '#ffe8a3' : '#cfe8f5')} opacity={night && r() > 0.4 ? 1 : 0.7} />
            ))}
          </g>,
        )
      }
      ground = (
        <g>
          <rect x={x0} y={gy} width={span} height={H} fill={s.glow ? s.ground : f('#8a8f99')} />
          <rect x={x0} y={gy} width={span} height={18} fill={f('#b9bec7')} />
        </g>
      )
      break
    case 'forest':
      far.push(<g key="h">{hills(s.far, gy * 0.18, gy, 6)}</g>)
      for (let i = 0; i < 12; i++) {
        const x = x0 + (span * i) / 12 + r() * 60
        const k = (H / 1080) * (0.9 + r() * 0.6)
        mid.push(
          <g key={i} transform={`translate(${x} ${gy - 100 * k}) scale(${k})`}>
            <PropShape kind="tree" s={s} t={t} color={r() > 0.5 ? s.mid : s.near} />
          </g>,
        )
      }
      break
    case 'island':
    case 'ocean': {
      const sea = gy - (setting === 'ocean' ? H * 0.1 : 0)
      far.push(<rect key="sea" x={x0} y={gy - H * 0.16} width={span} height={H} fill={f('#3d8fc4')} />)
      far.push(
        ...Array.from({ length: 10 }, (_, i) => (
          <path
            key={`w${i}`}
            d={`M${x0 + ((span * i) / 10 + t * 30) % span} ${gy - H * 0.1 + (i % 3) * 22} q20 -12 40 0 q20 -12 40 0`}
            fill="none"
            stroke="#ffffff"
            strokeOpacity={0.6}
            strokeWidth={4}
          />
        )),
      )
      if (setting === 'island') {
        mid.push(<ellipse key="isl" cx={W * 0.5} cy={gy + 30} rx={W * 0.55} ry={H * 0.12} fill={f('#f0d79a')} {...o} />)
        mid.push(
          <g key="palm" transform={`translate(${W * 0.82} ${gy - 120 * (H / 1080)}) scale(${(H / 1080) * 1.3})`}>
            <PropShape kind="palm" s={s} t={t} />
          </g>,
        )
        ground = <rect x={x0} y={gy + 20} width={span} height={H} fill={f('#3d8fc4')} />
      } else {
        ground = <rect x={x0} y={sea} width={span} height={H} fill={f('#2f7fb4')} />
      }
      break
    }
    case 'desert':
      far.push(<g key="h">{hills('#e8c68e', gy * 0.12, gy, 4)}</g>)
      for (let i = 0; i < 4; i++) {
        const x = x0 + span * (0.1 + 0.25 * i) + r() * 80
        mid.push(
          <g key={i} transform={`translate(${x} ${gy})`}>
            <path d="M-14 0 L-14 -150 Q0 -170 14 -150 L14 0 Z M14 -80 L40 -80 L40 -120 Q48 -132 56 -120 L56 -66 L14 -66 Z M-14 -60 L-40 -60 L-40 -100 Q-48 -112 -56 -100 L-56 -46 L-14 -46 Z" fill={f('#4f9a4a')} {...o} />
          </g>,
        )
      }
      ground = <rect x={x0} y={gy} width={span} height={H} fill={f('#f0d08f')} />
      break
    case 'mountains':
      for (let i = 0; i < 6; i++) {
        const x = x0 + (span * i) / 6
        const h = gy * (0.45 + r() * 0.3)
        const w = W * 0.35
        far.push(
          <g key={i}>
            <path d={`M${x} ${gy} L${x + w / 2} ${gy - h} L${x + w} ${gy} Z`} fill={f(s.far)} {...o} />
            <path d={`M${x + w / 2 - w * 0.09} ${gy - h * 0.8} L${x + w / 2} ${gy - h} L${x + w / 2 + w * 0.09} ${gy - h * 0.8} Z`} fill={f('#ffffff')} />
          </g>,
        )
      }
      mid.push(<g key="h">{hills(s.mid, gy * 0.12, gy, 5)}</g>)
      break
    case 'space':
      far.push(
        <g key="p" transform={`translate(${W * 0.2} ${gy * 0.35}) scale(${H / 900})`}>
          <PropShape kind="planet" s={s} t={t} color="#7d6bd6" />
        </g>,
      )
      ground = <ellipse cx={W * 0.5} cy={gy + H * 0.55} rx={W} ry={H * 0.6} fill={f('#9a9aa8')} {...o} />
      break
    case 'road':
      far.push(<g key="h">{hills(s.far, gy * 0.15, gy, 5)}</g>)
      ground = (
        <g>
          <rect x={x0} y={gy} width={span} height={H} fill={f(s.ground)} />
          <rect x={x0} y={gy + (H - gy) * 0.18} width={span} height={(H - gy) * 0.55} fill={f('#5b5f66')} />
          {Array.from({ length: 14 }, (_, i) => (
            <rect key={i} x={x0 + (span * i) / 14} y={gy + (H - gy) * 0.43} width={70} height={10} fill="#f6f1e4" />
          ))}
        </g>
      )
      break
    case 'village':
      far.push(<g key="h">{hills(s.far, gy * 0.15, gy, 5)}</g>)
      for (let i = 0; i < 6; i++) {
        const x = x0 + (span * i) / 6 + r() * 80
        const k = (H / 1080) * (0.7 + r() * 0.4)
        mid.push(
          <g key={i} transform={`translate(${x} ${gy - 90 * k}) scale(${k})`}>
            <PropShape kind="house" s={s} t={t} color={['#f2d7a7', '#cfe3f0', '#f7c6b5', '#e7e1a8'][i % 4]} />
          </g>,
        )
      }
      break
    case 'room':
    case 'office':
    case 'school': {
      const wall = setting === 'office' ? '#dfe6ee' : setting === 'school' ? '#efe2c4' : '#f3dfc9'
      far.push(<rect key="wall" x={x0} y={-H * 0.2} width={span} height={gy + H * 0.2} fill={f(wall)} />)
      far.push(<rect key="skirt" x={x0} y={gy - 24} width={span} height={24} fill={f('#b98b65')} />)
      const wx = W * 0.62
      far.push(
        <g key="win">
          <rect x={wx} y={gy * 0.18} width={W * 0.22} height={gy * 0.42} fill={`url(#${skyId})`} {...o} />
          <path d={`M${wx + W * 0.11} ${gy * 0.18} V${gy * 0.6} M${wx} ${gy * 0.39} H${wx + W * 0.22}`} stroke={f('#ffffff')} strokeWidth={14} />
          <rect x={wx} y={gy * 0.18} width={W * 0.22} height={gy * 0.42} fill="none" stroke={f('#ffffff')} strokeWidth={16} />
        </g>,
      )
      if (setting === 'school')
        far.push(
          <rect key="board" x={W * 0.08} y={gy * 0.16} width={W * 0.42} height={gy * 0.42} fill={f('#2f5240')} stroke={f('#8b5a3c')} strokeWidth={16} />,
        )
      else
        far.push(
          <g key="pic">
            <rect x={W * 0.18} y={gy * 0.22} width={W * 0.14} height={gy * 0.26} fill={f('#fbf3e0')} stroke={f('#8b5a3c')} strokeWidth={12} />
            <path d={`M${W * 0.19} ${gy * 0.45} L${W * 0.24} ${gy * 0.32} L${W * 0.27} ${gy * 0.4} L${W * 0.31} ${gy * 0.3} L${W * 0.31} ${gy * 0.45} Z`} fill={f(s.mid)} />
          </g>,
        )
      ground = <rect x={x0} y={gy} width={span} height={H} fill={f(setting === 'office' ? '#9aa5b1' : '#b98b65')} />
      break
    }
    case 'cave':
      far.push(<rect key="c" x={x0} y={-H * 0.2} width={span} height={H * 1.4} fill={f('#3b2f2a')} />)
      for (let i = 0; i < 14; i++) {
        const x = x0 + (span * i) / 14
        const h = H * (0.08 + r() * 0.16)
        far.push(<path key={i} d={`M${x} -10 L${x + 50} ${h} L${x + 100} -10 Z`} fill={f('#2a211d')} {...o} />)
      }
      ground = <rect x={x0} y={gy} width={span} height={H} fill={f('#4a3b33')} />
      break
    default:
      far.push(<g key="h">{hills(s.far, gy * 0.1, gy, 4)}</g>)
  }

  return (
    <g>
      {sky}
      <g transform={`translate(${pan * 0.25} 0)`}>
        {skyBody}
        {far}
      </g>
      <g transform={`translate(${pan * 0.6} 0)`}>{mid}</g>
      <g transform={`translate(${pan} 0)`}>
        {ground}
        {!indoor && setting !== 'space' && setting !== 'ocean' && setting !== 'island' && setting !== 'city' && (
          <rect x={x0} y={gy} width={span} height={14} fill={f(s.ground2)} />
        )}
      </g>
    </g>
  )
}
