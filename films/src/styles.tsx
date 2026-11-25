import React from 'react'
import type { StyleName, TimeOfDay } from './types'

/**
 * Each art style is a palette plus a few drawing rules. Everything in a film
 * reads its colours and outlines from here, so one switch restyles the lot.
 */
export interface StyleDef {
  font: string
  ink: string
  line: number
  /** Hard offset shadow (paper) or soft (clay); null = none. */
  shadow: { dx: number; dy: number; blur: number; opacity: number } | null
  /** Animate on twos/threes: a hand-made, stop-motion feel. */
  step: number
  /** Edge wobble from an SVG turbulence filter (0 = clean). */
  rough: number
  sky: Record<TimeOfDay, [string, string]>
  ground: string
  ground2: string
  far: string
  mid: string
  near: string
  accent: string
  accent2: string
  text: string
  textBg: string
  /** Whole-frame look: CSS filter on the stage. */
  grade?: string
  paper?: boolean
  grain?: boolean
  vignette?: boolean
  glow?: boolean
  clay?: boolean
  pixel?: number
  chalk?: boolean
  flicker?: boolean
  /** Swap a look's colours (e.g. greys for ink, chalk white). */
  tint?: (c: string) => string
}

const grey = (c: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c)
  if (!m) return c
  const n = parseInt(m[1], 16)
  const v = Math.round(((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11)
  const h = v.toString(16).padStart(2, '0')
  return `#${h}${h}${h}`
}

export const STYLE_DEFS: Record<StyleName, StyleDef> = {
  'paper-cutout': {
    font: '"Segoe Print", "Comic Sans MS", sans-serif',
    ink: '#3a2a1e',
    line: 0,
    shadow: { dx: 7, dy: 9, blur: 0.5, opacity: 0.32 },
    step: 3,
    rough: 3.5,
    sky: { day: ['#9fd3e6', '#e8f4ef'], night: ['#1d2547', '#3b3f6b'], sunset: ['#f29e6d', '#f8d9a0'], dawn: ['#c6b5e0', '#f6d6c4'] },
    ground: '#8fbf6a',
    ground2: '#6f9e52',
    far: '#b9d4c4',
    mid: '#86b08a',
    near: '#5d8b5f',
    accent: '#e2574c',
    accent2: '#f2c14e',
    text: '#2f2219',
    textBg: '#fbf3e0',
    paper: true,
  },
  'pixel-art': {
    font: '"Consolas", "Courier New", monospace',
    ink: '#14121f',
    line: 6,
    shadow: null,
    step: 3,
    rough: 0,
    sky: { day: ['#5fcde4', '#cbf0f7'], night: ['#140c2c', '#2b1d5c'], sunset: ['#d95763', '#fbb954'], dawn: ['#8b6bc4', '#f4b6a6'] },
    ground: '#4caf50',
    ground2: '#2e7d32',
    far: '#7ec8a0',
    mid: '#3d8f5c',
    near: '#256b45',
    accent: '#ff4f69',
    accent2: '#ffd23f',
    text: '#ffffff',
    textBg: '#14121f',
    pixel: 10,
  },
  'ink-wash': {
    font: '"Georgia", serif',
    ink: '#1b1b1b',
    line: 4,
    shadow: null,
    step: 2,
    rough: 5,
    sky: { day: ['#efe9dc', '#e2dccd'], night: ['#9c978c', '#c7c1b3'], sunset: ['#eadbc8', '#e9d2c0'], dawn: ['#ece4d6', '#e4dccd'] },
    ground: '#d8d1c1',
    ground2: '#bdb5a3',
    far: '#cfc8b8',
    mid: '#a39c8c',
    near: '#6f695d',
    accent: '#b3261e',
    accent2: '#3c3c3c',
    text: '#1b1b1b',
    textBg: '#f3eee2',
    paper: true,
    tint: (c) => (c.toLowerCase() === '#b3261e' ? c : grey(c)),
  },
  'retro-cartoon': {
    font: '"Georgia", serif',
    ink: '#111111',
    line: 5,
    shadow: null,
    step: 2,
    rough: 2,
    sky: { day: ['#d9d9d9', '#f2f2f2'], night: ['#4a4a4a', '#7a7a7a'], sunset: ['#bdbdbd', '#e6e6e6'], dawn: ['#c8c8c8', '#ececec'] },
    ground: '#9e9e9e',
    ground2: '#7d7d7d',
    far: '#bcbcbc',
    mid: '#8a8a8a',
    near: '#5c5c5c',
    accent: '#ffffff',
    accent2: '#222222',
    text: '#111111',
    textBg: '#f4f1e8',
    grade: 'sepia(0.35) contrast(1.15)',
    grain: true,
    vignette: true,
    flicker: true,
    tint: grey,
  },
  clay: {
    font: '"Arial Rounded MT Bold", "Segoe UI Black", sans-serif',
    ink: '#4a3b35',
    line: 0,
    shadow: { dx: 0, dy: 14, blur: 12, opacity: 0.35 },
    step: 2,
    rough: 1.2,
    sky: { day: ['#a7d8f0', '#fdf1dc'], night: ['#2a2f5a', '#5a4f7c'], sunset: ['#ff9f7a', '#ffe0a8'], dawn: ['#d3b8f0', '#ffdcc9'] },
    ground: '#a6d36f',
    ground2: '#86b552',
    far: '#c6e3c2',
    mid: '#8cc28c',
    near: '#5fa06a',
    accent: '#ff6b5b',
    accent2: '#ffc94d',
    text: '#3d2f2a',
    textBg: '#fff4e3',
    clay: true,
  },
  chalkboard: {
    font: '"Segoe Print", "Comic Sans MS", sans-serif',
    ink: '#f5f5ef',
    line: 5,
    shadow: null,
    step: 3,
    rough: 3,
    sky: { day: ['#24402f', '#2c4a37'], night: ['#1c3326', '#24402f'], sunset: ['#2a4634', '#30503c'], dawn: ['#27432f', '#2e4d39'] },
    ground: '#2f5240',
    ground2: '#2a4a3a',
    far: '#355c47',
    mid: '#3c6650',
    near: '#47735b',
    accent: '#ffd479',
    accent2: '#ff9aa2',
    text: '#f5f5ef',
    textBg: '#2a4a3a',
    chalk: true,
  },
  'flat-vector': {
    font: '"Segoe UI Black", "Arial Black", sans-serif',
    ink: '#1f2a44',
    line: 0,
    shadow: null,
    step: 1,
    rough: 0,
    sky: { day: ['#8ecae6', '#e3f2fd'], night: ['#0b1e3f', '#24406b'], sunset: ['#ff8c61', '#ffd29d'], dawn: ['#a594f9', '#ffd6e0'] },
    ground: '#90be6d',
    ground2: '#6a994e',
    far: '#bde0c6',
    mid: '#7fb88a',
    near: '#4f8f5f',
    accent: '#ef476f',
    accent2: '#ffd166',
    text: '#1f2a44',
    textBg: '#ffffff',
  },
  'neon-night': {
    font: '"Segoe UI Black", "Arial Black", sans-serif',
    ink: '#e9f7ff',
    line: 4,
    shadow: null,
    step: 1,
    rough: 0,
    sky: { day: ['#0d0221', '#261447'], night: ['#05010f', '#1a0b38'], sunset: ['#1b0638', '#4a1259'], dawn: ['#120430', '#35155e'] },
    ground: '#120630',
    ground2: '#1e0b45',
    far: '#2a1260',
    mid: '#3b1a7a',
    near: '#541f9c',
    accent: '#ff2a6d',
    accent2: '#05d9e8',
    text: '#ffffff',
    textBg: '#0d0221',
    glow: true,
  },
}

/** Shared SVG filters. Seeds change on a slow beat so edges "boil" like hand-made animation. */
export const Defs: React.FC<{ s: StyleDef; boil: number; W: number; H: number }> = ({ s, boil, W, H }) => (
  <defs>
    {s.rough > 0 && (
      <filter id="rough" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves={2} seed={boil % 4} result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale={s.rough * 2} xChannelSelector="R" yChannelSelector="G" />
      </filter>
    )}
    {s.shadow && (
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx={s.shadow.dx} dy={s.shadow.dy} stdDeviation={s.shadow.blur} floodColor="#000" floodOpacity={s.shadow.opacity} />
      </filter>
    )}
    {s.clay && (
      <filter id="clay" x="-20%" y="-20%" width="140%" height="150%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="9" result="b" />
        <feSpecularLighting in="b" surfaceScale="6" specularConstant="0.55" specularExponent="16" lightingColor="#ffffff" result="sp">
          <fePointLight x={-W * 0.3} y={-H * 0.6} z={700} />
        </feSpecularLighting>
        <feComposite in="sp" in2="SourceAlpha" operator="in" result="sp2" />
        <feComposite in="SourceGraphic" in2="sp2" operator="arithmetic" k1={0} k2={1} k3={0.8} k4={0} result="lit" />
        <feDropShadow in="lit" dx={0} dy={14} stdDeviation={12} floodColor="#000" floodOpacity={0.3} />
      </filter>
    )}
    {s.glow && (
      <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="7" result="g" />
        <feMerge>
          <feMergeNode in="g" />
          <feMergeNode in="g" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    )}
    {s.pixel && (
      <filter id="pixel" x="0" y="0" width="100%" height="100%">
        <feFlood x={s.pixel / 2} y={s.pixel / 2} width="1" height="1" />
        <feComposite width={s.pixel} height={s.pixel} />
        <feTile result="t" />
        <feComposite in="SourceGraphic" in2="t" operator="in" />
        <feMorphology operator="dilate" radius={s.pixel / 2} />
      </filter>
    )}
    {(s.paper || s.grain || s.chalk) && (
      <filter id="texture" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency={s.grain ? 0.9 : s.chalk ? 0.6 : 0.5} numOctaves={s.grain ? 1 : 3} seed={s.grain ? boil : 3} />
        <feColorMatrix type="saturate" values="0" />
      </filter>
    )}
    <radialGradient id="vignette" cx="50%" cy="50%" r="75%">
      <stop offset="55%" stopColor="#000" stopOpacity="0" />
      <stop offset="100%" stopColor="#000" stopOpacity="0.65" />
    </radialGradient>
  </defs>
)

/** The filter chain for a drawn object (actor or prop) in this style. */
export const objectFilter = (s: StyleDef) => {
  if (s.clay) return 'url(#clay)'
  if (s.glow) return 'url(#glow)'
  if (s.shadow && s.rough) return 'url(#shadow)'
  if (s.shadow) return 'url(#shadow)'
  return undefined
}
