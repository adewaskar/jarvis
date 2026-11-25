#!/usr/bin/env node
/**
 * Render a film (silent; the studio adds voice, sound effects and music).
 *
 *   node render.mjs <props.json> <out.mp4>
 *   node render.mjs <props.json> <out.png> --still <seconds>
 *   node render.mjs --sample <out.mp4>
 *
 * Prints JSON progress lines ({"progress":0.42}) and a final {"done":...}.
 */
import { bundle } from '@remotion/bundler'
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const stillAt = args.includes('--still') ? String(args[args.indexOf('--still') + 1]).split(',').map(Number) : null
const sample = args[0] === '--sample'
const propsPath = sample ? null : args[0]
const out = resolve(sample ? args[1] : args[1])
if (!out || (!sample && !propsPath)) {
  console.error('Usage: node render.mjs <props.json> <out.mp4|out.png> [--still <seconds>]')
  process.exit(2)
}

const inputProps = sample ? undefined : JSON.parse(await readFile(propsPath, 'utf8'))
const serveUrl = await bundle({ entryPoint: join(here, 'src', 'index.ts'), webpackOverride: (c) => c })
const composition = await selectComposition({ serveUrl, id: 'Film', inputProps })

if (stillAt !== null) {
  for (const [i, at] of stillAt.entries()) {
    const output = stillAt.length > 1 ? out.replace(/(\.\w+)$/,`-${i + 1}$1`) : out
    await renderStill({ composition, serveUrl, output, inputProps, frame: Math.min(composition.durationInFrames - 1, Math.round(at * composition.fps)) })
  }
} else {
  let last = -1
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    crf: 20,
    muted: true,
    outputLocation: out,
    inputProps,
    onProgress: ({ progress }) => {
      const p = Math.floor(progress * 20) / 20
      if (p !== last) console.log(JSON.stringify({ progress: p }))
      last = p
    },
  })
}
console.log(JSON.stringify({ done: out, seconds: composition.durationInFrames / composition.fps, width: composition.width, height: composition.height }))
