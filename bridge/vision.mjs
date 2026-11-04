import { createVisionToolSet } from './tools/vision.mjs'
import { registerClaudeToolSet } from './providers/claude/register-tools.mjs'
export const visionServer = (ask) => registerClaudeToolSet(createVisionToolSet({ clientCapabilities: { request: ask } }))
