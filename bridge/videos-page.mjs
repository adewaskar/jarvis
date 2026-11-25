import { existsSync, readFileSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

/**
 * GET /videos: every finished video JARVIS has made, newest first, playable in
 * the page, with where it was posted (or whether it waits for approval).
 */

const WORKING = /^(silent|cut|scene-\d+|clip-\d+)\.mp4$/i

export async function listVideos(workspace) {
  const root = join(workspace, 'studio')
  const queue = (() => {
    try {
      return JSON.parse(readFileSync(join(workspace, 'autopilot', 'queue.json'), 'utf8'))
    } catch {
      return []
    }
  })()
  const found = []
  for (const d of await readdir(root).catch(() => [])) {
    if (/^(images|sfx|music)$/i.test(d)) continue
    for (const name of await readdir(join(root, d)).catch(() => [])) {
      if (!/\.mp4$/i.test(name) || WORKING.test(name) || /^hero(-mobile)?\.mp4$/i.test(name)) continue
      const path = join(root, d, name)
      const st = await stat(path).catch(() => null)
      if (!st?.isFile()) continue
      const thumb = ['thumbnail.jpg', 'thumbnail.png'].map((t) => join(root, d, t)).find((t) => existsSync(t)) ?? null
      const q = queue.filter((x) => x.video === path).at(-1)
      const posted = q ? Object.entries(q.results ?? {}).filter(([, r]) => r?.ok).map(([p, r]) => ({ platform: p, url: r.url ?? null })) : []
      found.push({
        path,
        thumb,
        title: q?.title ?? name.replace(/\.mp4$/i, '').replace(/^\d[\d-]*-/, '').replace(/[-_]/g, ' '),
        made: st.mtime.toISOString(),
        mb: +(st.size / 1e6).toFixed(1),
        queueId: q?.id ?? null,
        channel: q?.channel ?? null,
        caption: q?.caption ?? q?.description ?? null,
        status: q ? (q.status === 'review' ? 'waiting for your OK' : posted.length ? 'posted' : q.status) : 'not queued',
        posted,
      })
    }
  }
  return found.sort((a, b) => b.made.localeCompare(a.made))
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export function renderVideosPage(videos) {
  const cards = videos
    .map((v) => {
      const src = `/video?path=${encodeURIComponent(v.path)}`
      const poster = v.thumb ? ` poster="/videos/thumb?path=${encodeURIComponent(v.thumb)}"` : ''
      const links = v.posted
        .map((p) => (p.url && /^https:\/\//.test(p.url) ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.platform)}</a>` : esc(p.platform)))
        .join(' · ')
      return `<article>
  <video controls preload="none"${poster} src="${src}"></video>
  <h2>${esc(v.title)}</h2>
  <p>${esc(new Date(v.made).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }))} · ${v.mb} MB · <span class="st">${esc(v.status)}</span>${links ? ` · ${links}` : ''}</p>
</article>`
    })
    .join('\n')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JARVIS · Videos</title>
<style>
:root{color-scheme:dark}
body{margin:0;font:15px/1.5 system-ui,sans-serif;background:#0b0f17;color:#e6edf6}
header{padding:20px 24px;border-bottom:1px solid #1d2635;display:flex;justify-content:space-between;align-items:baseline}
h1{margin:0;font-size:20px;letter-spacing:.04em}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:18px;padding:24px}
article{background:#121927;border:1px solid #1d2635;border-radius:12px;overflow:hidden}
video{width:100%;aspect-ratio:16/9;background:#000;display:block;object-fit:contain}
h2{font-size:15px;margin:10px 14px 2px;text-transform:capitalize}
p{margin:0 14px 12px;color:#93a1b5;font-size:13px}
.st{color:#7fd1ff}
a{color:#7fd1ff}
.empty{padding:40px 24px;color:#93a1b5}
</style></head><body>
<header><h1>Videos JARVIS made</h1><span>${videos.length} video${videos.length === 1 ? '' : 's'}</span></header>
${videos.length ? `<main>${cards}</main>` : '<p class="empty">No videos yet. Ask JARVIS to make one.</p>'}
<script>
// One video plays at a time.
document.addEventListener('play', (e) => { for (const v of document.querySelectorAll('video')) if (v !== e.target) v.pause() }, true)
</script>
</body></html>`
}

/**
 * "Pop it out": put a finished video on the owner's screen (a video blade that
 * plays at once). Live sessions only, since only they have a screen.
 */
export function videosServer({ workspace, show }) {
  return createSdkMcpServer({
    name: 'jarvis_videos',
    version: '1.0.0',
    alwaysLoad: true,
    tools: [
      tool(
        'show_video',
        'Open a finished video on the screen and play it, when the owner says "pop it out", "show me", "pull up" or "let me watch". which: "waiting" (newest video waiting for their OK, the default), "latest" (newest video made) or "path" (give path). Returns what it is, its status and queueId, so you can explain it and, if they say yes, approve it with approve_scheduled_post.',
        { which: z.enum(['waiting', 'latest', 'path']).optional(), path: z.string().optional() },
        async ({ which = 'waiting', path }) => {
          const all = await listVideos(workspace)
          const v =
            which === 'path' ? all.find((x) => x.path === path) : which === 'latest' ? all[0] : (all.find((x) => x.status === 'waiting for your OK') ?? null)
          if (!v) {
            const text = which === 'waiting' ? 'No video is waiting for the owner right now.' + (all[0] ? ' The newest one is ' + all[0].title + ' (' + all[0].status + ').' : '') : 'No such video.'
            return { content: [{ type: 'text', text }], isError: which === 'path' }
          }
          show({ path: v.path, title: v.title })
          const { path: p, title, status, queueId, channel, caption, mb, made } = v
          return { content: [{ type: 'text', text: JSON.stringify({ shown: true, title, status, queueId, channel, caption, mb, made, path: p }) }] }
        },
      ),
    ],
  })
}
