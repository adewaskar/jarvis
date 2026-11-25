import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decideTool } from '../bridge/policy.mjs'
import { createPipelines } from '../bridge/pipelines.mjs'
import { createAutopilot, titleOverlap } from '../bridge/autopilot.mjs'
import { accountArg, accountSecret, currentAccount, listAccounts, withAccount, withoutAccountArg } from '../bridge/accounts.mjs'
import { systemServer } from '../bridge/system.mjs'
import { createAgency } from '../bridge/agency.mjs'
import { fillTemplate, mdToHtml } from '../bridge/client-docs.mjs'

const READS = {
  jarvis_tiktok: ['get_tiktok_profile', 'list_tiktok_videos', 'get_tiktok_creator_settings', 'check_tiktok_progress'],
  jarvis_instagram: ['get_instagram_profile', 'list_instagram_media', 'get_instagram_insights', 'list_instagram_comments'],
  jarvis_studio: ['get_media_info', 'list_studio_videos', 'show_video'],
  jarvis_films: [],
  jarvis_facebook: ['get_facebook_page'],
  jarvis_crypto: ['get_crypto_prices', 'get_crypto_chart', 'get_wallet_balances', 'list_wallet_transactions', 'get_crypto_invoice'],
  jarvis_autopilot: ['get_autopilot_settings', 'list_queue', 'list_products', 'list_brand_deals'],
  jarvis_pipelines: ['list_pipeline', 'get_pipeline_card'],
  jarvis_system: ['get_system_status', 'list_running_apps'],
  jarvis_agency: ['get_agency_settings'],
}
const WRITES = {
  jarvis_tiktok: ['upload_tiktok_video'],
  jarvis_instagram: ['upload_instagram_reel', 'post_instagram_comment_reply'],
  jarvis_studio: ['create_image', 'create_voiceover', 'create_captions', 'render_short', 'render_clip'],
  jarvis_crypto: ['create_nft_package'],
  jarvis_films: ['make_film'],
  jarvis_autopilot: ['update_autopilot_settings', 'update_autopilot_channel', 'approve_scheduled_post', 'run_channel_now', 'create_scheduled_post', 'delete_scheduled_post', 'update_products', 'update_brand_deal'],
  jarvis_pipelines: ['create_pipeline_card', 'update_pipeline_card', 'delete_pipeline_card'],
  jarvis_system: ['launch_app', 'launch_link', 'close_app', 'set_volume', 'lock_computer', 'sleep_computer', 'schedule_shutdown', 'cancel_shutdown'],
  jarvis_agency: ['update_agency_settings', 'launch_agency_run', 'call_owner', 'prepare_client_documents'],
}

test('creator reads run in read-only mode', () => {
  for (const [s, tools] of Object.entries(READS)) for (const t of tools) assert.equal(decideTool(`mcp__${s}__${t}`, false), true, `${s}.${t}`)
})

test('creator writes need --writes', () => {
  for (const [s, tools] of Object.entries(WRITES))
    for (const t of tools) {
      assert.equal(decideTool(`mcp__${s}__${t}`, false), false, `${s}.${t}`)
      assert.equal(decideTool(`mcp__${s}__${t}`, true), true, `${s}.${t}`)
    }
})

/** Call a tool on an in-process MCP server the way the SDK would. */
async function call(server, name, args) {
  const handlers = server.instance._registeredTools ?? server.instance._tools
  const t = handlers[name]
  assert.ok(t, `tool ${name} exists`)
  const res = await (t.handler ?? t.callback)(args, {})
  const text = res.content[0].text
  return { error: res.isError, data: res.isError ? text : JSON.parse(text) }
}

test('pipelines hold the approval gates', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'jarvis-pipe-'))
  const p = createPipelines({ workspace: ws })
  const auto = p.makeServer({ allowWrites: true, canApprove: false, by: 'autopilot' })
  const live = p.makeServer({ allowWrites: true, canApprove: true, by: 'user' })

  const { data } = await call(auto, 'create_pipeline_card', { board: 'agency', title: 'Acme Dental', fields: { score: 82 } })
  // Cannot be born approved.
  assert.equal((await call(auto, 'create_pipeline_card', { board: 'agency', title: 'x', stage: 'approved_lead' })).error, true)
  // Autopilot can do the work up to the gate...
  assert.equal((await call(auto, 'update_pipeline_card', { id: data.created, stage: 'scored' })).data.stage, 'scored')
  // ...but cannot approve, nor jump over the gate.
  assert.match((await call(auto, 'update_pipeline_card', { id: data.created, stage: 'approved_lead' })).data, /user's decision/)
  assert.match((await call(auto, 'update_pipeline_card', { id: data.created, stage: 'demo_ready' })).data, /Cannot skip APPROVED LEAD/)
  // The user, present, can approve; then work resumes up to the next gate.
  assert.equal((await call(live, 'update_pipeline_card', { id: data.created, stage: 'approved_lead', note: 'user: "yes go for it"' })).data.stage, 'approved_lead')
  assert.equal((await call(auto, 'update_pipeline_card', { id: data.created, stage: 'demo_ready' })).data.stage, 'demo_ready')
  assert.match((await call(auto, 'update_pipeline_card', { id: data.created, stage: 'contacted' })).data, /Cannot skip APPROVED TO SEND/)

  const yt = await call(auto, 'create_pipeline_card', { board: 'youtube', title: 'Why X', stage: 'script' })
  assert.match((await call(auto, 'update_pipeline_card', { id: yt.data.created, stage: 'editing' })).data, /SCRIPT APPROVED/)

  const list = await call(auto, 'list_pipeline', { board: 'agency' })
  assert.equal(list.data.stages.find((s) => s.stage === 'demo_ready').count, 1)
})

test('read-only pipelines expose no write tools', () => {
  const p = createPipelines({ workspace: mkdtempSync(join(tmpdir(), 'jarvis-pipe-')) })
  const s = p.makeServer({ allowWrites: false, canApprove: true, by: 'user' })
  const names = Object.keys(s.instance._registeredTools ?? s.instance._tools)
  assert.deepEqual(names.sort(), ['get_pipeline_card', 'list_pipeline'])
})

test('autopilot publishes due posts and respects the daily cap', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'jarvis-ap-'))
  const video = join(ws, 'v.mp4')
  writeFileSync(video, 'x')
  const posted = []
  const ap = createAutopilot({
    workspace: ws,
    allowWrites: true,
    checkPath: () => null,
    publishers: { tiktok: async (it) => (posted.push(it.title), { publish_id: 'p' }) },
    runAgent: async () => 'ok',
  })
  const srv = ap.makeServer()
  await call(srv, 'update_autopilot_settings', { postsPerDayPerPlatform: 2 })
  for (const n of [1, 2, 3]) await call(srv, 'create_scheduled_post', { video, title: `v${n}`, platforms: ['tiktok', 'instagram'] })
  // A future post must wait.
  await call(srv, 'create_scheduled_post', { video, title: 'later', platforms: ['tiktok'], at: new Date(Date.now() + 3600e3).toISOString() })
  await ap.publishDue()
  assert.deepEqual(posted, ['v1', 'v2'])
  const q = JSON.parse(readFileSync(join(ws, 'autopilot', 'queue.json'), 'utf8'))
  assert.match(q[0].results.instagram.error, /not connected yet/)
  assert.notEqual(q[0].status, 'done', 'waits for instagram instead of giving up')
  assert.equal(q[2].results.tiktok, undefined, 'third waits for tomorrow')
  // Turning it on needs a niche.
  assert.equal((await call(srv, 'update_autopilot_settings', { enabled: true })).error, true)
})

test('laptop power tools exist only in live sessions with writes', () => {
  const names = (o) => Object.keys(systemServer(o).instance._registeredTools).sort()
  assert.deepEqual(names({ allowWrites: false, live: true }), ['get_system_status', 'list_running_apps'])
  if (process.platform !== 'win32') return
  const headless = names({ allowWrites: true, live: false })
  for (const t of ['sleep_computer', 'schedule_shutdown', 'cancel_shutdown']) assert.ok(!headless.includes(t), t)
  assert.ok(names({ allowWrites: true, live: true }).includes('schedule_shutdown'))
})

test('accounts: names, files and the current account', async () => {
  assert.equal(accountSecret('tiktok', null), 'tiktok')
  assert.equal(accountSecret('tiktok', 'cooking'), 'tiktok@cooking')
  assert.equal(currentAccount(), null)
  assert.equal(await withAccount('cooking', async () => accountSecret('youtube')), 'youtube@cooking')
  assert.equal(accountSecret('youtube'), 'youtube', 'back to main outside withAccount')
  assert.throws(() => withAccount('../etc', () => 0), /not a valid account name/)
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-acct-'))
  for (const n of ['tiktok.json', 'tiktok@space.json', 'tiktok@cooking.json', 'tiktok-app.json', 'youtube@cars.json']) writeFileSync(join(dir, n), '{}')
  assert.deepEqual(listAccounts('tiktok', dir), ['main', 'cooking', 'space'])
  assert.deepEqual(listAccounts('youtube', dir), ['cars'])
  assert.equal(accountArg(['node', 'x', 'tiktok', '--account', 'Cooking']), 'cooking')
  assert.equal(accountArg(['node', 'x', '--account=main']), null)
  assert.deepEqual(withoutAccountArg(['node', 'x', '--account', 'a', 'file.json']), ['node', 'x', 'file.json'])
})

test('autopilot runs several channels, each through its own accounts', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'jarvis-ch-'))
  const video = join(ws, 'v.mp4')
  writeFileSync(video, 'x')
  const posted = []
  const pub = (platform) => async (it) => (posted.push(`${platform}:${currentAccount() ?? 'main'}:${it.title}`), { id: 'p' })
  const connected = new Set(['youtube:main', 'youtube:cooking', 'facebook:cooking', 'tiktok:space'])
  const ap = createAutopilot({
    workspace: ws,
    allowWrites: true,
    checkPath: () => null,
    publishers: { youtube: pub('youtube'), tiktok: pub('tiktok'), facebook: pub('facebook') },
    isConnected: (p, a) => connected.has(`${p}:${a ?? 'main'}`),
    runAgent: async () => 'ok',
  })
  const srv = ap.makeServer()
  assert.equal((await call(srv, 'update_autopilot_channel', { id: 'cooking', niche: 'Ten-minute dinners', platforms: ['youtube', 'facebook'], review: false })).error, undefined)
  assert.equal((await call(srv, 'update_autopilot_channel', { id: 'space', niche: 'Space facts', platforms: ['tiktok', 'youtube'], accounts: { youtube: 'main' }, review: false })).error, undefined)
  // Same niche twice is refused; so is a sixth channel.
  assert.match((await call(srv, 'update_autopilot_channel', { id: 'dinners', niche: 'ten minute dinners!' })).data, /already has that niche/)
  for (const n of ['a', 'b', 'c']) await call(srv, 'update_autopilot_channel', { id: n, niche: `niche ${n}` })
  assert.match((await call(srv, 'update_autopilot_channel', { id: 'f', niche: 'one too many' })).data, /already 5 channels/)
  // Posting to an unknown channel is refused.
  assert.equal((await call(srv, 'create_scheduled_post', { video, title: 'x', channel: 'nope', platforms: ['youtube'] })).error, true)

  await call(srv, 'create_scheduled_post', { video, title: 'pasta', channel: 'cooking', platforms: ['youtube', 'facebook'] })
  await call(srv, 'create_scheduled_post', { video, title: 'mars', channel: 'space', platforms: ['tiktok', 'youtube'] })
  await call(srv, 'create_scheduled_post', { video, title: 'soup', channel: 'cooking', platforms: ['youtube'] })
  await ap.publishDue()
  // cooking posts with youtube@cooking and facebook@cooking; space uses tiktok@space and the main YouTube.
  // Each new channel defaults to 1 post per platform per day, so "soup" waits.
  assert.deepEqual(posted, ['youtube:cooking:pasta', 'facebook:cooking:pasta', 'tiktok:space:mars', 'youtube:main:mars'])
  const st = (await call(srv, 'get_autopilot_settings', {})).data
  const cooking = st.channels.find((c) => c.id === 'cooking')
  assert.deepEqual(cooking.accounts.youtube, { account: 'cooking', connected: true })
  assert.equal(cooking.postedToday.youtube, 1)
  assert.equal(st.channels.length, 5)
})

test('new channels hold videos for review, refuse repeats and learn from feedback', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'jarvis-rev-'))
  const video = join(ws, 'v.mp4')
  writeFileSync(video, 'x')
  const posted = []
  const notified = []
  let media = { duration: 34, width: 1080, height: 1920, hasAudio: true }
  const ap = createAutopilot({
    workspace: ws,
    allowWrites: true,
    checkPath: () => null,
    publishers: { youtube: async (it) => (posted.push(it.title), { id: 'y' }) },
    probe: async () => media,
    onReview: (it) => notified.push(it.title),
    runAgent: async () => 'ok',
  })
  const live = ap.makeServer({ live: true })
  const headless = ap.makeServer({ live: false })
  const names = (srv) => Object.keys(srv.instance._registeredTools)
  assert.ok(names(live).includes('approve_scheduled_post'))
  assert.ok(!names(headless).includes('approve_scheduled_post'), 'an unattended run cannot approve its own video')
  assert.ok(!names(headless).includes('run_channel_now'), 'an unattended run cannot start more runs')

  await call(live, 'update_autopilot_channel', { id: 'ocean', niche: 'Strange sea creatures', platforms: ['youtube'], voice: 'bm_fable', format: 'one creature, one superpower, one twist' })
  const a = await call(headless, 'create_scheduled_post', { video, title: 'Why octopuses taste with their arms', channel: 'ocean', platforms: ['youtube'] })
  assert.match(a.data.willPost, /approves/)
  assert.deepEqual(notified, ['Why octopuses taste with their arms'])
  await ap.publishDue()
  assert.deepEqual(posted, [], 'held until approved')

  // Near-repeats and broken renders are refused.
  assert.match((await call(headless, 'create_scheduled_post', { video, title: 'Octopuses taste with their arms - why?', channel: 'ocean', platforms: ['youtube'] })).data, /Too close/)
  media = { duration: 30, width: 1080, height: 1920, hasAudio: false }
  assert.match((await call(headless, 'create_scheduled_post', { video, title: 'The fish that walks', channel: 'ocean', platforms: ['youtube'] })).data, /no sound/)
  // A 16:9 film is a regular YouTube video: YouTube only, 30 s to 15 min.
  media = { duration: 150, width: 1920, height: 1080, hasAudio: true }
  assert.match((await call(headless, 'create_scheduled_post', { video, title: 'The fish that walks', channel: 'ocean', platforms: ['youtube', 'tiktok'] })).data, /only go to YouTube/)
  media = { duration: 20, width: 1920, height: 1080, hasAudio: true }
  assert.match((await call(headless, 'create_scheduled_post', { video, title: 'The fish that walks', channel: 'ocean', platforms: ['youtube'] })).data, /30 s to 15 minutes/)
  media = { duration: 30, width: 1080, height: 1920, hasAudio: true }

  // The owner approves one and turns one down with a reason.
  assert.equal((await call(live, 'approve_scheduled_post', { id: a.data.queued, feedback: 'great hook' })).data.approved, a.data.queued)
  await ap.publishDue()
  assert.deepEqual(posted, ['Why octopuses taste with their arms'])
  const b = await call(headless, 'create_scheduled_post', { video, title: 'The fish that walks on land', channel: 'ocean', platforms: ['youtube'] })
  assert.equal((await call(live, 'delete_scheduled_post', { id: b.data.queued, feedback: 'visuals too dark' })).data.learned, true)
  const ocean = (await call(live, 'get_autopilot_settings', {})).data.channels.find((c) => c.id === 'ocean')
  assert.deepEqual(ocean.feedback.map((x) => [x.kind, x.note]), [['approved', 'great hook'], ['rejected', 'visuals too dark']])
  assert.equal(ocean.voice, 'bm_fable')
})

test('title overlap spots rewordings, not unrelated topics', () => {
  assert.ok(titleOverlap('Why octopuses taste with their arms', 'Octopuses taste with arms!') >= 0.6)
  assert.ok(titleOverlap('Why octopuses taste with their arms', 'The fish that walks on land') < 0.2)
})

test('client paperwork: filled from settings, gaps flagged, after-signing only for won cards', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'jarvis-docs-'))
  const pipelines = createPipelines({ workspace: ws })
  const agency = createAgency({ workspace: ws, allowWrites: true, runAgent: async () => 'SUMMARY: ok', pipelines })
  const live = agency.makeServer({ live: true })
  const headless = agency.makeServer({ live: false })
  const names = (srv) => Object.keys(srv.instance._registeredTools).sort()
  assert.deepEqual(names(headless), ['get_agency_settings', 'prepare_client_documents'], 'unattended runs get only the paperwork')

  await call(live, 'update_agency_settings', {
    agencyName: 'North Star Web', senderName: 'Sam', senderEmail: 'hello@example.com', businessAddress: '1 Main St, Winnipeg MB',
    governingLaw: 'the Province of Manitoba', paymentLink: 'https://pay.example.com/x', careFee: '$29 a month',
  })
  const facts = { contact: 'Maria, owner', address: '9 Elm St', email: 'maria@example.com', phone: '204 555 0100', package: 'Starter', packageDetails: 'one page', price: '$900', turnaround: '2 weeks', demoUrl: 'https://demo.example.com', domain: 'mariasbakery.ca' }
  const before = (await call(live, 'prepare_client_documents', { company: "Maria's Bakery", stage: 'before', facts })).data
  assert.equal(before.ready, true, JSON.stringify(before.missing))
  const proposal = readFileSync(before.files.find((p) => p.endsWith('proposal-and-terms.md')), 'utf8')
  assert.match(proposal, /\$900/)
  assert.match(proposal, /50%/)
  assert.doesNotMatch(proposal, /\{\{|MISSING/)

  // A gap is written visibly and reported.
  const gappy = (await call(live, 'prepare_client_documents', { company: 'Bob Plumbing', stage: 'before' })).data
  assert.equal(gappy.ready, false)
  assert.ok(gappy.missing['proposal-and-terms.md'].includes('PRICE'))

  // After-signing papers need a card in "won".
  const auto = pipelines.makeServer({ allowWrites: true, canApprove: true, by: 'user' })
  const card = (await call(auto, 'create_pipeline_card', { board: 'agency', title: "Maria's Bakery" })).data.created
  assert.match((await call(live, 'prepare_client_documents', { company: "Maria's Bakery", stage: 'after', cardId: card, facts })).data, /Move it to "won"/)
  for (const st of ['scored', 'approved_lead', 'demo_ready', 'approved_to_send', 'contacted', 'replied', 'meeting', 'proposal', 'won'])
    await call(auto, 'update_pipeline_card', { id: card, stage: st, note: 'test' })
  const after = (await call(live, 'prepare_client_documents', { company: "Maria's Bakery", stage: 'after', cardId: card, facts })).data
  assert.equal(after.ready, true, JSON.stringify(after.missing))
  const base = (p) => p.split(/[\\/]/).pop()
  assert.deepEqual(after.files.map(base).sort(), ['care-plan.md', 'launch-checklist.md', 'privacy.html', 'service-agreement.md', 'site-privacy-policy.md', 'site-terms.md', 'terms.html'])
  const privacy = readFileSync(after.files.find((p) => p.endsWith('privacy.html')), 'utf8')
  assert.match(privacy, /<h1>Privacy Policy<\/h1>/)
  assert.match(privacy, /mariasbakery\.ca/)
  assert.doesNotMatch(privacy, /<!--/)
})

test('templates and markdown helpers', () => {
  assert.deepEqual(fillTemplate('Hi {{A}} {{B}}', { A: 'x' }), { text: 'Hi x [[MISSING: B]]', missing: ['B'] })
  const html = mdToHtml(['# T', '', 'A **b** <i> [p](privacy.html) [x](javascript:alert(1))', '', '- one'].join('\n'), 'T')
  assert.match(html, /<strong>b<\/strong> &lt;i&gt; <a href="privacy.html">p<\/a> x/)
  assert.match(html, /<li>one<\/li>/)
})

test('film lists match the renderer, and every action gets a sound', async () => {
  const films = await import('../bridge/films.mjs')
  const types = readFileSync(new URL('../films/src/types.ts', import.meta.url), 'utf8')
  const list = (name) => {
    const start = types.indexOf(`export const ${name} = [`)
    const m = start < 0 ? null : [null, types.slice(start, types.indexOf('] as const', start))]
    assert.ok(m, `${name} in types.ts`)
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  }
  for (const k of ['STYLES', 'POSES', 'EXPRESSIONS', 'SETTINGS', 'PROPS']) assert.deepEqual(films[k], list(k), k)

  const cues = films.autoSfx([
    { seconds: 3, setting: 'ocean', text: { value: 'Stranded', kind: 'title', at: 0.5 }, props: [{ kind: 'raft', x: 0.5, y: 0.7, enter: 'none' }] },
    { seconds: 4, setting: 'island', transition: 'wipe', camera: 'shake', props: [{ kind: 'crate', x: 0.7, y: 0.7, enter: 'drop', at: 1 }, { kind: 'star', x: 0.2, y: 0.2, at: 2 }] },
    { seconds: 2, setting: 'island', actors: [{ pose: 'celebrate' }], sfx: [{ sound: 'ding', at: 1 }] },
  ])
  assert.deepEqual(
    cues.map((c) => [c.sound, +c.at.toFixed(2)]),
    [['ding', 0.5], ['whoosh', 2.7], ['boom', 3], ['thud', 4.3], ['pop', 5], ['sparkle', 7], ['ding', 8]],
  )
  // The tool takes the story as data and checks it.
  const { z } = await import('zod')
  const schema = z.object(films.filmSchema)
  assert.ok(schema.safeParse({ title: 't', style: 'paper-cutout', scenes: [{ narration: 'Hi.', setting: 'island', actors: [{ pose: 'walk', x: 0.1, to: 0.5 }] }] }).success)
  assert.ok(!schema.safeParse({ title: 't', style: 'watercolour', scenes: [{ setting: 'island' }] }).success)
  assert.ok(!schema.safeParse({ title: 't', style: 'clay', scenes: [{ setting: 'moon' }] }).success)
})

test('film channels get the story brief', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'jarvis-film-'))
  const ap = createAutopilot({ workspace: ws, allowWrites: true, checkPath: () => null, publishers: {}, runAgent: async () => 'ok' })
  const live = ap.makeServer({ live: true })
  const r = await call(live, 'update_autopilot_channel', {
    id: 'stranded',
    niche: 'True survival stories',
    style: 'films',
    platforms: ['youtube', 'tiktok'],
    film: { style: 'paper-cutout', watermark: 'Stranded Tales', hero: { outfit: '#3f7cc4' }, minutes: 3 },
  })
  assert.equal(r.data.channel.film.style, 'paper-cutout')
  const prompt = ap.briefFor('stranded')
  assert.match(prompt, /make_film/)
  assert.match(prompt, /OUTLIERS/)
  assert.match(prompt, /paper-cutout/)
  assert.match(prompt, /"outfit":"#3f7cc4"/)
  assert.match(prompt, /36-48 scenes, 420-495 words/)
  assert.match(prompt, /6\. For tiktok: make a second, 9:16 cut/)
  assert.match(prompt, /7\. Queue with create_scheduled_post \(channel: "stranded"\): the 16:9 film for youtube only, with thumbnail/)
  assert.match(prompt, /8\. Finish with one line/)
  // The main channel can be a film channel too.
  const solo = createAutopilot({ workspace: mkdtempSync(join(tmpdir(), 'jarvis-solo-')), allowWrites: true, checkPath: () => null, publishers: {}, runAgent: async () => 'ok' })
  await call(solo.makeServer({ live: true }), 'update_autopilot_settings', { niche: 'History mysteries', style: 'films', platforms: ['youtube'], film: { style: 'ink-wash', watermark: 'Untold Files' } })
  const main = solo.briefFor('main')
  assert.match(main, /ink-wash/)
  assert.match(main, /Watermark: Untold Files/)
  assert.doesNotMatch(main, /9:16 cut/)
  // A short-video channel keeps the short brief.
  await call(live, 'update_autopilot_channel', { id: 'ocean', niche: 'Strange sea creatures', platforms: ['youtube'] })
  assert.match(ap.briefFor('ocean'), /render_short/)
})

test('the videos page lists finished videos only, escaped', async () => {
  const { listVideos, renderVideosPage } = await import('../bridge/videos-page.mjs')
  const ws = mkdtempSync(join(tmpdir(), 'jarvis-vid-'))
  const { mkdirSync } = await import('node:fs')
  const d = join(ws, 'studio', '20261125101500-the-island')
  mkdirSync(d, { recursive: true })
  for (const f of ['the-island.mp4', 'silent.mp4', 'scene-01.mp4', 'thumbnail.jpg']) writeFileSync(join(d, f), 'x')
  mkdirSync(join(ws, 'autopilot'), { recursive: true })
  writeFileSync(join(ws, 'autopilot', 'queue.json'), JSON.stringify([{ video: join(d, 'the-island.mp4'), title: 'Stranded <438> days', status: 'done', results: { youtube: { ok: true, url: 'https://youtu.be/x' } } }]))
  const v = await listVideos(ws)
  assert.equal(v.length, 1)
  assert.equal(v[0].status, 'posted')
  assert.ok(v[0].thumb.endsWith('thumbnail.jpg'))
  const html = renderVideosPage(v)
  assert.match(html, /Stranded &lt;438&gt; days/)
  assert.match(html, /href="https:\/\/youtu.be\/x"/)
  assert.doesNotMatch(html, /silent\.mp4/)
})

test('agency: booking link goes in the pitch and back to anyone who asks to meet', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'jarvis-book-'))
  const pipelines = createPipelines({ workspace: ws })
  let prompt = ''
  const agency = createAgency({ workspace: ws, allowWrites: true, runAgent: async (p) => ((prompt = p), 'SUMMARY: ok'), pipelines })
  const live = agency.makeServer({ live: true })
  await call(live, 'update_agency_settings', { bookingLink: 'https://cal.com/halvo/15min', meetingMinutes: 15, offer: 'Starter $900', senderName: 'Sam', businessAddress: '1 Main St' })
  await agency.runNow('test')
  assert.match(prompt, /Book a 15-minute look at your demo: https:\/\/cal\.com\/halvo\/15min/)
  assert.match(prompt, /INBOX/)
  assert.match(prompt, /move the card to "meeting"/)
  assert.match(prompt, /Opt-outs are honoured at once/)
  await call(live, 'update_agency_settings', { autoBook: false })
  await agency.runNow('test')
  assert.match(prompt, /replyDraft/)
  assert.match(prompt, /Do not send it yourself/)
})
