import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { createToolExecutor } from '../../tools/registry.mjs'
import { createPermissionPolicy } from '../../tools/permissions.mjs'
export function registerClaudeTools({ definitions, executor, context }) {
  return definitions.map(def => tool(def.name, def.description, def.inputSchema.shape, async (input) => executor.execute(def.id, input, context)))
}
export function registerClaudeToolSet(set, { policy = createPermissionPolicy(), context = { signal: new AbortController().signal } } = {}) {
  const executor = createToolExecutor({ definitions: set.tools, policy })
  return createSdkMcpServer({ ...set, tools: registerClaudeTools({ definitions: set.tools, executor, context }) })
}
