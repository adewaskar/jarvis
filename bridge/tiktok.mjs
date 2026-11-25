import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { open, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { z } from 'zod'
import { hasSecret, readSecret, safe, saveSecret } from './secrets.mjs'
import { accountSecret, listAccounts } from './accounts.mjs'

/**
 * TikTok, through the official Content Posting API and Display API.
 *
 * Connected once with `npm run social:connect -- tiktok`. Until TikTok has
 * audited the developer app, everything posted through the API is forced to
 * SELF_ONLY (private) by TikTok itself — that is their rule, not ours, and the
 * tools say so instead of failing mysteriously.
 */

const API = 'https://open.tiktokapis.com/v2'
export const TIKTOK_SCOPES = 'user.info.basic,user.info.profile,user.info.stats,video.list,video.publish,video.upload'

export const tiktokConnected = () => hasSecret('tiktok') || listAccounts('tiktok').length > 0

/** One refresh in flight per account. */
const refreshing = new Map()
async function token() {
  const name = accountSecret('tiktok')
  const t = readSecret(name)
  if (!t?.refresh_token) throw new Error(`TikTok ${name} is not connected. The user needs to run: npm run social:connect -- tiktok`)
  if (t.access_token && Date.now() < t.expires_at - 60_000) return t.access_token
  if (refreshing.has(name)) return refreshing.get(name)
  const p = (async () => {
    const res = await fetch(`${API}/oauth/token/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: t.client_key,
        client_secret: t.client_secret,
        grant_type: 'refresh_token',
        refresh_token: t.refresh_token,
      }),
    })
    const b = await res.json().catch(() => ({}))
    if (!res.ok || !b.access_token) {
      throw new Error(`TikTok sign-in expired (${b.error ?? res.status}). Run: npm run social:connect -- tiktok`)
    }
    saveSecret(name, {
      ...t,
      access_token: b.access_token,
      refresh_token: b.refresh_token ?? t.refresh_token,
      expires_at: Date.now() + b.expires_in * 1000,
    })
    return b.access_token
  })().finally(() => refreshing.delete(name))
  refreshing.set(name, p)
  return p
}

async function tt(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      authorization: `Bearer ${await token()}`,
      ...(body ? { 'content-type': 'application/json; charset=UTF-8' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || (data.error?.code && data.error.code !== 'ok')) {
    throw new Error(`TikTok refused the request (${data.error?.code ?? res.status}): ${data.error?.message ?? res.statusText}`)
  }
  return data.data ?? data
}

export async function tiktokProfile() {
  const f = 'open_id,username,display_name,avatar_url,bio_description,profile_deep_link,follower_count,following_count,likes_count,video_count'
  return (await tt(`/user/info/?fields=${f}`)).user
}

export async function tiktokPostOptions() {
  return tt('/post/publish/creator_info/query/', { method: 'POST', body: {} })
}

/**
 * Post a local video. Shared with the autopilot, which is why it lives outside
 * the tool. Chunks per TikTok's rules: 5–64 MB chunks, one chunk under 64 MB.
 */
export async function tiktokPublish(path, { caption = '', privacy, disableComment = false, disableDuet = false, disableStitch = false, brandContent = false, brandOrganic = false } = {}) {
  if (extname(path).toLowerCase() !== '.mp4' && extname(path).toLowerCase() !== '.mov' && extname(path).toLowerCase() !== '.webm') {
    throw new Error('TikTok takes MP4, MOV or WebM videos.')
  }
  const size = (await stat(path)).size
  const opts = await tiktokPostOptions()
  const allowed = opts.privacy_level_options ?? ['SELF_ONLY']
  const level = privacy && allowed.includes(privacy) ? privacy : allowed.includes('PUBLIC_TO_EVERYONE') && privacy !== 'SELF_ONLY' ? 'PUBLIC_TO_EVERYONE' : allowed[0]

  const CHUNK = 10 * 1024 * 1024
  const single = size <= 64 * 1024 * 1024
  const chunkSize = single ? size : CHUNK
  const count = single ? 1 : Math.floor(size / CHUNK)

  const init = await tt('/post/publish/video/init/', {
    method: 'POST',
    body: {
      post_info: {
        title: caption.slice(0, 2200),
        privacy_level: level,
        disable_comment: disableComment,
        disable_duet: disableDuet,
        disable_stitch: disableStitch,
        brand_content_toggle: brandContent,
        brand_organic_toggle: brandOrganic,
      },
      source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: count },
    },
  })

  const fh = await open(path, 'r')
  try {
    for (let i = 0; i < count; i++) {
      const start = i * chunkSize
      const end = i === count - 1 ? size - 1 : start + chunkSize - 1
      const buf = Buffer.alloc(end - start + 1)
      await fh.read(buf, 0, buf.length, start)
      const put = await fetch(init.upload_url, {
        method: 'PUT',
        headers: {
          'content-type': 'video/mp4',
          'content-length': String(buf.length),
          'content-range': `bytes ${start}-${end}/${size}`,
        },
        body: buf,
      })
      if (!put.ok && put.status !== 206) throw new Error(`TikTok upload failed at chunk ${i + 1}/${count} (${put.status}).`)
    }
  } finally {
    await fh.close()
  }
  return {
    publish_id: init.publish_id,
    privacy: level,
    note: level === 'SELF_ONLY' && !allowed.includes('PUBLIC_TO_EVERYONE')
      ? 'Posted as private: TikTok only allows public API posts after the developer app passes its audit.'
      : undefined,
  }
}

export function tiktokServer({ allowWrites, checkPath }) {
  const reads = [
    tool('get_tiktok_profile', 'The user\'s TikTok account: name, followers, likes, video count, bio.', {}, safe(tiktokProfile)),
    tool(
      'list_tiktok_videos',
      'The user\'s recent TikTok videos with views, likes, comments and shares.',
      { max: z.number().int().min(1).max(20).optional().catch(undefined) },
      safe(async ({ max = 10 }) => {
        const f = 'id,title,video_description,create_time,cover_image_url,share_url,view_count,like_count,comment_count,share_count,duration'
        return (await tt(`/video/list/?fields=${f}`, { method: 'POST', body: { max_count: max } })).videos
      }),
    ),
    tool(
      'get_tiktok_creator_settings',
      'Which privacy levels and settings this TikTok account can post with right now, and the max video length.',
      {},
      safe(tiktokPostOptions),
    ),
    tool(
      'check_tiktok_progress',
      'Status of a TikTok upload by publish_id: processing, published or failed.',
      { publish_id: z.string() },
      safe(({ publish_id }) => tt('/post/publish/status/fetch/', { method: 'POST', body: { publish_id } })),
    ),
  ]
  const writes = [
    tool(
      'upload_tiktok_video',
      `Post a local video to the user's TikTok. The file must be inside the allowed folders.
Caption includes hashtags. Mark brandContent when it is a paid partnership and
brandOrganic when promoting the user's own business — TikTok requires the disclosure.`,
      {
        path: z.string(),
        caption: z.string().max(2200),
        privacy: z.enum(['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY']).optional(),
        disableComment: z.boolean().optional(),
        brandContent: z.boolean().optional(),
        brandOrganic: z.boolean().optional(),
      },
      safe(async ({ path, ...rest }) => {
        const problem = checkPath(path)
        if (problem) throw new Error(problem)
        return tiktokPublish(path, rest)
      }),
    ),
  ]
  return createSdkMcpServer({
    name: 'jarvis_tiktok',
    version: '1.0.0',
    instructions: "The user's own TikTok account, signed in." + (allowWrites ? ' Can post videos.' : ' Read-only in this mode.'),
    alwaysLoad: true,
    tools: allowWrites ? [...reads, ...writes] : reads,
  })
}
