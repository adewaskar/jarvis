import { BACKEND } from '../config'
import * as direct from './anthropic'
import * as bridge from './bridge'
import { createBrain } from './create-brain'
import type { Panel, Blade } from '../store'
export type { AskHandlers, Message as Msg } from '../../shared/agent'
export type { ConnectionState } from './bridge'
export const usingBridge = BACKEND === 'bridge'
// Composition is the only frontend location that selects a transport.
const brain = createBrain(usingBridge ? {
  conversation: {
    ask: (prompt, _history, handlers) => bridge.ask(prompt, handlers),
    cancel: bridge.cancel, connectedLabels: bridge.bridgeServers,
  },
  hud: bridge, camera: bridge,
  connection: { warm: bridge.warmBridge, isConnected: bridge.isConnected, watchConnection: bridge.watchConnection },
} : {
  conversation: {
    ask: (prompt, history, handlers) => direct.ask([...history, { role: 'user', content: [{ type: 'text', text: prompt }] }], handlers),
    cancel: direct.cancel, connectedLabels: direct.connectedLabels,
  },
})
export const ask = brain.ask
export const cancel = brain.cancel
export const interrupt = cancel
export const connectedLabels = brain.connectedLabels
export const capabilities = brain.capabilities
export async function warm(): Promise<boolean> {
  if (!brain.connection)
    return false
  await brain.connection.warm()
  return true
}
export const isConnected = () => brain.connection?.isConnected() ?? true
export function watchConnection(fn: (state: bridge.ConnectionState) => void): boolean {
  if (!brain.connection)
    return false
  brain.connection.watchConnection(fn)
  return true
}
export function watchServers(fn: (servers: string[]) => void): boolean {
  if (!brain.hud)
    return false
  brain.hud.watchServers(fn)
  return true
}
export function watchPanels(fn: (panel: Panel) => void): boolean {
  if (!brain.hud)
    return false
  brain.hud.watchPanels(fn)
  return true
}
export function watchBlades(fn: (blade: Blade) => void): boolean {
  if (!brain.hud)
    return false
  brain.hud.watchBlades(fn)
  return true
}
export function watchUi(fn: (op: string, args: Record<string, unknown>) => void): boolean {
  if (!brain.hud)
    return false
  brain.hud.watchUi(fn)
  return true
}
export function watchCapture(fn: (req: bridge.CaptureRequest) => Promise<bridge.CaptureResult>): boolean {
  if (!brain.camera)
    return false
  brain.camera.watchCapture(fn)
  return true
}
