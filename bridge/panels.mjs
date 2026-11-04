import { probeUrl } from './page.mjs'
import { createPanelToolSet } from './tools/panels.mjs'
import { registerClaudeToolSet } from './providers/claude/register-tools.mjs'
export const displayServer = (emit, emitBlade) => registerClaudeToolSet(createPanelToolSet({ emit, emitBlade, pages: { probeUrl } }))
