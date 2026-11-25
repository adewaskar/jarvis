import type { FilmProps } from './types'

/** A short story used by `npm run studio` and the render test. */
export const sample: FilmProps = {
  style: 'paper-cutout',
  aspect: '16:9',
  hero: { skin: '#f1c7a3', hair: '#3b2a20', hairStyle: 'short', outfit: '#3f7cc4', pants: '#2f3b52', accent: '#f2c14e' },
  other: { skin: '#c98f68', hair: '#1d1d1d', hairStyle: 'bun', outfit: '#d9534f', pants: '#3b3b3b', accent: '#ffffff' },
  watermark: 'Untold Files',
  scenes: [
    {
      seconds: 3,
      setting: 'ocean',
      time: 'sunset',
      text: { value: 'Stranded for 438 days', kind: 'title', at: 0.2 },
      props: [{ kind: 'raft', x: 0.5, y: 0.74, size: 1.4, enter: 'none' }],
      camera: 'push-in',
    },
    {
      seconds: 4,
      setting: 'island',
      time: 'day',
      transition: 'wipe',
      actors: [{ pose: 'walk', x: 0.15, to: 0.45, expression: 'scared' }],
      props: [{ kind: 'crate', x: 0.7, y: 0.74, size: 0.6, at: 1.5, enter: 'drop' }],
      camera: 'pan-left',
      words: [
        { text: 'He', start: 0.2, end: 0.4 },
        { text: 'washed', start: 0.4, end: 0.8 },
        { text: 'up', start: 0.8, end: 1.0 },
        { text: 'with', start: 1.0, end: 1.2 },
        { text: 'nothing.', start: 1.2, end: 1.9 },
      ],
    },
    {
      seconds: 3.5,
      setting: 'island',
      time: 'night',
      transition: 'slide',
      actors: [{ pose: 'sit', x: 0.4, expression: 'sad' }],
      props: [{ kind: 'fire', x: 0.58, y: 0.76, size: 0.6, enter: 'pop', at: 0.5 }],
      text: { value: 'Day 37', kind: 'big-number', at: 0.3 },
    },
    {
      seconds: 3,
      setting: 'island',
      time: 'day',
      transition: 'fade',
      actors: [{ pose: 'celebrate', x: 0.4, expression: 'happy' }],
      props: [
        { kind: 'boat', x: 0.8, y: 0.62, size: 0.9, enter: 'slide', at: 0.3 },
        { kind: 'exclaim', x: 0.4, y: 0.25, size: 0.5, at: 0.6 },
      ],
      camera: 'shake',
    },
  ],
}
