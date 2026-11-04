import type { ZodType } from 'zod'
import type { ContentPart } from './agent'
export type ToolEffect = 'read' | 'write' | 'ui' | 'camera' | 'unknown'
export type ToolDescriptor = {
  id: string
  namespace: string
  name: string
  effect: ToolEffect
}
export type ToolContext = {
  sessionId: string
  turnId: string
  signal: AbortSignal
}
export type ToolResult = {
  content: ContentPart[]
  isError?: boolean
}
export type ToolDefinition = ToolDescriptor & {
  description: string
  inputSchema: ZodType
  outputSchema: ZodType
  handler(input: unknown, context: ToolContext): Promise<ToolResult>
}
export interface PermissionPolicy {
  decide(tool: ToolDescriptor): {
    allowed: boolean
    reason?: string
  }
}
export interface ToolExecutor {
  execute(id: string, input: unknown, context: ToolContext): Promise<ToolResult>
}
export type ToolSet = {
  name: string
  version?: string
  instructions?: string
  alwaysLoad?: boolean
  tools: ToolDefinition[]
}
export interface ToolCatalog {
  create(context: ToolContext, emit: (event: import('./agent').AgentEffect) => void): ToolSet[]
}
