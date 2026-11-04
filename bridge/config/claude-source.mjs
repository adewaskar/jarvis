import { join } from 'node:path'
export function readClaudeSource({ readFile, home }) {
  try {
    const cfg = JSON.parse(readFile(join(home, '.claude.json'), 'utf8'))
    return { servers: { ...(cfg.mcpServers ?? {}), ...(cfg.projects?.[home]?.mcpServers ?? {}) }, voiceKey: cfg.mcpServers?.elevenlabs?.env?.ELEVENLABS_API_KEY ?? null }
  }
  catch {
    return { servers: {}, voiceKey: null }
  }
}
