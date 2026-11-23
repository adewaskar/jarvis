import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { z } from 'zod'
import { hasSecret, readSecret, safe, saveSecret } from './secrets.mjs'

/**
 * Instagram, through the official Instagram API with Instagram Login.
 *
 * Needs a Professional (Business or Creator) Instagram account — free to
 * switch in the app. Connected once with `npm run social:connect -- instagram`.
 * Reels are uploaded straight from disk with Meta's resumable upload, so no
 * public video URL is needed.
 */

const VER = process.env.IG_GRAPH_VERSION ?? 'v24.0'
const GRAPH = `https://graph.instagram.com/${VER}`
export const IG_SCOPES =
  'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments,instagram_business_manage_insights'

export const instagramConnected = () => hasSecret('instagram')

/** Long-lived tokens last 60 days; refresh when under a week is left. */
async function token() {
  const t = readSecret('instagram')
  if (!t?.access_token) throw new Error('Instagram is not connected. The user needs to run: npm run social:connect -- instagram')
  if (Date.now() > t.expires_at) {
    throw new Error('Instagram sign-in expired. Run: npm run social:connect -- instagram')
  }
  if (t.expires_at - Date.now() < 7 * 86_400_000) {
    const r = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(t.access_token)}`)
    const b = await r.json().catch(() => ({}))
    if (r.ok && b.access_token) {
      saveSecret('instagram', { ...t, access_token: b.access_token, expires_at: Date.now() + b.expires_in * 1000 })
      return b.access_token
    }
  }
  return t.access_token
}

async function ig(path, { method = 'GET', params = {} } = {}) {
  const url = new URL(GRAPH + path)
  const body = new URLSearchParams()
  const target = method === 'GET' ? url.searchParams : body
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) target.set(k, String(v))
  target.set('access_token', await token())
  const res = await fetch(url, { method, body: method === 'GET' ? undefined : body })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) {
    throw new Error(`Instagram refused the request: ${data.error?.message ?? res.statusText}`)
  }
  return data
}

const igUserId = () => readSecret('instagram')?.user_id ?? 'me'

export async function instagramProfile() {
  return ig('/me', {
    params: { fields: 'user_id,username,name,account_type,biography,profile_picture_url,followers_count,follows_count,media_count' },
  })
}

/** Upload and publish a Reel from a local file. Shared with the autopilot. */
export async function instagramPublishReel(path, { caption = '', shareToFeed = true, coverAtMs } = {}) {
  if (!['.mp4', '.mov'].includes(extname(path).toLowerCase())) throw new Error('Instagram Reels must be MP4 or MOV.')
  const size = (await stat(path)).size
  const user = igUserId()
  const container = await ig(`/${user}/media`, {
    method: 'POST',
    params: {
      media_type: 'REELS',
      upload_type: 'resumable',
      caption: caption.slice(0, 2200),
      share_to_feed: shareToFeed,
      ...(coverAtMs !== undefined ? { thumb_offset: coverAtMs } : {}),
    },
  })
  const up = await fetch(`https://rupload.facebook.com/ig-api-upload/${VER}/${container.id}`, {
    method: 'POST',
    headers: { authorization: `OAuth ${await token()}`, offset: '0', file_size: String(size) },
    body: await readFile(path),
  })
  const upBody = await up.json().catch(() => ({}))
  if (!up.ok || upBody.success === false) throw new Error(`Instagram upload failed: ${upBody.debug_info?.message ?? up.status}`)

  // Instagram transcodes before it will publish. Usually under a minute.
  for (let i = 0; i < 60; i++) {
    const s = await ig(`/${container.id}`, { params: { fields: 'status_code,status' } })
    if (s.status_code === 'FINISHED') break
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`Instagram could not process the video: ${s.status}`)
    await new Promise((r) => setTimeout(r, 5000))
    if (i === 59) throw new Error('Instagram is still processing the video after five minutes; try publishing again later.')
  }
  const pub = await ig(`/${user}/media_publish`, { method: 'POST', params: { creation_id: container.id } })
  const media = await ig(`/${pub.id}`, { params: { fields: 'permalink' } }).catch(() => ({}))
  return { published: pub.id, url: media.permalink }
}

export function instagramServer({ allowWrites, checkPath }) {
  const reads = [
    tool('get_instagram_profile', "The user's Instagram account: username, followers, following, posts, bio.", {}, safe(instagramProfile)),
    tool(
      'list_instagram_media',
      "The user's recent Instagram posts and Reels with likes, comments and links.",
      { max: z.number().int().min(1).max(50).optional().catch(undefined) },
      safe(async ({ max = 12 }) => {
        const r = await ig('/me/media', {
          params: { fields: 'id,caption,media_type,media_product_type,permalink,thumbnail_url,timestamp,like_count,comments_count', limit: max },
        })
        return r.data
      }),
    ),
    tool(
      'get_instagram_insights',
      `Performance numbers. With mediaId: views, reach, likes, comments, shares and saves for one post.
Without: account reach, views and follower changes over the last N days.`,
      { mediaId: z.string().optional().catch(undefined), days: z.number().int().min(1).max(30).optional().catch(undefined) },
      safe(async ({ mediaId, days = 7 }) => {
        if (mediaId) {
          return (await ig(`/${mediaId}/insights`, { params: { metric: 'views,reach,likes,comments,shares,saved,total_interactions' } })).data
        }
        const until = Math.floor(Date.now() / 1000)
        return (
          await ig(`/${igUserId()}/insights`, {
            params: { metric: 'reach,views,follows_and_unfollows,accounts_engaged,total_interactions', period: 'day', metric_type: 'total_value', since: until - days * 86400, until },
          })
        ).data
      }),
    ),
    tool(
      'list_instagram_comments',
      'Comments on one of the user\'s Instagram posts.',
      { mediaId: z.string() },
      safe(async ({ mediaId }) => (await ig(`/${mediaId}/comments`, { params: { fields: 'id,text,username,timestamp,like_count' } })).data),
    ),
  ]
  const writes = [
    tool(
      'upload_instagram_reel',
      `Publish a local video as an Instagram Reel (9:16, 3 s to 15 min, MP4/MOV). The file must be
inside the allowed folders. Caption includes hashtags (max 30). Goes public immediately.`,
      {
        path: z.string(),
        caption: z.string().max(2200),
        shareToFeed: z.boolean().optional(),
        coverAtMs: z.number().int().min(0).optional().describe('Frame to use as the cover, in milliseconds'),
      },
      safe(async ({ path, ...rest }) => {
        const problem = checkPath(path)
        if (problem) throw new Error(problem)
        return instagramPublishReel(path, rest)
      }),
    ),
    tool(
      'post_instagram_comment_reply',
      'Reply to a comment on the user\'s Instagram post, as the user.',
      { commentId: z.string(), message: z.string().min(1).max(2200) },
      safe(({ commentId, message }) => ig(`/${commentId}/replies`, { method: 'POST', params: { message } })),
    ),
  ]
  return createSdkMcpServer({
    name: 'jarvis_instagram',
    version: '1.0.0',
    instructions: "The user's own Instagram professional account, signed in." + (allowWrites ? ' Can publish Reels and reply to comments.' : ' Read-only in this mode.'),
    alwaysLoad: true,
    tools: allowWrites ? [...reads, ...writes] : reads,
  })
}
