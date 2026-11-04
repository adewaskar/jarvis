import type { Message, AskHandlers, AskResult } from '../../shared/agent'
import type { Panel, Blade } from '../store'
import type { CaptureRequest, CaptureResult, ConnectionState } from './bridge'
export interface ConversationPort {
  ask(prompt: string, history: Message[], handlers: AskHandlers): Promise<AskResult>
  cancel(): void
  connectedLabels(): string[]
}
export interface HudPort {
  watchServers(fn: (servers: string[]) => void): void
  watchPanels(fn: (panel: Panel) => void): void
  watchBlades(fn: (blade: Blade) => void): void
  watchUi(fn: (op: string, args: Record<string, unknown>) => void): void
}
export interface CameraPort {
  watchCapture(fn: (req: CaptureRequest) => Promise<CaptureResult>): void
}
export interface ConnectionPort {
  warm(): Promise<void>
  isConnected(): boolean
  watchConnection(fn: (state: ConnectionState) => void): void
}
export function createBrain({ conversation, hud, camera, connection }: {
  conversation: ConversationPort
  hud?: HudPort
  camera?: CameraPort
  connection?: ConnectionPort
}) {
  return {
    ask: (prompt: string, history: Message[], handlers: AskHandlers) => conversation.ask(prompt, history, handlers),
    cancel: () => conversation.cancel(),
    connectedLabels: () => conversation.connectedLabels(),
    capabilities: { hud: !!hud, camera: !!camera, connection: !!connection },
    hud, camera, connection,
  }
}
