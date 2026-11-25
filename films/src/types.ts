/**
 * A film is a list of scenes, written as data (not code) so an unattended
 * JARVIS run can describe a story and this project draws it the same way every
 * time. Positions are fractions of the frame: x 0 = left edge, 1 = right edge;
 * y 0 = top, 1 = bottom. Times inside a scene are seconds from its start.
 */

export const STYLES = [
  'paper-cutout',
  'pixel-art',
  'ink-wash',
  'retro-cartoon',
  'clay',
  'chalkboard',
  'flat-vector',
  'neon-night',
] as const
export type StyleName = (typeof STYLES)[number]

export const POSES = ['stand', 'walk', 'run', 'sit', 'think', 'shock', 'celebrate', 'sad', 'point', 'wave', 'sleep', 'talk'] as const
export type Pose = (typeof POSES)[number]

export const EXPRESSIONS = ['neutral', 'happy', 'sad', 'angry', 'scared', 'surprised', 'sleepy'] as const
export type Expression = (typeof EXPRESSIONS)[number]

export const SETTINGS = [
  'plain', 'city', 'room', 'office', 'forest', 'island', 'ocean', 'desert',
  'mountains', 'space', 'road', 'village', 'cave', 'school',
] as const
export type Setting = (typeof SETTINGS)[number]

export const PROPS = [
  'tree', 'palm', 'rock', 'house', 'building', 'boat', 'raft', 'phone', 'money', 'coin',
  'clock', 'fire', 'cloud', 'sun', 'moon', 'star', 'arrow', 'question', 'exclaim', 'heart',
  'skull', 'chart-up', 'chart-down', 'crate', 'car', 'bottle', 'book', 'lightbulb', 'sign',
  'map', 'key', 'door', 'bed', 'desk', 'computer', 'coffee', 'trophy', 'warning', 'zzz',
  'lightning', 'fish', 'bird', 'tent', 'flag', 'gem', 'bag', 'calendar', 'rocket', 'planet',
] as const
export type PropKind = (typeof PROPS)[number]

export type Enter = 'pop' | 'drop' | 'slide' | 'fade' | 'none'
export type Camera = 'still' | 'push-in' | 'pull-out' | 'pan-left' | 'pan-right' | 'shake'
export type Transition = 'cut' | 'fade' | 'wipe' | 'slide'
export type TimeOfDay = 'day' | 'night' | 'sunset' | 'dawn'

export interface Look {
  skin: string
  hair: string
  hairStyle: 'short' | 'long' | 'bald' | 'cap' | 'bun' | 'spiky'
  outfit: string
  pants: string
  accent: string
}

export interface Actor {
  who?: 'hero' | 'other'
  pose: Pose
  expression?: Expression
  x?: number
  /** Walks (or runs) from x to here over the scene. */
  to?: number
  facing?: 'left' | 'right'
  size?: number
  /** Mouth moves: true while the narrator speaks for this character. */
  talking?: boolean
  enter?: Enter
}

export interface PropItem {
  kind: PropKind
  x: number
  y: number
  size?: number
  enter?: Enter
  at?: number
  color?: string
  /** Text on a sign, calendar, flag or map. */
  label?: string
  /** Gentle bob/float. */
  float?: boolean
}

export interface TextItem {
  value: string
  kind?: 'title' | 'caption' | 'big-number' | 'label'
  at?: number
}

export interface Word {
  text: string
  start: number
  end: number
}

export interface Scene {
  seconds: number
  setting: Setting
  time?: TimeOfDay
  weather?: 'none' | 'rain' | 'snow'
  actors?: Actor[]
  props?: PropItem[]
  text?: TextItem
  camera?: Camera
  transition?: Transition
  /** Word-timed subtitles for this scene (seconds from the scene start). */
  words?: Word[]
}

export type FilmProps = {
  style: StyleName
  aspect: '16:9' | '9:16'
  fps?: number
  hero: Look
  other?: Look
  scenes: Scene[]
  subtitles?: boolean
  /** Small text in a corner on every frame, e.g. the channel name. */
  watermark?: string
}
