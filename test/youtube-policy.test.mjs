import { test } from 'node:test'
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { decideTool, pathProblem } from '../bridge/policy.mjs'

const READS = ['get_my_channel', 'list_my_videos', 'get_video', 'search_youtube', 'list_comments', 'get_analytics', 'list_my_playlists']
const WRITES = ['update_video', 'post_comment_reply', 'upload_video', 'update_thumbnail', 'create_playlist', 'create_playlist_item']

test('youtube reads run in read-only mode', () => {
  for (const t of READS) assert.equal(decideTool(`mcp__jarvis_youtube__${t}`, false), true, t)
})

test('youtube writes need --writes', () => {
  for (const t of WRITES) {
    assert.equal(decideTool(`mcp__jarvis_youtube__${t}`, false), false, t)
    assert.equal(decideTool(`mcp__jarvis_youtube__${t}`, true), true, t)
  }
})

test('the youtube token is refused even when home is an allowed root', () => {
  const token = join(homedir(), '.jarvis', 'secrets', 'youtube.json')
  assert.match(pathProblem(token, { cwd: homedir(), roots: [homedir()] }) ?? '', /credentials/)
})
