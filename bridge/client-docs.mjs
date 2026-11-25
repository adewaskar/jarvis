import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The agency's client paperwork, filled in from templates/agency/.
 *
 *   before/  sent while pitching: the proposal and terms, the notice that goes
 *            on every demo site, and the agency's own privacy notice for the
 *            businesses it contacts.
 *   after/   once the client has signed: the service agreement, the optional
 *            care plan, the client site's privacy policy and terms (also as
 *            privacy.html and terms.html), and the launch checklist.
 *
 * Placeholders are {{NAME}}. Anything missing is written as [[MISSING: NAME]]
 * and reported, so a document with a blank never goes out by accident.
 */

export const TEMPLATE_DIR = fileURLToPath(new URL('../templates/agency/', import.meta.url))

export function fillTemplate(text, values) {
  const missing = new Set()
  const out = text.replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => {
    const v = values[k]
    if (v === undefined || v === null || String(v).trim() === '') {
      missing.add(k)
      return `[[MISSING: ${k}]]`
    }
    return String(v)
  })
  return { text: out, missing: [...missing] }
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const inline = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => (/^(https?:|mailto:|[a-z0-9-]+\.html$)/i.test(u) ? `<a href="${u}">${t}</a>` : t))

/** Just enough Markdown for these documents: headings, paragraphs, lists, quotes, bold, links. */
export function mdToHtml(md, title) {
  const lines = md.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)
  const html = []
  let list = false
  let para = []
  const flush = () => {
    if (para.length) html.push(`<p>${inline(para.join(' '))}</p>`)
    para = []
  }
  const endList = () => {
    if (list) html.push('</ul>')
    list = false
  }
  for (const raw of lines) {
    const line = raw.trim()
    const h = line.match(/^(#{1,3})\s+(.*)$/)
    const li = line.match(/^[-*]\s+(?:\[ \]\s+)?(.*)$/)
    if (!line) {
      flush()
      endList()
    } else if (h) {
      flush()
      endList()
      html.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`)
    } else if (li) {
      flush()
      if (!list) html.push('<ul>')
      list = true
      html.push(`<li>${inline(li[1])}</li>`)
    } else if (line.startsWith('>')) {
      flush()
      endList()
      html.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`)
    } else {
      endList()
      para.push(line)
    }
  }
  flush()
  endList()
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>body{font:17px/1.6 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1.2rem;color:#222}h1{line-height:1.2}a{color:inherit}</style>
</head><body>
${html.join('\n')}
<p><a href="index.html">Back to the home page</a></p>
</body></html>
`
}

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'client'

/**
 * Fill every template for one stage into outDir.
 * @returns {Promise<{ dir: string, files: string[], missing: Record<string, string[]> }>}
 */
export async function prepareDocs({ stage, outDir, values, includeCarePlan = true, templateDir = TEMPLATE_DIR }) {
  const src = join(templateDir, stage)
  await mkdir(outDir, { recursive: true })
  const files = []
  const missing = {}
  for (const name of (await readdir(src)).filter((f) => f.endsWith('.md')).sort()) {
    if (name === 'care-plan.md' && !includeCarePlan) continue
    const { text, missing: gaps } = fillTemplate(await readFile(join(src, name), 'utf8'), values)
    const out = join(outDir, name)
    await writeFile(out, text)
    files.push(out)
    if (gaps.length) missing[name] = gaps
    // The client's legal pages also go out as ready-to-upload HTML.
    const page = { 'site-privacy-policy.md': ['privacy.html', 'Privacy Policy'], 'site-terms.md': ['terms.html', 'Terms of Use'] }[name]
    if (page) {
      const html = join(outDir, page[0])
      await writeFile(html, mdToHtml(text, `${page[1]} | ${values.CLIENT_BUSINESS ?? ''}`))
      files.push(html)
    }
  }
  return { dir: outDir, files, missing }
}

export const clientSlug = slugify
