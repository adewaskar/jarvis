import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { safe } from './secrets.mjs'

/**
 * Pipelines: the user's boards, run by JARVIS.
 *
 *   Agency leads  RESEARCHED → SCORED → APPROVED LEAD → DEMO READY →
 *                 APPROVED TO SEND → CONTACTED → REPLIED → MEETING → PROPOSAL → WON
 *   YouTube       IDEA → RESEARCH → SOURCES VERIFIED → SCRIPT → SCRIPT APPROVED →
 *                 EDITING → UPLOAD DRAFT → PUBLISHED
 *
 * The APPROVED stages are the user's decisions, and the code holds them to it:
 *   - nothing can be created in or past an approval stage;
 *   - nothing can jump over an approval stage it has not been through;
 *   - only a live conversation (the user is there) or a click on the board page
 *     can move a card INTO an approval stage — the unattended autopilot cannot.
 *
 * Stored in <workspace>/pipelines/items.json. The board page is served by the
 * bridge at http://localhost:8787/board.
 */

export const BOARDS = {
  agency: {
    title: 'Agency leads',
    stages: ['researched', 'scored', 'approved_lead', 'demo_ready', 'approved_to_send', 'contacted', 'replied', 'meeting', 'proposal', 'won'],
    approval: ['approved_lead', 'approved_to_send'],
    fields: 'company, website, contact, email, phone, niche, location, score (0-100), why (reason for the score), demoUrl, proposalValue',
  },
  youtube: {
    title: 'YouTube',
    stages: ['idea', 'research', 'sources_verified', 'script', 'script_approved', 'editing', 'upload_draft', 'published'],
    approval: ['script_approved'],
    fields: 'angle, hook, sources (list of URLs), script, videoPath, thumbnailPath, videoId, url',
  },
}
const LOST = 'lost'
const label = (s) => s.replace(/_/g, ' ').toUpperCase()

export function createPipelines({ workspace }) {
  const dir = join(workspace, 'pipelines')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'items.json')
  const load = () => {
    try {
      return JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      return []
    }
  }
  const save = (items) => {
    writeFileSync(file + '.tmp', JSON.stringify(items, null, 2))
    renameSync(file + '.tmp', file)
  }

  function summary(board) {
    const b = BOARDS[board]
    const items = load().filter((i) => i.board === board)
    return {
      board,
      title: b.title,
      stages: [...b.stages, LOST].map((s) => ({
        stage: s,
        label: label(s),
        approval: b.approval.includes(s),
        count: items.filter((i) => i.stage === s).length,
      })),
    }
  }

  /** The one place a card changes stage, so every rule is enforced in one spot. */
  function move(id, to, { by, canApprove, note }) {
    const items = load()
    const item = items.find((i) => i.id === id)
    if (!item) throw new Error('No card with that id.')
    const b = BOARDS[item.board]
    if (to !== LOST && !b.stages.includes(to)) throw new Error(`"${to}" is not a stage on ${b.title}. Stages: ${b.stages.join(', ')}.`)
    if (to !== LOST && to !== item.stage) {
      const from = b.stages.indexOf(item.stage)
      const target = b.stages.indexOf(to)
      if (b.approval.includes(to) && !canApprove) {
        throw new Error(`${label(to)} is the user's decision. Leave it at ${label(item.stage)} and ask them to approve it (by voice or on the board).`)
      }
      if (target > from) {
        const visited = new Set([item.stage, ...item.history.map((h) => h.to)])
        const skipped = b.stages.slice(from + 1, target).find((s) => b.approval.includes(s) && !visited.has(s))
        if (skipped) throw new Error(`Cannot skip ${label(skipped)}: it needs the user's approval first.`)
      }
    }
    item.history.push({ at: new Date().toISOString(), from: item.stage, to, by })
    if (note) item.notes.push({ at: new Date().toISOString(), text: note })
    item.stage = to
    item.updated = new Date().toISOString()
    save(items)
    return item
  }

  function makeServer({ allowWrites, canApprove, by }) {
    const reads = [
      tool(
        'list_pipeline',
        `A board with counts per stage and its cards. Boards: agency (Agency leads), youtube (YouTube).
Filter by stage to see what is waiting. Show it on a blade as columns; say only the headline aloud.`,
        { board: z.enum(['agency', 'youtube']), stage: z.string().optional().catch(undefined) },
        safe(async ({ board, stage }) => ({
          ...summary(board),
          cards: load()
            .filter((i) => i.board === board && (!stage || i.stage === stage))
            .map((i) => ({ id: i.id, title: i.title, stage: i.stage, updated: i.updated, ...pick(i.fields, ['company', 'score', 'angle', 'url', 'email']) })),
          fields: BOARDS[board].fields,
        })),
      ),
      tool(
        'get_pipeline_card',
        'One card in full: all fields, notes and stage history.',
        { id: z.string() },
        safe(async ({ id }) => {
          const item = load().find((i) => i.id === id)
          if (!item) throw new Error('No card with that id.')
          return item
        }),
      ),
    ]
    const writes = [
      tool(
        'create_pipeline_card',
        `Add a card. agency starts at researched (or scored with a score); youtube starts at idea, research,
sources_verified or script. Cards cannot be created in an approval stage. Fields per board:
agency: ${BOARDS.agency.fields}. youtube: ${BOARDS.youtube.fields}.`,
        {
          board: z.enum(['agency', 'youtube']),
          title: z.string().max(200),
          stage: z.string().optional(),
          fields: z.record(z.string(), z.any()).optional(),
          note: z.string().max(2000).optional(),
        },
        safe(async ({ board, title, stage, fields = {}, note }) => {
          const b = BOARDS[board]
          const st = stage ?? b.stages[0]
          const firstGate = b.stages.indexOf(b.approval[0])
          if (!b.stages.includes(st) || b.stages.indexOf(st) >= firstGate) {
            throw new Error(`New ${b.title} cards start before ${label(b.approval[0])}: ${b.stages.slice(0, firstGate).join(', ')}.`)
          }
          const now = new Date().toISOString()
          const item = { id: randomUUID().slice(0, 8), board, title, stage: st, fields, notes: note ? [{ at: now, text: note }] : [], history: [{ at: now, from: null, to: st, by }], created: now, updated: now }
          const items = load()
          items.push(item)
          save(items)
          return { created: item.id, stage: st }
        }),
      ),
      tool(
        'update_pipeline_card',
        `Change a card: move it to another stage, merge in fields, add a note. Moving INTO an approval
stage (${[...new Set(Object.values(BOARDS).flatMap((b) => b.approval))].join(', ')}) records the user's decision —
${canApprove ? 'do it only when the user has just said so in this conversation, and put their words in the note.' : 'not allowed in this unattended session; leave the card for the user.'}
Use stage "lost" for leads that went nowhere or ideas that are dropped.`,
        {
          id: z.string(),
          stage: z.string().optional(),
          fields: z.record(z.string(), z.any()).optional(),
          note: z.string().max(2000).optional(),
        },
        safe(async ({ id, stage, fields, note }) => {
          if (fields) {
            const items = load()
            const it = items.find((i) => i.id === id)
            if (!it) throw new Error('No card with that id.')
            it.fields = { ...it.fields, ...fields }
            it.updated = new Date().toISOString()
            if (note && !stage) it.notes.push({ at: it.updated, text: note })
            save(items)
          } else if (note && !stage) {
            const items = load()
            const it = items.find((i) => i.id === id)
            if (!it) throw new Error('No card with that id.')
            it.notes.push({ at: new Date().toISOString(), text: note })
            save(items)
          }
          const item = stage ? move(id, stage, { by, canApprove, note }) : load().find((i) => i.id === id)
          return { id: item.id, title: item.title, stage: item.stage }
        }),
      ),
      tool(
        'delete_pipeline_card',
        'Remove a card entirely (prefer moving it to "lost" so the history is kept).',
        { id: z.string() },
        safe(async ({ id }) => {
          const items = load()
          const i = items.findIndex((x) => x.id === id)
          if (i < 0) throw new Error('No card with that id.')
          items.splice(i, 1)
          save(items)
          return { deleted: id }
        }),
      ),
    ]
    return createSdkMcpServer({
      name: 'jarvis_pipelines',
      version: '1.0.0',
      instructions:
        "The user's boards: Agency leads (find, score and win clients) and YouTube (idea to published). " +
        'Approval stages are the user\'s decisions. The board page is at http://localhost:8787/board.',
      alwaysLoad: true,
      tools: allowWrites ? [...reads, ...writes] : reads,
    })
  }

  /** The board page and its approve/move endpoint. Returns true if it handled the request. */
  async function handleHttp(req, res) {
    const url = new URL(req.url, 'http://x')
    if (req.method === 'GET' && url.pathname === '/board') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors http://localhost:* http://127.0.0.1:*",
      })
      res.end(BOARD_PAGE)
      return true
    }
    if (req.method === 'GET' && url.pathname === '/board/data') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ boards: BOARDS, items: load() }))
      return true
    }
    if (req.method === 'POST' && url.pathname === '/board/move') {
      // A custom header can't be sent cross-site without a CORS preflight,
      // which the bridge refuses for unknown origins — so only this page can.
      if (req.headers['x-jarvis-board'] !== '1') {
        res.writeHead(403).end('forbidden')
        return true
      }
      let body = ''
      for await (const c of req) {
        body += c
        if (body.length > 10_000) break
      }
      try {
        const { id, stage, note } = JSON.parse(body)
        const item = move(String(id), String(stage), { by: 'user (board)', canApprove: true, note: note ? String(note).slice(0, 2000) : undefined })
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(item))
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: e.message }))
      }
      return true
    }
    return false
  }

  /** One card by id (a copy), or null. */
  const card = (id) => structuredClone(load().find((i) => i.id === id) ?? null)

  return { makeServer, handleHttp, summary, card }
}

function pick(o = {}, keys) {
  return Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]))
}

const BOARD_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>J.A.R.V.I.S. · Pipelines</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#04070c;--panel:#0a121c;--line:#123247;--ink:#cfefff;--dim:#5f8aa3;--accent:#3fd8ff;--gate:#ffb547;--won:#5dff9e;--lost:#ff5d6c}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(1200px 600px at 50% -200px,#0b2233,var(--bg));color:var(--ink);font:13px/1.4 ui-monospace,Consolas,monospace;min-height:100vh}
header{display:flex;align-items:center;gap:16px;padding:18px 24px;border-bottom:1px solid var(--line)}
h1{font-size:14px;letter-spacing:.3em;margin:0;color:var(--accent)}nav button{background:none;border:1px solid var(--line);color:var(--dim);padding:6px 14px;letter-spacing:.15em;cursor:pointer;font:inherit}
nav button.on{color:var(--ink);border-color:var(--accent);box-shadow:0 0 12px #3fd8ff33 inset}
.totals{margin-left:auto;color:var(--dim)}
.board{display:flex;gap:10px;padding:18px 24px;overflow-x:auto;align-items:flex-start}
.col{min-width:230px;max-width:230px;background:var(--panel);border:1px solid var(--line);display:flex;flex-direction:column;max-height:calc(100vh - 110px)}
.col h2{font-size:11px;letter-spacing:.18em;margin:0;padding:10px 12px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;color:var(--dim)}
.col h2 b{color:var(--ink)}.col.gate h2{color:var(--gate)}.col.won h2{color:var(--won)}.col.lost h2{color:var(--lost)}
.cards{overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:8px}
.card{border:1px solid var(--line);background:#07101a;padding:9px 10px;cursor:pointer}.card:hover{border-color:var(--accent)}
.card .t{color:var(--ink);margin-bottom:4px}.card .m{color:var(--dim);font-size:11px}
.card .wait{color:var(--gate);font-size:11px;margin-top:6px}
.empty{color:#2d4b5d;padding:8px;font-size:11px}
dialog{background:var(--panel);color:var(--ink);border:1px solid var(--accent);max-width:640px;width:92vw;padding:0}
dialog .in{padding:18px 20px}dialog h3{margin:0 0 4px;font-size:15px}dialog pre{white-space:pre-wrap;color:var(--dim);max-height:260px;overflow:auto;border:1px solid var(--line);padding:8px}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.btn{background:none;border:1px solid var(--line);color:var(--ink);padding:7px 12px;cursor:pointer;font:inherit}
.btn.approve{border-color:var(--gate);color:var(--gate)}.btn.go{border-color:var(--accent);color:var(--accent)}.btn.lost{border-color:var(--lost);color:var(--lost)}
.err{color:var(--lost);margin-top:8px}
</style></head><body>
<header><h1>J.A.R.V.I.S. · PIPELINES</h1><nav id="tabs"></nav><div class="totals" id="totals"></div></header>
<main class="board" id="board"></main>
<dialog id="dlg"><div class="in" id="dlgIn"></div></dialog>
<script>
let data = {boards:{},items:[]}, current = location.hash.slice(1) || 'agency'
const $ = (s) => document.querySelector(s)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const label = (s) => s.replace(/_/g, ' ').toUpperCase()
async function load(){ data = await (await fetch('/board/data',{cache:'no-store'})).json(); render() }
function render(){
  $('#tabs').innerHTML = Object.entries(data.boards).map(([k,b]) => '<button class="'+(k===current?'on':'')+'" data-b="'+k+'">'+esc(b.title.toUpperCase())+'</button>').join('')
  const b = data.boards[current], items = data.items.filter((i) => i.board === current)
  $('#totals').textContent = items.length + ' cards · ' + items.filter((i) => b.approval.includes(b.stages[b.stages.indexOf(i.stage)+1])).length + ' awaiting your approval'
  $('#board').innerHTML = [...b.stages, 'lost'].map((s, idx) => {
    const cs = items.filter((i) => i.stage === s)
    const cls = b.approval.includes(s) ? 'gate' : s === b.stages.at(-1) ? 'won' : s === 'lost' ? 'lost' : ''
    return '<section class="col '+cls+'"><h2><span>'+(s==='lost'?'':(idx+1)+'. ')+label(s)+'</span><b>'+cs.length+'</b></h2><div class="cards">' +
      (cs.length ? cs.map((c) => {
        const next = b.stages[b.stages.indexOf(c.stage)+1]
        const f = c.fields || {}
        return '<div class="card" data-id="'+c.id+'"><div class="t">'+esc(c.title)+'</div><div class="m">'+esc([f.company, f.score!=null?('score '+f.score):'', f.angle].filter(Boolean).join(' · '))+'</div>' +
          (next && b.approval.includes(next) ? '<div class="wait">▲ awaiting your approval</div>' : '') + '</div>'
      }).join('') : '<div class="empty">—</div>') + '</div></section>'
  }).join('')
}
function open(id){
  const c = data.items.find((i) => i.id === id), b = data.boards[c.board]
  const next = b.stages[b.stages.indexOf(c.stage)+1], prev = b.stages[b.stages.indexOf(c.stage)-1]
  $('#dlgIn').innerHTML = '<h3>'+esc(c.title)+'</h3><div class="m">'+label(c.stage)+' · updated '+esc((c.updated||'').slice(0,16).replace('T',' '))+'</div>' +
    '<pre>'+esc(JSON.stringify(c.fields, null, 2))+'</pre>' +
    (c.notes.length ? '<pre>'+esc(c.notes.map((n) => n.at.slice(0,16).replace('T',' ')+'  '+n.text).join('\\n'))+'</pre>' : '') +
    '<div class="row">' + (next ? '<button class="btn '+(b.approval.includes(next)?'approve':'go')+'" data-move="'+next+'">'+(b.approval.includes(next)?'✓ APPROVE → ':'→ ')+label(next)+'</button>' : '') +
    (prev ? '<button class="btn" data-move="'+prev+'">← '+label(prev)+'</button>' : '') +
    (c.stage !== 'lost' ? '<button class="btn lost" data-move="lost">✕ LOST</button>' : '') +
    '<button class="btn" data-close>CLOSE</button></div><div class="err" id="err"></div>'
  $('#dlg').dataset.id = id; $('#dlg').showModal()
}
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-b],[data-id],[data-move],[data-close]'); if (!t) return
  if (t.dataset.b){ current = t.dataset.b; location.hash = current; render() }
  else if (t.dataset.id && !t.dataset.move) open(t.dataset.id)
  else if (t.dataset.close !== undefined) $('#dlg').close()
  else if (t.dataset.move){
    const r = await fetch('/board/move', {method:'POST', headers:{'content-type':'application/json','x-jarvis-board':'1'}, body: JSON.stringify({id: $('#dlg').dataset.id, stage: t.dataset.move})})
    const j = await r.json(); if (!r.ok) { $('#err').textContent = j.error; return }
    $('#dlg').close(); load()
  }
})
load(); setInterval(load, 5000)
</script></body></html>`
