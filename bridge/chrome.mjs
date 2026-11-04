import { createClaudeChromeClient } from './integrations/claude-chrome.mjs'
import { createChromeToolSet } from './tools/chrome.mjs'
import { registerClaudeToolSet } from './providers/claude/register-tools.mjs'
import { createPermissionPolicy } from './tools/permissions.mjs'
const client = createClaudeChromeClient()
export const chromeAvailable = async () => (await client.findSocket()) !== null
export const chromeServer = ({allowWrites}) => registerClaudeToolSet(createChromeToolSet({client,allowWrites}), {policy:createPermissionPolicy({allowWrites})})
