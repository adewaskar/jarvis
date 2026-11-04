import type { ToolCatalog, ToolExecutor, PermissionPolicy } from './tools'
import type { ClientCapabilities } from './client'
export type ContentPart = {
  type: 'text'
  text: string
} | {
  type: 'image'
  mimeType: string
  data: string
} | {
  type: 'image'
  mimeType: string
  url: string
}
export type Message = {
  role: 'user' | 'assistant'
  content: ContentPart[]
}
export type TurnInput = {
  sessionId: string
  turnId: string
  message: Message
}
export type AgentCapabilities = {
  tools?: boolean
  camera?: boolean
  ui?: boolean
}
export type AgentEffect = {
  type: 'panel'
  panel: unknown
} | {
  type: 'blade'
  blade: unknown
} | {
  type: 'ui'
  op: string
  args: Record<string, unknown>
}
export type AgentEvent = {
  sessionId: string
  turnId: string
} & (AgentEffect | {
  type: 'text'
  delta: string
} | {
  type: 'tool'
  name: string
} | {
  type: 'terminal'
  status: 'completed' | 'failed' | 'interrupted'
  text?: string
  message?: string
  costUsd?: number | null
})
export type SessionOptions = {
  persona?: string
  tools: ToolCatalog
  integrations: Record<string, unknown>
  capabilities?: AgentCapabilities
  clientCapabilities?: ClientCapabilities
  executor?: ToolExecutor
  policy?: PermissionPolicy
  onReady?: (servers: string[]) => void
}
export interface AgentSession {
  capabilities: AgentCapabilities
  run(input: TurnInput, signal: AbortSignal): AsyncIterable<AgentEvent>
  interrupt(turnId: string): Promise<void>
  close(): Promise<void>
}
export interface AgentProvider {
  openSession(options: SessionOptions): Promise<AgentSession>
}
export type AskHandlers = {
  onText(delta: string): void
  onTool(name: string): void
}
export type AskResult = {
  text: string
  tools: string[]
}
