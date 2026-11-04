import { createUiToolSet } from './tools/ui.mjs'
import { registerClaudeToolSet } from './providers/claude/register-tools.mjs'
export const uiServer = (emit) => registerClaudeToolSet(createUiToolSet({ emit }))
