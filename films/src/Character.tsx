import React from 'react'
import type { Expression, Look, Pose } from './types'
import type { StyleDef } from './styles'
import { fill, stroke } from './paint'

/**
 * The channel's character, drawn from simple shapes so it stays identical in
 * every video. Local units: feet at (0,0), about 340 tall, facing right.
 * Limb angles are degrees from straight down; positive swings forward.
 */

interface Angles {
  fu: number // front upper arm
  ff: number // front forearm, relative to the upper arm
  bu: number // back upper arm
  bf: number
  ft: number // front thigh
  fs: number // front shin, relative (negative bends the knee back)
  bt: number
  bs: number
  lean: number
  lift: number // body raised (+) or lowered (-)
  head: number // head tilt
}

const S = Math.sin
const deg = (d: number) => (d * Math.PI) / 180

function pose(p: Pose, t: number): Angles {
  const base: Angles = { fu: 10, ff: 12, bu: -10, bf: 12, ft: 4, fs: 0, bt: -4, bs: 0, lean: 0, lift: 0, head: 0 }
  const breathe = S(t * 2.2) * 1.5
  switch (p) {
    case 'walk': {
      const w = S(t * Math.PI * 3.2)
      return { ...base, fu: -24 * w, ff: 18, bu: 24 * w, bf: 18, ft: 26 * w, fs: -Math.max(0, -w) * 34, bt: -26 * w, bs: -Math.max(0, w) * 34, lean: 4, lift: Math.abs(w) * 6, head: 0 }
    }
    case 'run': {
      const w = S(t * Math.PI * 5)
      return { ...base, fu: -48 * w, ff: 80, bu: 48 * w, bf: 80, ft: 48 * w, fs: -Math.max(0, -w) * 75 - 10, bt: -48 * w, bs: -Math.max(0, w) * 75 - 10, lean: 14, lift: Math.abs(w) * 16, head: 4 }
    }
    case 'sit':
      return { ...base, fu: 25, ff: 40, bu: 15, bf: 40, ft: 88, fs: -88, bt: 82, bs: -82, lift: -88, head: breathe }
    case 'sleep':
      return { ...base, fu: 20, ff: 30, bu: 12, bf: 30, ft: 88, fs: -88, bt: 82, bs: -82, lift: -88, head: 22 + breathe, lean: 6 }
    case 'think':
      return { ...base, fu: 32, ff: 128, bu: -8, bf: 40, head: -8 + breathe }
    case 'shock': {
      const j = Math.abs(S(t * 9)) * Math.max(0, 1 - t * 1.4)
      return { ...base, fu: 155, ff: 20, bu: -155, bf: 20, ft: 12, bt: -12, lift: j * 40, lean: -6, head: -4 }
    }
    case 'celebrate': {
      const b = Math.abs(S(t * 7))
      return { ...base, fu: 160 + S(t * 14) * 8, ff: 10, bu: -160 - S(t * 14) * 8, bf: 10, ft: 10, fs: -b * 20, bt: -10, bs: -b * 20, lift: b * 30 }
    }
    case 'sad':
      return { ...base, fu: 3, ff: 4, bu: -3, bf: 4, lean: 10, head: 18 + breathe, lift: -4 }
    case 'point':
      return { ...base, fu: 92, ff: 0, bu: -12, bf: 20, head: -3 }
    case 'wave':
      return { ...base, fu: 150, ff: 25 + S(t * 12) * 28, bu: -10, bf: 12, head: -4 }
    case 'talk':
      return { ...base, fu: 40 + S(t * 4) * 14, ff: 60 + S(t * 3) * 20, bu: -12, bf: 20, head: S(t * 3) * 3 }
    default:
      return { ...base, fu: 10 + breathe, bu: -10 - breathe, head: breathe }
  }
}

const seg = (x: number, y: number, a: number, len: number): [number, number] => [x + len * S(deg(a)), y + len * Math.cos(deg(a))]

const Limb: React.FC<{ pts: [number, number][]; color: string; w: number; s: StyleDef }> = ({ pts, color, w, s }) => {
  const d = `M${pts.map((p) => p.join(' ')).join(' L')}`
  return (
    <>
      {s.line > 0 && <path d={d} fill="none" stroke={s.ink} strokeWidth={w + s.line * 2} strokeLinecap="round" strokeLinejoin="round" />}
      <path d={d} fill="none" stroke={fill(s, color)} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
    </>
  )
}

function Hair({ look, s }: { look: Look; s: StyleDef }) {
  const c = fill(s, look.hair)
  const o = stroke(s)
  switch (look.hairStyle) {
    case 'bald':
      return null
    case 'long':
      return <path d="M-60 -300 Q-62 -365 0 -368 Q62 -365 60 -300 L64 -225 Q40 -240 30 -300 Q0 -320 -30 -300 Q-40 -240 -64 -225 Z" fill={c} {...o} />
    case 'cap':
      return (
        <g>
          <path d="M-58 -305 Q-56 -365 0 -366 Q56 -365 58 -305 Z" fill={fill(s, look.accent)} {...o} />
          <path d="M40 -312 Q90 -314 104 -300 Q80 -296 40 -298 Z" fill={fill(s, look.accent)} {...o} />
        </g>
      )
    case 'bun':
      return (
        <g>
          <circle cx={-8} cy={-372} r={24} fill={c} {...o} />
          <path d="M-58 -298 Q-60 -362 0 -364 Q60 -362 58 -298 Q30 -330 -58 -298 Z" fill={c} {...o} />
        </g>
      )
    case 'spiky':
      return <path d="M-58 -300 L-62 -340 L-40 -330 L-36 -372 L-12 -346 L4 -382 L18 -346 L44 -370 L42 -330 L64 -336 L58 -300 Q0 -326 -58 -300 Z" fill={c} {...o} />
    default:
      return <path d="M-58 -298 Q-62 -364 0 -366 Q62 -364 58 -298 Q52 -334 20 -332 Q-20 -340 -58 -298 Z" fill={c} {...o} />
  }
}

function Face({ e, t, talking, s }: { e: Expression; t: number; talking: boolean; s: StyleDef }) {
  const ink = s.chalk ? s.ink : s.tint ? s.tint('#2b211b') : '#2b211b'
  const blink = (t % 3.7) > 3.58 || e === 'sleepy'
  const eyeY = -292
  const eyes =
    blink ? (
      <g stroke={ink} strokeWidth={5} strokeLinecap="round" fill="none">
        <path d={`M8 ${eyeY} q9 5 18 0`} />
        <path d={`M34 ${eyeY} q9 5 18 0`} />
      </g>
    ) : e === 'happy' ? (
      <g stroke={ink} strokeWidth={5} strokeLinecap="round" fill="none">
        <path d={`M8 ${eyeY + 3} q9 -10 18 0`} />
        <path d={`M34 ${eyeY + 3} q9 -10 18 0`} />
      </g>
    ) : e === 'scared' || e === 'surprised' ? (
      <g>
        <circle cx={17} cy={eyeY} r={10} fill="#fff" stroke={ink} strokeWidth={3} />
        <circle cx={43} cy={eyeY} r={10} fill="#fff" stroke={ink} strokeWidth={3} />
        <circle cx={19} cy={eyeY} r={3.5} fill={ink} />
        <circle cx={45} cy={eyeY} r={3.5} fill={ink} />
      </g>
    ) : (
      <g fill={ink}>
        <ellipse cx={17} cy={eyeY} rx={5.5} ry={8} />
        <ellipse cx={43} cy={eyeY} rx={5.5} ry={8} />
      </g>
    )
  const brows =
    e === 'angry' ? (
      <g stroke={ink} strokeWidth={5} strokeLinecap="round">
        <path d={`M6 ${eyeY - 22} L26 ${eyeY - 14}`} />
        <path d={`M54 ${eyeY - 22} L34 ${eyeY - 14}`} />
      </g>
    ) : e === 'sad' || e === 'scared' ? (
      <g stroke={ink} strokeWidth={5} strokeLinecap="round">
        <path d={`M6 ${eyeY - 14} L26 ${eyeY - 22}`} />
        <path d={`M54 ${eyeY - 14} L34 ${eyeY - 22}`} />
      </g>
    ) : null
  const open = talking ? Math.abs(S(t * 15)) * Math.abs(S(t * 4.3)) : 0
  const mouthY = -258
  let mouth: React.ReactNode
  if (e === 'surprised' || e === 'scared') mouth = <ellipse cx={30} cy={mouthY} rx={9} ry={12} fill={ink} />
  else if (open > 0.08) mouth = <ellipse cx={30} cy={mouthY} rx={11} ry={3 + open * 10} fill={ink} />
  else if (e === 'happy') mouth = <path d={`M14 ${mouthY - 5} q16 18 32 0`} fill="none" stroke={ink} strokeWidth={5} strokeLinecap="round" />
  else if (e === 'sad') mouth = <path d={`M16 ${mouthY + 6} q14 -12 28 0`} fill="none" stroke={ink} strokeWidth={5} strokeLinecap="round" />
  else if (e === 'angry') mouth = <path d={`M16 ${mouthY + 2} L44 ${mouthY - 2}`} stroke={ink} strokeWidth={5} strokeLinecap="round" />
  else mouth = <path d={`M18 ${mouthY - 2} q12 7 24 0`} fill="none" stroke={ink} strokeWidth={5} strokeLinecap="round" />
  return (
    <g>
      {eyes}
      {brows}
      {mouth}
    </g>
  )
}

export const Character: React.FC<{ look: Look; pose: Pose; expression: Expression; t: number; talking: boolean; s: StyleDef }> = ({
  look,
  pose: p,
  expression,
  t,
  talking,
  s,
}) => {
  const a = pose(p, t)
  const hipY = -150 - a.lift
  const hip: [number, number] = [0, hipY]
  const shoulderY = hipY - 104
  const lx = 8 * S(deg(a.lean))
  const legs = (th: number, sh: number): [number, number][] => {
    const k = seg(hip[0], hip[1], th, 78)
    const f = seg(k[0], k[1], th + sh, 74)
    return [hip, k, f]
  }
  const arm = (u: number, f: number, sx: number): [number, number][] => {
    const sh: [number, number] = [lx + sx, shoulderY]
    const e = seg(sh[0], sh[1], u, 62)
    const h = seg(e[0], e[1], u + f, 58)
    return [sh, e, h]
  }
  const frontLeg = legs(a.ft, a.fs)
  const backLeg = legs(a.bt, a.bs)
  const frontArm = arm(a.fu, a.ff, 30)
  const backArm = arm(a.bu, a.bf, -26)
  const o = stroke(s)
  // A raised arm goes behind the head so it never covers the face.
  const raised = a.fu > 115
  const frontArmEl = (
    <>
      <Limb pts={frontArm} color={look.outfit} w={24} s={s} />
      <ellipse cx={frontArm[2][0]} cy={frontArm[2][1]} rx={13} ry={13} fill={fill(s, look.skin)} {...o} />
    </>
  )
  const darker = s.tint ? s.tint(look.pants) : look.pants
  return (
    <g>
      <Limb pts={backLeg} color={darker} w={30} s={s} />
      <Limb pts={backArm} color={look.outfit} w={24} s={s} />
      <ellipse cx={backArm[2][0]} cy={backArm[2][1]} rx={13} ry={13} fill={fill(s, look.skin)} {...o} />
      <Limb pts={frontLeg} color={look.pants} w={30} s={s} />
      {raised && frontArmEl}
      <g transform={`rotate(${a.lean * 0.8} ${hip[0]} ${hip[1]})`}>
        <path
          d={`M${-44} ${hipY + 8} Q-50 ${hipY - 60} -38 ${hipY - 112} Q0 ${hipY - 126} 40 ${hipY - 112} Q52 ${hipY - 60} 46 ${hipY + 8} Z`}
          fill={fill(s, look.outfit)}
          {...o}
        />
        <path d={`M-8 ${hipY - 112} L0 ${hipY - 90} L8 ${hipY - 112}`} fill="none" stroke={fill(s, look.accent)} strokeWidth={6} strokeLinecap="round" />
        <g transform={`translate(0 ${hipY + 150 - 34}) rotate(${a.head} 0 -240)`}>
          <circle cx={4} cy={-298} r={62} fill={fill(s, look.skin)} {...o} />
          <ellipse cx={-50} cy={-292} rx={10} ry={15} fill={fill(s, look.skin)} {...o} />
          <Hair look={look} s={s} />
          <Face e={expression} t={t} talking={talking} s={s} />
          {(s.clay || s.paper) && <ellipse cx={46} cy={-270} rx={10} ry={6} fill="#ff7a7a" opacity={0.35} />}
        </g>
      </g>
      {!raised && frontArmEl}
      <ellipse cx={frontLeg[2][0] + 10} cy={frontLeg[2][1]} rx={22} ry={11} fill={fill(s, '#2e2a28')} {...o} />
      <ellipse cx={backLeg[2][0] + 10} cy={backLeg[2][1]} rx={22} ry={11} fill={fill(s, '#2e2a28')} {...o} />
    </g>
  )
}
