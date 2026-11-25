import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { z } from 'zod'
import { hasSecret, readSecret, safe } from './secrets.mjs'
import { accountSecret, listAccounts } from './accounts.mjs'

/**
 * Facebook Pages, through the Graph API's Reels publishing.
 *
 * Connected once per Page with `npm run social:connect -- facebook` (add
 * `--account <name>` for more Pages). That saves a Page access token, which
 * does not expire while the user stays an admin of the Page and keeps the app.
 * Needs a Meta app with Facebook Login and the pages_show_list,
 * pages_read_engagement and pages_manage_posts permissions (SOCIAL.md).
 *
 * Upload: start a Reel session, send the file to rupload.facebook.com, then
 * finish with video_state PUBLISHED. Every Reel is flagged is_ai_generated,
 * because the autopilot's videos are, and Meta asks for that label.
 */

const VER = process.env.FB_GRAPH_VERSION ?? 'v24.0'
const GRAPH = `https://graph.facebook.com/${VER}`
export const FB_SCOPES = 'pages_show_list,pages_read_engagement,pages_manage_posts'

export const facebookConnected = () => hasSecret('facebook') || listAccounts('facebook').length > 0

function page() {
  const name = accountSecret('facebook')
  const p = readSecret(name)
  if (!p?.access_token || !p.page_id) throw new Error(`Facebook ${name} is not connected. The user needs to run: npm run social:connect -- facebook`)
  return p
}

async function fb(path, { method = 'GET', params = {} } = {}) {
  const { access_token } = page()
  const url = new URL(GRAPH + path)
  const body = new URLSearchParams()
  const target = method === 'GET' ? url.searchParams : body
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) target.set(k, String(v))
  target.set('access_token', access_token)
  const res = await fetch(url, { method, body: method === 'GET' ? undefined : body, signal: AbortSignal.timeout(60_000) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) throw new Error(`Facebook refused the request: ${data.error?.message ?? res.statusText}`)
  return data
}

export async function facebookPageInfo() {
  const p = page()
  return fb(`/${p.page_id}`, { params: { fields: 'id,name,followers_count,fan_count,link' } })
}

/** Upload and publish a Reel to the Page from a local file. Shared with the autopilot. */
export async function facebookPublishReel(path, { description = '', title } = {}) {
  if (!['.mp4', '.mov'].includes(extname(path).toLowerCase())) throw new Error('Facebook Reels must be MP4 or MOV.')
  const p = page()
  const size = (await stat(path)).size
  const start = await fb(`/${p.page_id}/video_reels`, { method: 'POST', params: { upload_phase: 'start' } })
  if (!start.video_id) throw new Error('Facebook did not start the upload.')
  const up = await fetch(start.upload_url ?? `https://rupload.facebook.com/video-upload/${VER}/${start.video_id}`, {
    method: 'POST',
    headers: { authorization: `OAuth ${p.access_token}`, offset: '0', file_size: String(size) },
    body: await readFile(path),
    signal: AbortSignal.timeout(10 * 60_000),
  })
  const upBody = await up.json().catch(() => ({}))
  if (!up.ok || upBody.success === false) throw new Error(`Facebook upload failed: ${upBody.debug_info?.message ?? upBody.error?.message ?? up.status}`)
  const done = await fb(`/${p.page_id}/video_reels`, {
    method: 'POST',
    params: {
      upload_phase: 'finish',
      video_id: start.video_id,
      video_state: 'PUBLISHED',
      description: description.slice(0, 2200),
      ...(title ? { title: title.slice(0, 255) } : {}),
      is_ai_generated: true,
    },
  })
  if (done.success === false) throw new Error(`Facebook did not publish the Reel: ${done.message ?? 'unknown reason'}`)
  return { video_id: start.video_id, post_id: done.post_id, url: `https://www.facebook.com/reel/${start.video_id}` }
}

/** Read-only page info for the live session; posting goes through the autopilot queue. */
export const makeFacebookServer = () =>
  createSdkMcpServer({
    name: 'jarvis_facebook',
    version: '1.0.0',
    instructions: 'The connected Facebook Page. Videos go to Facebook through create_scheduled_post with platform "facebook".',
    tools: [
      tool(
        'get_facebook_page',
        'The connected Facebook Page: name, followers, link. Pass account for a channel other than the main one.',
        { account: z.string().optional() },
        safe(async ({ account }) => {
          const { withAccount, accountKey } = await import('./accounts.mjs')
          return withAccount(accountKey(account), () => facebookPageInfo())
        }),
      ),
    ],
  })
