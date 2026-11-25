import React from 'react'
import type { PropKind } from './types'
import type { StyleDef } from './styles'
import { fill, stroke } from './paint'

/** Simple objects drawn around (0,0) in a box about 200 units wide. */
export const PropShape: React.FC<{ kind: PropKind; s: StyleDef; t: number; color?: string; label?: string }> = ({ kind, s, t, color, label }) => {
  const f = (c: string) => fill(s, c)
  const o = stroke(s)
  const c1 = color ?? s.accent
  const txt = (v: string, size = 34, y = 10, col = s.text) => (
    <text x={0} y={y} textAnchor="middle" fontFamily={s.font} fontSize={size} fontWeight={700} fill={s.chalk ? s.ink : col}>
      {v}
    </text>
  )
  switch (kind) {
    case 'tree':
      return (
        <g>
          <rect x={-14} y={10} width={28} height={90} fill={f('#7a5236')} {...o} />
          <circle cx={0} cy={-30} r={70} fill={f(color ?? '#4f9a4a')} {...o} />
          <circle cx={-45} cy={10} r={45} fill={f(color ?? '#5aa953')} {...o} />
          <circle cx={45} cy={10} r={45} fill={f(color ?? '#5aa953')} {...o} />
        </g>
      )
    case 'palm':
      return (
        <g transform={`rotate(${Math.sin(t * 1.3) * 2} 0 100)`}>
          <path d="M-6 100 Q-14 20 10 -60 L24 -58 Q6 20 12 100 Z" fill={f('#9b6b43')} {...o} />
          {[-150, -110, -60, -20, 25].map((a, i) => (
            <path key={i} transform={`rotate(${a} 16 -60)`} d="M16 -60 Q70 -95 130 -60 Q70 -75 16 -60 Z" fill={f('#3f9a52')} {...o} />
          ))}
        </g>
      )
    case 'rock':
      return <path d="M-90 60 Q-95 0 -40 -30 Q10 -55 60 -20 Q100 10 92 60 Z" fill={f(color ?? '#8d8d91')} {...o} />
    case 'house':
      return (
        <g>
          <rect x={-80} y={-20} width={160} height={110} fill={f(color ?? '#f2d7a7')} {...o} />
          <path d="M-100 -20 L0 -100 L100 -20 Z" fill={f(s.accent)} {...o} />
          <rect x={-20} y={30} width={40} height={60} fill={f('#7a5236')} {...o} />
          <rect x={-65} y={5} width={32} height={30} fill={f('#bfe3f2')} {...o} />
          <rect x={33} y={5} width={32} height={30} fill={f('#bfe3f2')} {...o} />
        </g>
      )
    case 'building':
      return (
        <g>
          <rect x={-60} y={-100} width={120} height={200} fill={f(color ?? '#7f8fa6')} {...o} />
          {Array.from({ length: 12 }, (_, i) => (
            <rect key={i} x={-44 + (i % 3) * 32} y={-84 + Math.floor(i / 3) * 44} width={20} height={26} fill={f('#ffe8a3')} />
          ))}
        </g>
      )
    case 'boat':
      return (
        <g transform={`rotate(${Math.sin(t * 2) * 4})`}>
          <path d="M-100 10 L100 10 L70 60 L-70 60 Z" fill={f(color ?? '#a0522d')} {...o} />
          <rect x={-4} y={-90} width={8} height={100} fill={f('#6b4a2f')} />
          <path d="M6 -86 L80 0 L6 0 Z" fill={f('#f6f1e4')} {...o} />
        </g>
      )
    case 'raft':
      return (
        <g transform={`rotate(${Math.sin(t * 2) * 5})`}>
          {[-75, -45, -15, 15, 45, 75].map((x) => (
            <rect key={x} x={x - 14} y={-10} width={28} height={40} rx={10} fill={f('#b98552')} {...o} />
          ))}
          <path d="M-90 10 L90 10" stroke={f('#6b4a2f')} strokeWidth={6} />
        </g>
      )
    case 'phone':
      return (
        <g>
          <rect x={-50} y={-90} width={100} height={180} rx={18} fill={f('#222')} {...o} />
          <rect x={-40} y={-74} width={80} height={140} rx={6} fill={f(color ?? '#5ec8f2')} />
          <circle cx={0} cy={78} r={6} fill="#555" />
        </g>
      )
    case 'money':
      return (
        <g>
          {[16, 8, 0].map((d) => (
            <g key={d} transform={`translate(${d} ${-d})`}>
              <rect x={-90} y={-45} width={180} height={90} rx={8} fill={f('#7dc47d')} {...o} />
              <circle cx={0} cy={0} r={26} fill={f('#a9dca9')} {...o} />
            </g>
          ))}
          {txt('$', 40, 14, '#2f6b2f')}
        </g>
      )
    case 'coin':
      return (
        <g transform={`scale(${Math.abs(Math.cos(t * 3)) * 0.8 + 0.2} 1)`}>
          <circle r={60} fill={f('#f2c14e')} {...o} />
          <circle r={44} fill="none" stroke={f('#d99a1e')} strokeWidth={6} />
          {txt('$', 50, 17, '#a86f10')}
        </g>
      )
    case 'clock': {
      const a = t * 120
      return (
        <g>
          <circle r={80} fill={f('#fbf3e0')} {...o} />
          <circle r={80} fill="none" stroke={f(c1)} strokeWidth={10} />
          <line x1={0} y1={0} x2={0} y2={-55} stroke={s.ink} strokeWidth={8} strokeLinecap="round" transform={`rotate(${a})`} />
          <line x1={0} y1={0} x2={0} y2={-35} stroke={s.ink} strokeWidth={8} strokeLinecap="round" transform={`rotate(${a / 12})`} />
        </g>
      )
    }
    case 'fire': {
      const k = Math.sin(t * 13) * 0.08 + 1
      return (
        <g>
          <rect x={-70} y={50} width={140} height={20} rx={10} fill={f('#7a5236')} transform="rotate(12)" {...o} />
          <rect x={-70} y={50} width={140} height={20} rx={10} fill={f('#6b4a2f')} transform="rotate(-12)" {...o} />
          <g transform={`scale(1 ${k})`} style={{ transformOrigin: '0px 60px' }}>
            <path d="M0 60 Q-60 20 -30 -40 Q-20 0 0 -80 Q20 0 30 -40 Q60 20 0 60 Z" fill={f('#ff8a2a')} {...o} />
            <path d="M0 55 Q-28 25 -12 -10 Q0 10 0 -30 Q10 10 14 -10 Q28 25 0 55 Z" fill={f('#ffd23f')} />
          </g>
        </g>
      )
    }
    case 'cloud':
      return (
        <g>
          <path d="M-100 30 Q-110 -20 -60 -25 Q-50 -70 0 -60 Q40 -85 70 -40 Q115 -40 105 30 Z" fill={f(color ?? '#ffffff')} {...o} />
        </g>
      )
    case 'sun':
      return (
        <g transform={`rotate(${t * 15})`}>
          {Array.from({ length: 10 }, (_, i) => (
            <path key={i} transform={`rotate(${i * 36})`} d="M-12 -80 L0 -110 L12 -80 Z" fill={f('#ffc93c')} />
          ))}
          <circle r={68} fill={f('#ffd23f')} {...o} />
        </g>
      )
    case 'moon':
      return <path d="M30 -80 A85 85 0 1 0 30 80 A65 65 0 1 1 30 -80 Z" fill={f('#f4ecc2')} {...o} />
    case 'star':
      return (
        <path
          transform={`scale(${1 + Math.sin(t * 5) * 0.08})`}
          d="M0 -90 L24 -28 L90 -28 L36 10 L56 76 L0 36 L-56 76 L-36 10 L-90 -28 L-24 -28 Z"
          fill={f(color ?? s.accent2)}
          {...o}
        />
      )
    case 'arrow':
      return <path transform={`translate(${Math.sin(t * 6) * 8} 0)`} d="M-90 -18 L30 -18 L30 -50 L95 0 L30 50 L30 18 L-90 18 Z" fill={f(c1)} {...o} />
    case 'question':
      return (
        <g transform={`rotate(${Math.sin(t * 4) * 6})`}>
          <circle r={70} fill={f(color ?? s.accent2)} {...o} />
          {txt('?', 100, 35, s.ink)}
        </g>
      )
    case 'exclaim':
      return (
        <g transform={`scale(${1 + Math.abs(Math.sin(t * 8)) * 0.08})`}>
          <path d="M0 -95 L82 60 L-82 60 Z" fill={f(color ?? s.accent2)} {...o} />
          {txt('!', 90, 48, s.ink)}
        </g>
      )
    case 'heart':
      return (
        <path
          transform={`scale(${1 + Math.abs(Math.sin(t * 5)) * 0.1})`}
          d="M0 80 C-120 0 -80 -90 0 -40 C80 -90 120 0 0 80 Z"
          fill={f(color ?? '#e2574c')}
          {...o}
        />
      )
    case 'skull':
      return (
        <g>
          <path d="M-70 10 Q-80 -90 0 -90 Q80 -90 70 10 L50 30 L50 70 L-50 70 L-50 30 Z" fill={f('#f1ede4')} {...o} />
          <circle cx={-28} cy={-12} r={20} fill={f('#2b211b')} />
          <circle cx={28} cy={-12} r={20} fill={f('#2b211b')} />
          <path d="M-6 30 L0 14 L6 30 Z" fill={f('#2b211b')} />
        </g>
      )
    case 'chart-up':
    case 'chart-down': {
      const up = kind === 'chart-up'
      const prog = Math.min(1, t / 1.2)
      const pts = up ? [[-80, 60], [-40, 30], [0, 40], [40, -10], [80, -60]] : [[-80, -60], [-40, -20], [0, -30], [40, 20], [80, 60]]
      const n = Math.max(2, Math.ceil(prog * pts.length))
      return (
        <g>
          <rect x={-110} y={-100} width={220} height={190} rx={10} fill={f('#ffffff')} {...o} />
          <polyline points={pts.slice(0, n).map((p) => p.join(',')).join(' ')} fill="none" stroke={f(up ? '#3aa655' : '#e2574c')} strokeWidth={12} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )
    }
    case 'crate':
      return (
        <g>
          <rect x={-75} y={-75} width={150} height={150} fill={f(color ?? '#c8924f')} {...o} />
          <path d="M-75 -75 L75 75 M75 -75 L-75 75" stroke={f('#8a5f2e')} strokeWidth={12} />
        </g>
      )
    case 'car':
      return (
        <g>
          <path d="M-110 30 L-100 -10 L-50 -15 L-25 -55 L45 -55 L75 -15 L110 -5 L110 30 Z" fill={f(c1)} {...o} />
          <rect x={-15} y={-48} width={50} height={30} fill={f('#bfe3f2')} />
          {[-60, 60].map((x) => (
            <g key={x} transform={`translate(${x} 34) rotate(${t * 400})`}>
              <circle r={24} fill={f('#2e2a28')} {...o} />
              <rect x={-3} y={-18} width={6} height={36} fill="#777" />
            </g>
          ))}
        </g>
      )
    case 'bottle':
      return (
        <g transform={`rotate(${Math.sin(t * 2) * 8})`}>
          <path d="M-12 -90 L12 -90 L12 -50 Q40 -30 40 0 L40 80 L-40 80 L-40 0 Q-40 -30 -12 -50 Z" fill={f('#9fd8c6')} opacity={0.9} {...o} />
          <rect x={-26} y={10} width={52} height={40} fill={f('#fbf3e0')} />
        </g>
      )
    case 'book':
      return (
        <g>
          <path d="M0 -60 Q-50 -80 -100 -60 L-100 60 Q-50 40 0 60 Q50 40 100 60 L100 -60 Q50 -80 0 -60 Z" fill={f('#fbf3e0')} {...o} />
          <path d="M0 -60 L0 60" stroke={s.ink} strokeWidth={4} />
          <rect x={-100} y={58} width={200} height={10} fill={f(c1)} />
        </g>
      )
    case 'lightbulb':
      return (
        <g>
          <circle r={95} fill={f('#fff3a0')} opacity={0.25 + Math.abs(Math.sin(t * 4)) * 0.2} />
          <path d="M-30 30 Q-65 -5 -55 -45 Q-40 -90 0 -90 Q40 -90 55 -45 Q65 -5 30 30 Z" fill={f('#ffe25c')} {...o} />
          <rect x={-28} y={30} width={56} height={34} rx={6} fill={f('#9a9a9a')} {...o} />
        </g>
      )
    case 'sign':
      return (
        <g>
          <rect x={-8} y={0} width={16} height={100} fill={f('#7a5236')} {...o} />
          <rect x={-110} y={-70} width={220} height={80} rx={8} fill={f('#f2d7a7')} {...o} />
          {txt((label ?? '').slice(0, 14), 30, -18)}
        </g>
      )
    case 'map':
      return (
        <g>
          <path d="M-100 -70 L-35 -85 L35 -70 L100 -85 L100 75 L35 90 L-35 75 L-100 90 Z" fill={f('#f2e2b6')} {...o} />
          <path d="M-60 40 Q-20 -10 20 20 T70 -40" fill="none" stroke={f(s.accent)} strokeWidth={6} strokeDasharray="12 10" />
          <path d="M60 -50 l20 20 m0 -20 l-20 20" stroke={f(s.accent)} strokeWidth={8} strokeLinecap="round" />
          {label && txt(label.slice(0, 12), 24, 70)}
        </g>
      )
    case 'key':
      return (
        <g transform={`rotate(${Math.sin(t * 3) * 10})`}>
          <circle cx={-50} cy={0} r={36} fill="none" stroke={f('#f2c14e')} strokeWidth={18} />
          <path d="M-14 -9 L90 -9 L90 30 L70 30 L70 9 L50 9 L50 25 L30 25 L30 9 L-14 9 Z" fill={f('#f2c14e')} {...o} />
        </g>
      )
    case 'door':
      return (
        <g>
          <rect x={-60} y={-110} width={120} height={220} rx={8} fill={f(color ?? '#8b5a3c')} {...o} />
          <circle cx={36} cy={4} r={8} fill={f('#f2c14e')} />
        </g>
      )
    case 'bed':
      return (
        <g>
          <rect x={-130} y={0} width={260} height={50} fill={f('#8b5a3c')} {...o} />
          <rect x={-130} y={-60} width={20} height={110} fill={f('#8b5a3c')} {...o} />
          <rect x={-110} y={-20} width={230} height={30} rx={10} fill={f(color ?? '#6fa8dc')} {...o} />
          <rect x={-105} y={-40} width={60} height={26} rx={10} fill={f('#ffffff')} {...o} />
        </g>
      )
    case 'desk':
      return (
        <g>
          <rect x={-130} y={-20} width={260} height={24} fill={f('#a26b43')} {...o} />
          <rect x={-120} y={4} width={18} height={96} fill={f('#8b5a3c')} />
          <rect x={102} y={4} width={18} height={96} fill={f('#8b5a3c')} />
        </g>
      )
    case 'computer':
      return (
        <g>
          <rect x={-90} y={-80} width={180} height={120} rx={10} fill={f('#2b2f36')} {...o} />
          <rect x={-78} y={-68} width={156} height={96} fill={f(color ?? '#5ec8f2')} />
          <rect x={-20} y={40} width={40} height={30} fill={f('#2b2f36')} />
          <rect x={-60} y={70} width={120} height={12} rx={6} fill={f('#2b2f36')} />
        </g>
      )
    case 'coffee':
      return (
        <g>
          {[0, 1].map((i) => (
            <path key={i} d={`M${-14 + i * 24} -60 q-12 -20 0 -40 q12 -20 0 -40`} fill="none" stroke={f('#cccccc')} strokeWidth={6} opacity={0.5 + Math.sin(t * 3 + i) * 0.3} />
          ))}
          <path d="M-50 -40 L50 -40 L40 60 L-40 60 Z" fill={f(color ?? '#ffffff')} {...o} />
          <path d="M50 -20 Q85 -15 80 15 Q75 40 45 35" fill="none" stroke={f(color ?? '#ffffff')} strokeWidth={12} />
        </g>
      )
    case 'trophy':
      return (
        <g>
          <path d="M-60 -80 L60 -80 Q60 10 0 30 Q-60 10 -60 -80 Z" fill={f('#f2c14e')} {...o} />
          <rect x={-12} y={28} width={24} height={36} fill={f('#d99a1e')} />
          <rect x={-50} y={62} width={100} height={22} rx={4} fill={f('#7a5236')} {...o} />
        </g>
      )
    case 'warning':
      return (
        <g>
          <path d="M0 -90 L90 70 L-90 70 Z" fill={f('#ffd23f')} {...o} />
          {txt('!', 90, 55, '#2b211b')}
        </g>
      )
    case 'zzz':
      return (
        <g>
          {[0, 1, 2].map((i) => {
            const k = (t * 0.8 + i / 3) % 1
            return (
              <text key={i} x={k * 60} y={-k * 140} fontFamily={s.font} fontSize={40 + i * 10} fontWeight={700} fill={s.chalk ? s.ink : s.text} opacity={1 - k}>
                Z
              </text>
            )
          })}
        </g>
      )
    case 'lightning':
      return <path opacity={Math.sin(t * 20) > -0.3 ? 1 : 0.2} d="M10 -100 L-50 10 L-5 10 L-25 100 L55 -20 L8 -20 Z" fill={f('#ffe25c')} {...o} />
    case 'fish':
      return (
        <g transform={`translate(${Math.sin(t * 2) * 20} ${Math.sin(t * 4) * 6})`}>
          <path d="M-70 0 Q-10 -55 60 0 Q-10 55 -70 0 Z" fill={f(color ?? '#ff9f43')} {...o} />
          <path d="M55 0 L100 -35 L100 35 Z" fill={f(color ?? '#ff9f43')} {...o} />
          <circle cx={-35} cy={-8} r={7} fill="#2b211b" />
        </g>
      )
    case 'bird': {
      const w = Math.sin(t * 10) * 30
      return <path d={`M-70 ${w} Q-35 -25 0 0 Q35 -25 70 ${w}`} fill="none" stroke={s.chalk ? s.ink : s.tint ? s.tint('#2b211b') : '#2b211b'} strokeWidth={10} strokeLinecap="round" />
    }
    case 'tent':
      return (
        <g>
          <path d="M-120 80 L0 -90 L120 80 Z" fill={f(color ?? '#e07a3f')} {...o} />
          <path d="M-30 80 L0 10 L30 80 Z" fill={f('#5b3a24')} />
        </g>
      )
    case 'flag':
      return (
        <g>
          <rect x={-60} y={-100} width={10} height={200} fill={f('#6b4a2f')} />
          <path d={`M-50 -100 Q0 ${-115 + Math.sin(t * 6) * 10} 60 -100 L60 -30 Q0 ${-45 + Math.sin(t * 6) * 10} -50 -30 Z`} fill={f(c1)} {...o} />
          {label && txt(label.slice(0, 6), 26, -55, '#ffffff')}
        </g>
      )
    case 'gem':
      return (
        <g transform={`rotate(${Math.sin(t * 2) * 6})`}>
          <path d="M-70 -30 L-35 -70 L35 -70 L70 -30 L0 80 Z" fill={f(color ?? '#5ec8f2')} {...o} />
          <path d="M-70 -30 L70 -30 M-35 -70 L0 80 L35 -70" fill="none" stroke="#ffffff" strokeOpacity={0.6} strokeWidth={4} />
        </g>
      )
    case 'bag':
      return (
        <g>
          <path d="M-70 -30 Q-80 80 0 80 Q80 80 70 -30 Z" fill={f('#c8924f')} {...o} />
          <path d="M-30 -30 Q0 -80 30 -30" fill="none" stroke={f('#8a5f2e')} strokeWidth={10} />
          {txt('$', 50, 40, '#5b3a24')}
        </g>
      )
    case 'calendar':
      return (
        <g>
          <rect x={-90} y={-90} width={180} height={180} rx={12} fill={f('#ffffff')} {...o} />
          <rect x={-90} y={-90} width={180} height={50} rx={12} fill={f(c1)} />
          {txt((label ?? 'DAY 1').slice(0, 8), 40, 35)}
        </g>
      )
    case 'rocket':
      return (
        <g transform={`translate(0 ${Math.sin(t * 9) * 3})`}>
          <path d="M-20 60 Q0 100 20 60" fill={f('#ff8a2a')} opacity={0.6 + Math.sin(t * 20) * 0.3} />
          <path d="M0 -110 Q45 -50 35 60 L-35 60 Q-45 -50 0 -110 Z" fill={f('#eeeeee')} {...o} />
          <circle cx={0} cy={-30} r={18} fill={f('#5ec8f2')} {...o} />
          <path d="M-35 20 L-65 70 L-35 60 Z M35 20 L65 70 L35 60 Z" fill={f(c1)} {...o} />
        </g>
      )
    case 'planet':
      return (
        <g transform={`rotate(${t * 6})`}>
          <circle r={75} fill={f(color ?? '#e9a15b')} {...o} />
          <ellipse rx={125} ry={26} fill="none" stroke={f('#f4dcb0')} strokeWidth={12} transform="rotate(-18)" />
        </g>
      )
    default:
      return null
  }
}
