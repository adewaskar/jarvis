import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { z } from 'zod'
import { accessToken } from './youtube-auth.mjs'

/**
 * JARVIS's hands on the user's own YouTube channel.
 *
 * Talks straight to the YouTube Data API v3 and the YouTube Analytics API with
 * the OAuth token `npm run youtube:connect` saved. No extra dependency: fetch.
 *
 * Tool names follow the policy's verb rules on purpose (policy.mjs): reads
 * begin with get/list/search and run in any mode; anything that changes the
 * channel carries update/create/upload/post/delete, so the veto withholds it
 * until the bridge runs with --writes. On top of that, the acting tools are not
 * even built unless writes are on — same pattern as chromeServer().
 */

const API = 'https://www.googleapis.com/youtube/v3'
const ANALYTICS = 'https://youtubeanalytics.googleapis.com/v2/reports'

const ok = (data) => ({
  content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data) }],
})
const fail = (err) => ({
  isError: true,
  content: [{ type: 'text', text: String(err?.message ?? err) }],
})

/** One API call with the user's token. Throws a sentence the model can repeat. */
async function yt(path, { method = 'GET', query = {}, body, base = API } = {}) {
  const url = new URL(base + path)
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${await accessToken()}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return {}
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const reason = data?.error?.errors?.[0]?.reason ?? data?.error?.status ?? res.status
    const msg = data?.error?.message ?? res.statusText
    throw new Error(`YouTube refused the request (${reason}): ${msg}`)
  }
  return data
}

const isoDay = (d) => d.toISOString().slice(0, 10)

/** Trim a video resource to what is worth putting in front of the model. */
const slimVideo = (v) => ({
  id: v.id?.videoId ?? v.contentDetails?.videoId ?? v.id,
  title: v.snippet?.title,
  published: v.snippet?.publishedAt,
  channel: v.snippet?.channelTitle,
  privacy: v.status?.privacyStatus,
  duration: v.contentDetails?.duration,
  views: v.statistics?.viewCount,
  likes: v.statistics?.likeCount,
  comments: v.statistics?.commentCount,
  thumbnail: v.snippet?.thumbnails?.high?.url ?? v.snippet?.thumbnails?.default?.url,
  url: `https://www.youtube.com/watch?v=${v.id?.videoId ?? v.contentDetails?.videoId ?? v.id}`,
})

async function myChannel() {
  const data = await yt('/channels', {
    query: { part: 'snippet,statistics,contentDetails,brandingSettings', mine: true },
  })
  const ch = data.items?.[0]
  if (!ch) throw new Error('This Google account has no YouTube channel yet.')
  return ch
}

async function videoDetails(ids) {
  if (!ids.length) return []
  const data = await yt('/videos', {
    query: { part: 'snippet,statistics,status,contentDetails', id: ids.join(',') },
  })
  return (data.items ?? []).map(slimVideo)
}

const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.avi', '.wmv', '.flv', '.webm', '.mkv', '.3gp', '.mpeg', '.mpg'])
const IMAGE_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' }

/**
 * @param {{ allowWrites: boolean, checkPath: (p: string) => string | null }} opts
 *   checkPath returns why a local file may not be used, or null — the same
 *   confinement the agent's own file tools get, so an upload cannot be talked
 *   into reading something outside the workspace.
 */
export function youtubeServer({ allowWrites, checkPath }) {
  const reads = [
    tool(
      'get_my_channel',
      'The user\'s own YouTube channel: name, handle, subscribers, total views, video count, description.',
      {},
      async () => {
        try {
          const ch = await myChannel()
          return ok({
            id: ch.id,
            title: ch.snippet?.title,
            handle: ch.snippet?.customUrl,
            description: ch.snippet?.description,
            subscribers: ch.statistics?.subscriberCount,
            views: ch.statistics?.viewCount,
            videos: ch.statistics?.videoCount,
            created: ch.snippet?.publishedAt,
            keywords: ch.brandingSettings?.channel?.keywords,
            avatar: ch.snippet?.thumbnails?.high?.url,
          })
        } catch (e) {
          return fail(e)
        }
      },
    ),

    tool(
      'list_my_videos',
      'The user\'s most recent uploads, newest first, with views, likes, comments and privacy status.',
      { max: z.number().int().min(1).max(50).optional().catch(undefined) },
      async ({ max = 10 }) => {
        try {
          const ch = await myChannel()
          const uploads = ch.contentDetails?.relatedPlaylists?.uploads
          const list = await yt('/playlistItems', {
            query: { part: 'contentDetails', playlistId: uploads, maxResults: max },
          })
          const ids = (list.items ?? []).map((i) => i.contentDetails.videoId)
          return ok(await videoDetails(ids))
        } catch (e) {
          return fail(e)
        }
      },
    ),

    tool(
      'get_video',
      'Full details of one or more videos by id: title, description, tags, stats, privacy.',
      { ids: z.array(z.string()).min(1).max(50) },
      async ({ ids }) => {
        try {
          const data = await yt('/videos', {
            query: { part: 'snippet,statistics,status,contentDetails', id: ids.join(',') },
          })
          return ok(
            (data.items ?? []).map((v) => ({
              ...slimVideo(v),
              description: v.snippet?.description,
              tags: v.snippet?.tags,
              categoryId: v.snippet?.categoryId,
            })),
          )
        } catch (e) {
          return fail(e)
        }
      },
    ),

    tool(
      'search_youtube',
      'Search all of YouTube for videos or channels — research, competitors, trends.',
      {
        q: z.string(),
        type: z.enum(['video', 'channel', 'playlist']).optional().catch(undefined),
        order: z.enum(['relevance', 'date', 'viewCount', 'rating']).optional().catch(undefined),
        max: z.number().int().min(1).max(25).optional().catch(undefined),
      },
      async ({ q, type = 'video', order = 'relevance', max = 8 }) => {
        try {
          const data = await yt('/search', {
            query: { part: 'snippet', q, type, order, maxResults: max },
          })
          if (type !== 'video') {
            return ok(
              (data.items ?? []).map((i) => ({
                id: i.id.channelId ?? i.id.playlistId,
                title: i.snippet.title,
                description: i.snippet.description,
              })),
            )
          }
          return ok(await videoDetails((data.items ?? []).map((i) => i.id.videoId)))
        } catch (e) {
          return fail(e)
        }
      },
    ),

    tool(
      'list_comments',
      'Recent comment threads — on one video if videoId is given, otherwise across the whole channel.',
      {
        videoId: z.string().optional().catch(undefined),
        max: z.number().int().min(1).max(50).optional().catch(undefined),
      },
      async ({ videoId, max = 20 }) => {
        try {
          const query = { part: 'snippet', maxResults: max, order: 'time', textFormat: 'plainText' }
          if (videoId) query.videoId = videoId
          else query.allThreadsRelatedToChannelId = (await myChannel()).id
          const data = await yt('/commentThreads', { query })
          return ok(
            (data.items ?? []).map((t) => {
              const c = t.snippet.topLevelComment.snippet
              return {
                threadId: t.id,
                commentId: t.snippet.topLevelComment.id,
                videoId: t.snippet.videoId,
                author: c.authorDisplayName,
                text: c.textDisplay,
                likes: c.likeCount,
                replies: t.snippet.totalReplyCount,
                at: c.publishedAt,
              }
            }),
          )
        } catch (e) {
          return fail(e)
        }
      },
    ),

    tool(
      'get_analytics',
      `Channel (or single-video) analytics over the last N days from YouTube Analytics:
views, watch time, average view duration, subscribers gained and lost, likes.
Set by="day" for a daily series, by="video" for the top videos in the window.`,
      {
        days: z.number().int().min(1).max(365).optional().catch(undefined),
        videoId: z.string().optional().catch(undefined),
        by: z.enum(['total', 'day', 'video']).optional().catch(undefined),
      },
      async ({ days = 28, videoId, by = 'total' }) => {
        try {
          const end = new Date()
          const start = new Date(Date.now() - days * 86_400_000)
          const query = {
            ids: 'channel==MINE',
            startDate: isoDay(start),
            endDate: isoDay(end),
            metrics:
              'views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost,likes,comments',
          }
          if (videoId) query.filters = `video==${videoId}`
          if (by === 'day') query.dimensions = 'day'
          if (by === 'video') {
            query.dimensions = 'video'
            query.sort = '-views'
            query.maxResults = 10
          }
          const data = await yt('', { base: ANALYTICS, query })
          const cols = (data.columnHeaders ?? []).map((h) => h.name)
          const rows = (data.rows ?? []).map((r) => Object.fromEntries(r.map((v, i) => [cols[i], v])))
          return ok({ from: query.startDate, to: query.endDate, rows })
        } catch (e) {
          return fail(e)
        }
      },
    ),

    tool(
      'list_my_playlists',
      'The user\'s playlists with item counts.',
      {},
      async () => {
        try {
          const data = await yt('/playlists', {
            query: { part: 'snippet,contentDetails,status', mine: true, maxResults: 50 },
          })
          return ok(
            (data.items ?? []).map((p) => ({
              id: p.id,
              title: p.snippet.title,
              items: p.contentDetails.itemCount,
              privacy: p.status.privacyStatus,
            })),
          )
        } catch (e) {
          return fail(e)
        }
      },
    ),
  ]

  const writes = [
    tool(
      'update_video',
      `Change a video's title, description, tags, category or privacy (public, unlisted, private).
Only the fields given change; the rest are kept.`,
      {
        videoId: z.string(),
        title: z.string().max(100).optional(),
        description: z.string().max(5000).optional(),
        tags: z.array(z.string()).optional(),
        categoryId: z.string().optional(),
        privacy: z.enum(['public', 'unlisted', 'private']).optional(),
      },
      async ({ videoId, title, description, tags, categoryId, privacy }) => {
        try {
          const cur = (
            await yt('/videos', { query: { part: 'snippet,status', id: videoId } })
          ).items?.[0]
          if (!cur) throw new Error('No video with that id on this channel.')
          const snippet = {
            title: title ?? cur.snippet.title,
            description: description ?? cur.snippet.description,
            tags: tags ?? cur.snippet.tags,
            categoryId: categoryId ?? cur.snippet.categoryId,
          }
          const status = { ...cur.status, ...(privacy ? { privacyStatus: privacy } : {}) }
          const out = await yt('/videos', {
            method: 'PUT',
            query: { part: 'snippet,status' },
            body: { id: videoId, snippet, status },
          })
          return ok({ updated: out.id, title: out.snippet?.title, privacy: out.status?.privacyStatus })
        } catch (e) {
          return fail(e)
        }
      },
    ),

    tool(
      'post_comment_reply',
      'Reply to a comment on the user\'s channel, as the channel. commentId is the top-level comment id from list_comments.',
      { commentId: z.string(), text: z.string().min(1).max(10000) },
      async ({ commentId, text }) => {
        try {
          const out = await yt('/comments', {
            method: 'POST',
            query: { part: 'snippet' },
            body: { snippet: { parentId: commentId, textOriginal: text } },
          })
          return ok({ replied: out.id })
        } catch (e) {
          return fail(e)
        }
      },
    ),

    tool(
      'upload_video',
      `Upload a local video file to the user's channel. The file must be inside
JARVIS's workspace or an allowed folder. Defaults to PRIVATE so the user can
review it before it goes public — only choose public if they said so.`,
      {
        path: z.string(),
        title: z.string().max(100),
        description: z.string().max(5000).optional(),
        tags: z.array(z.string()).optional(),
        categoryId: z.string().optional().describe('22 People & Blogs, 20 Gaming, 24 Entertainment, 27 Education, 28 Science & Tech'),
        privacy: z.enum(['public', 'unlisted', 'private']).optional(),
        madeForKids: z.boolean().optional(),
      },
      async ({ path, title, description = '', tags, categoryId = '22', privacy = 'private', madeForKids = false }) => {
        try {
          const problem = checkPath(path)
          if (problem) throw new Error(problem)
          if (!VIDEO_EXT.has(extname(path).toLowerCase())) throw new Error(`${basename(path)} is not a video file.`)
          const size = (await stat(path)).size
          const init = await fetch(
            'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
            {
              method: 'POST',
              headers: {
                authorization: `Bearer ${await accessToken()}`,
                'content-type': 'application/json; charset=UTF-8',
                'x-upload-content-length': String(size),
                'x-upload-content-type': 'video/*',
              },
              body: JSON.stringify({
                snippet: { title, description, tags, categoryId },
                status: { privacyStatus: privacy, selfDeclaredMadeForKids: madeForKids },
              }),
            },
          )
          if (!init.ok) {
            const e = await init.json().catch(() => ({}))
            throw new Error(`YouTube refused the upload: ${e?.error?.message ?? init.status}`)
          }
          const where = init.headers.get('location')
          const put = await fetch(where, {
            method: 'PUT',
            headers: { 'content-type': 'video/*', 'content-length': String(size) },
            body: await readFile(path),
          })
          const out = await put.json().catch(() => ({}))
          if (!put.ok) throw new Error(`Upload failed: ${out?.error?.message ?? put.status}`)
          return ok({
            uploaded: out.id,
            privacy: out.status?.privacyStatus,
            url: `https://www.youtube.com/watch?v=${out.id}`,
            studio: `https://studio.youtube.com/video/${out.id}/edit`,
          })
        } catch (e) {
          return fail(e)
        }
      },
    ),

    tool(
      'update_thumbnail',
      'Set a custom thumbnail (JPG or PNG under 2 MB, 1280x720 ideal) from a local file inside the allowed folders. The channel must be verified for custom thumbnails.',
      { videoId: z.string(), path: z.string() },
      async ({ videoId, path }) => {
        try {
          const problem = checkPath(path)
          if (problem) throw new Error(problem)
          const mime = IMAGE_MIME[extname(path).toLowerCase()]
          if (!mime) throw new Error('Thumbnails must be JPG or PNG.')
          const res = await fetch(
            `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`,
            {
              method: 'POST',
              headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': mime },
              body: await readFile(path),
            },
          )
          const out = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(`YouTube refused the thumbnail: ${out?.error?.message ?? res.status}`)
          return ok({ thumbnail: 'set', videoId })
        } catch (e) {
          return fail(e)
        }
      },
    ),

    tool(
      'create_playlist',
      'Create a new playlist on the user\'s channel.',
      {
        title: z.string().max(150),
        description: z.string().max(5000).optional(),
        privacy: z.enum(['public', 'unlisted', 'private']).optional(),
      },
      async ({ title, description = '', privacy = 'public' }) => {
        try {
          const out = await yt('/playlists', {
            method: 'POST',
            query: { part: 'snippet,status' },
            body: { snippet: { title, description }, status: { privacyStatus: privacy } },
          })
          return ok({ playlist: out.id, title: out.snippet?.title })
        } catch (e) {
          return fail(e)
        }
      },
    ),

    tool(
      'create_playlist_item',
      'Add a video to one of the user\'s playlists.',
      { playlistId: z.string(), videoId: z.string() },
      async ({ playlistId, videoId }) => {
        try {
          const out = await yt('/playlistItems', {
            method: 'POST',
            query: { part: 'snippet' },
            body: { snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } } },
          })
          return ok({ added: out.id })
        } catch (e) {
          return fail(e)
        }
      },
    ),
  ]

  return createSdkMcpServer({
    name: 'jarvis_youtube',
    version: '1.0.0',
    instructions:
      "The user's own YouTube channel, signed in. Stats, uploads, comments, analytics, " +
      'search' +
      (allowWrites ? ', and editing, replying, uploading and playlists.' : '. Read-only in this mode.'),
    alwaysLoad: true,
    tools: allowWrites ? [...reads, ...writes] : reads,
  })
}
