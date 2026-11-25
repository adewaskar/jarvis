import type { StyleDef } from './styles'

/** A fill colour in this style (greys for ink, see-through chalk on the board). */
export const fill = (s: StyleDef, c: string) => (s.chalk ? 'rgba(245,245,239,0.14)' : s.tint ? s.tint(c) : c)

/** Outline props for a shape, or none when the style draws without lines. */
export const stroke = (s: StyleDef, scale = 1) =>
  s.line > 0 ? { stroke: s.ink, strokeWidth: s.line * scale, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const } : {}

/** Deterministic pseudo-random numbers, so a scene draws the same on every frame. */
export const rand = (seed: number) => {
  let t = seed + 0x6d2b79f5
  return () => {
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t), 3)
export const easeInOut = (t: number) => {
  const x = clamp(t)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}
/** Overshoot then settle: the "pop" of a cut-out landing on the page. */
export const pop = (t: number) => {
  const x = clamp(t)
  const c1 = 1.9
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}
