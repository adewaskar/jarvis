import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decideTool } from '../bridge/policy.mjs'
import { createPipelines } from '../bridge/pipelines.mjs'
import { createAutopilot } from '../bridge/autopilot.mjs'
import { accountArg, accountSecret, currentAccount, listAccounts, withAccount, withoutAccountArg } from '../bridge/accounts.mjs'
import { systemServer } from '../bridge/system.mjs'

const READS = {
  jarvis_tiktok: ['get_tiktok_profile', 'list_tiktok_videos', 'get_tiktok_creator_settings', 'check_tiktok_progress'],
  jarvis_instagram: ['get_instagram_profile', 'list_instagram_media', 'get_instagram_insights', 'list_instagram_comments'],
  jarvis_studio: ['get_media_info', 'list_studio_videos', 'show_video'],
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
  jarvis_autopilot: ['update_autopilot_settings', 'update_autopilot_channel', 'create_scheduled_post', 'delete_scheduled_post', 'update_products', 'update_brand_deal'],
  jarvis_pipelines: ['create_pipeline_card', 'update_pipeline_card', 'delete_pipeline_card'],
  jarvis_system: ['launch_app', 'launch_link', 'close_app', 'set_volume', 'lock_computer', 'sleep_computer', 'schedule_shutdown', 'cancel_shutdown'],
  jarvis_agency: ['update_agency_settings', 'launch_agency_run', 'call_owner'],
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
  assert.equal((await call(srv, 'update_autopilot_channel', { id: 'cooking', niche: 'Ten-minute dinners', platforms: ['youtube', 'facebook'] })).error, undefined)
  assert.equal((await call(srv, 'update_autopilot_channel', { id: 'space', niche: 'Space facts', platforms: ['tiktok', 'youtube'], accounts: { youtube: 'main' } })).error, undefined)
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
