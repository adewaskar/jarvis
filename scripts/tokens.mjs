#!/usr/bin/env node
/**
 * Compile design-system/tokens.json into design-system/tokens.css.
 *
 * The JSON is the one source for every colour, size, glow and tempo in the
 * interface; src/index.css imports the CSS this writes and reads them as
 * custom properties. Run `npm run tokens` after editing the JSON, and commit
 * both files. Never edit tokens.css by hand.
 *
 * Custom properties only, deliberately: the text styles in tokens.json share
 * their names with the app's own classes (.brand-mark, .status, .hud-label),
 * so emitting a class per style would layer line-heights and tracking onto
 * elements the app never gave them. The styles stay documentation; the
 * stylesheet keeps owning the rules.
 *   :root, [data-theme="<first theme>"] { colours, shadows }
 *   [data-theme="<other theme>"]        { the same, per further theme }
 *   :root                               { every other family, then --font-* }
 *   @font-face                          { one per font file, if any }
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'design-system')
const t = JSON.parse(readFileSync(join(root, 'tokens.json'), 'utf8'))
const themes = t.color.themes.map((x) => x.id)

/** A colour or shadow value for one theme; `{name}` becomes var(--name). */
function val(value, theme) {
  const s = typeof value === 'string' ? value : (value[theme] ?? value[themes[0]])
  return /^\{.+\}$/.test(s) ? `var(--${s.slice(1, -1)})` : s
}

const out = [`/* ${t.name} — generated from tokens.json */`]
const themed = [...t.color.tokens, ...(t.shadow?.tokens ?? [])]

out.push(`:root, [data-theme="${themes[0]}"] {`)
for (const k of themed) out.push(`  --${k.name}: ${val(k.value, themes[0])};`)
out.push('}')
for (const theme of themes.slice(1)) {
  out.push(`[data-theme="${theme}"] {`)
  for (const k of themed) out.push(`  --${k.name}: ${val(k.value, theme)};`)
  out.push('}')
}

out.push(':root {')
for (const [family, v] of Object.entries(t)) {
  if (family === 'color' || family === 'type' || family === 'shadow') continue
  if (!v || typeof v !== 'object' || !Array.isArray(v.tokens)) continue
  for (const k of v.tokens) out.push(`  --${k.name}: ${k.value};`)
}
for (const [key, stack] of Object.entries(t.type.families)) out.push(`  --font-${key}: ${stack};`)
out.push('}')

for (const f of t.type.fonts ?? []) {
  out.push(
    `@font-face { font-family: '${f.family}'; src: url('${f.file}'); ` +
      `font-weight: ${f.weight ?? '400'}; font-style: ${f.style ?? 'normal'}; }`,
  )
}

writeFileSync(join(root, 'tokens.css'), out.join('\n') + '\n')
console.log(`wrote design-system/tokens.css (${out.length} lines)`)
