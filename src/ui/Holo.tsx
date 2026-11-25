import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'

/**
 * The Command Center's centrepiece: a wireframe holographic head standing on
 * a slowly turning globe, all procedural SVG (no model files). The head is a
 * sphere deformed into a skull-jaw-neck profile, drawn as contour rings and
 * meridians; it sways gently, and its eyes brighten with the voice level.
 */

const RINGS = 22
const MERIDIANS = 28
const STEPS = 48

/** Half-width of the head at height y (y: -1 crown … 1.32 neck base). */
function profile(y: number) {
  // sloping shoulders under the neck so it reads as a bust, not a bulb
  if (y > 1.02) return Math.min(1.25, 0.3 + (y - 1.02) * 1.9)
  if (y > 0.78) return 0.3
  const t = (y + 0.04) / 0.96
  let w = 0.76 * Math.sqrt(Math.max(0, 1 - t * t))
  if (y > 0.12) w *= 1 - 0.42 * Math.min(1, (y - 0.12) / 0.66) // jaw down to the chin
  return Math.max(w, y > 0.66 ? 0.3 : 0)
}

/** Facial relief: nose, brow and chin pushed toward the viewer. */
function relief(y: number, facing: number) {
  if (facing <= 0) return 0
  const f = facing ** 6
  const nose = Math.exp(-(((y - 0.18) / 0.16) ** 2)) * 0.16
  const brow = Math.exp(-(((y + 0.12) / 0.07) ** 2)) * 0.05
  const chin = Math.exp(-(((y - 0.74) / 0.08) ** 2)) * 0.06
  return f * (nose + brow + chin)
}

type P = [number, number, number]

function point(y: number, lon: number, yaw: number): P {
  const w = profile(y)
  const facing = Math.cos(lon - Math.PI / 2)
  const r = w + relief(y, facing)
  const x = r * Math.cos(lon)
  const z = r * Math.sin(lon) * 0.92
  const cx = x * Math.cos(yaw) - z * Math.sin(yaw)
  const cz = x * Math.sin(yaw) + z * Math.cos(yaw)
  return [cx * 47, y * 50 - 44, cz]
}

const path = (pts: P[]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('')

export function Holo() {
  const level = useStore((s) => s.level)
  const phase = useStore((s) => s.phase)
  const [t, setT] = useState(0)

  useEffect(() => {
    let raf = 0
    let last = 0
    const tick = (now: number) => {
      if (now - last > 33) {
        setT(now / 1000)
        last = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const yaw = Math.sin(t * 0.35) * 0.42

  const head = useMemo(() => {
    const rings: { d: string; back: boolean }[] = []
    for (let i = 1; i < RINGS; i++) {
      const y = -1 + (i / RINGS) * 2.56
      const front: P[] = []
      const back: P[] = []
      for (let k = 0; k <= STEPS; k++) {
        const p = point(y, (k / STEPS) * Math.PI * 2, yaw)
        ;(p[2] >= 0 ? front : back).push(p)
      }
      if (back.length > 1) rings.push({ d: path(back), back: true })
      if (front.length > 1) rings.push({ d: path(front), back: false })
    }
    const merid: { d: string; back: boolean }[] = []
    for (let m = 0; m < MERIDIANS; m++) {
      const lon = (m / MERIDIANS) * Math.PI * 2
      const pts: P[] = []
      for (let k = 0; k <= 40; k++) pts.push(point(-1 + (k / 40) * 2.56, lon, yaw))
      const z = Math.sin(lon) * Math.cos(yaw) + Math.cos(lon) * Math.sin(yaw)
      merid.push({ d: path(pts), back: z < 0 })
    }
    return { rings, merid }
  }, [yaw])

  // Globe: latitude ellipses plus meridians that turn with time.
  const G = 62
  const gy = 100
  const spin = (t * 9) % 360
  const meridians = Array.from({ length: 12 }, (_, i) => Math.abs(Math.cos((((i * 15 + spin) % 180) * Math.PI) / 180)) * G)

  const eye = 0.55 + Math.min(1, level * 2.2) * 0.45
  const eyeX = Math.cos(yaw) * 13
  const eyeShift = Math.sin(-yaw) * 4
  const busy = phase === 'thinking' || phase === 'tooling'

  return (
    <svg className={`holo${busy ? ' busy' : ''}`} viewBox="-120 -112 240 280" aria-hidden>
      <defs>
        <radialGradient id="holo-floor" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--holo)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="var(--holo)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="holo-aura" cx="50%" cy="40%" r="55%">
          <stop offset="0%" stopColor="var(--holo)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--holo)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx="0" cy="-30" rx="92" ry="96" fill="url(#holo-aura)" />

      {/* globe */}
      <g className="holo-globe">
        <circle cx="0" cy={gy} r={G + 7} className="holo-halo" />
        <circle cx="0" cy={gy} r={G} className="holo-edge" />
        {[-60, -40, -20, 0, 20, 40, 60].map((lat) => {
          const y = Math.sin((lat * Math.PI) / 180) * G
          const rx = Math.cos((lat * Math.PI) / 180) * G
          return <ellipse key={lat} cx="0" cy={gy - y} rx={rx} ry={rx * 0.16} className="holo-line" />
        })}
        {meridians.map((rx, i) => (
          <ellipse key={i} cx="0" cy={gy} rx={rx} ry={G} className="holo-line" />
        ))}
        <ellipse cx="0" cy={gy + 2} rx={G * 1.35} ry={G * 0.22} className="holo-orbit" />
        <ellipse cx="0" cy={gy + 2} rx={G * 1.6} ry={G * 0.3} className="holo-orbit dim" />
      </g>

      {/* head */}
      <g className="holo-head">
        {head.merid.filter((m) => m.back).map((m, i) => <path key={`mb${i}`} d={m.d} className="holo-mesh back" />)}
        {head.rings.filter((r) => r.back).map((r, i) => <path key={`rb${i}`} d={r.d} className="holo-mesh back" />)}
        {head.merid.filter((m) => !m.back).map((m, i) => <path key={`mf${i}`} d={m.d} className="holo-mesh" />)}
        {head.rings.filter((r) => !r.back).map((r, i) => <path key={`rf${i}`} d={r.d} className="holo-mesh" />)}
        <g style={{ opacity: eye }}>
          <ellipse cx={-eyeX + eyeShift} cy="-46" rx="6" ry="2" className="holo-eye" />
          <ellipse cx={eyeX + eyeShift} cy="-46" rx="6" ry="2" className="holo-eye" />
        </g>
      </g>

      <ellipse cx="0" cy={gy + G - 4} rx="96" ry="12" fill="url(#holo-floor)" />
    </svg>
  )
}
