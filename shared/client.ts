import type { ToolContext } from './tools'
export type ClientReply = {
  id: string
  data?: string
  mimeType?: string
  error?: string
}
export interface ClientCapabilities {
  available: Readonly<Record<string, boolean>>
  request(kind: string, payload: Record<string, unknown>, context: ToolContext): Promise<ClientReply>
}
