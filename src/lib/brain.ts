import { BACKEND } from '../config'
import * as direct from './anthropic'
import * as bridge from './bridge'
import type { AskHandlers, Msg } from './anthropic'
import type { Blade, Panel } from '../store'

export type { AskHandlers, Msg }
export type { ConnectionState } from './bridge'

/**
 * Picks the brain. Both backends answer a question and stream text and tool
 * events back; they differ in where they run and what they can reach.
 *
 *   bridge — a local Node process running the Claude Agent SDK. Uses your
 *            existing Claude Code login, so no API key, and every MCP server
 *            you have configured is available, including local stdio ones.
 *
 *   direct — the browser calls the Claude API itself. No process to run and it
 *            deploys as a static site, but it needs an API key in the bundle
 *            and can only use remote HTTP MCP servers.
 */

export const usingBridge = BACKEND !== 'direct'
export const usingMultica = BACKEND === 'multica'

/** Conversation state lives in the bridge session, so history is only threaded
 *  through on the direct path. */
export async function ask(
  prompt: string,
  history: Msg[],
  handlers: AskHandlers,
): Promise<{ text: string; tools: string[]; responseId?: string }> {
  return usingBridge
    ? bridge.ask(prompt, handlers)
    : direct.ask([...history, { role: 'user', content: prompt }], handlers)
}

export async function warm(): Promise<void> {
  if (usingBridge) await bridge.warmBridge()
}

/** The bridge reports its server list twice — from config on connect, then
 *  with live status once the agent boots — so the HUD subscribes. */
export function watchServers(fn: (servers: string[]) => void): void {
  if (usingBridge) bridge.watchServers(fn)
}

/** HUD panels are pushed mid-turn by the `display` tool, not returned by ask(). */
export function watchPanels(fn: (panel: Panel) => void): void {
  if (usingBridge) bridge.watchPanels(fn)
}

/** Blades — the big surface — arrive the same way, from the `blade` tool. Like
 *  panels and the ui_* commands, this is a bridge capability: the direct path
 *  has no channel for a server to volunteer anything mid-turn. */
export function watchBlades(fn: (blade: Blade) => void): void {
  if (usingBridge) bridge.watchBlades(fn)
}

/**
 * Redressing the interface — theme, reactor, orbiting objects, effects — is a
 * bridge capability, like panels. The `ui_*` tools live in an in-process MCP
 * server inside the bridge and push straight down the open socket, mid-turn.
 * The direct path has no such channel: the browser talks to the Messages API
 * over one-shot HTTPS requests and gets back an answer, with nowhere for a
 * server to volunteer anything. On that backend this watcher simply never
 * fires and the interface stays exactly as it ships.
 */
export function watchUi(fn: (op: string, args: any) => void): void {
  if (usingBridge) bridge.watchUi(fn)
}

/**
 * The one thing the bridge asks US for.
 *
 * Every other channel here is the bridge volunteering something mid-turn. A
 * camera frame is the exception — the hardware is in the browser and the model
 * is in the bridge — so this handler answers a request rather than receiving a
 * push. Bridge-only for the same reason as the rest: the direct path is one-shot
 * HTTPS, with nowhere for a request to arrive.
 */
export function watchCapture(
  fn: (req: bridge.CaptureRequest) => Promise<bridge.CaptureResult>,
): void {
  if (usingBridge) bridge.watchCapture(fn)
}

/**
 * Barge-in. Stops the answer on both paths and settles whatever `ask()` call
 * is outstanding, so the caller's await always returns — on the bridge by
 * interrupting the agent and resolving with the text so far, on the direct
 * path by aborting the stream so the model stops generating and billing.
 */
export function cancel(): void {
  if (usingBridge) bridge.cancel()
  else direct.cancel()
}

/** The older name for `cancel()`. */
export function interrupt(): void {
  cancel()
}

export function acknowledgeResponse(responseId?: string): void {
  if (usingBridge) bridge.acknowledgeResponse(responseId)
}

/**
 * Whether the brain is reachable right now.
 *
 * Only meaningful on the bridge, where a live socket is the session. The direct
 * path holds no connection between turns — each one is its own HTTPS request —
 * so there is nothing that can be down until you try it.
 */
export function isConnected(): boolean {
  return usingBridge ? bridge.isConnected() : true
}

/**
 * Connection state, for the UI.
 *
 * Worth surfacing because in bridge mode the socket *is* the conversation: all
 * of JARVIS's memory of the exchange lives in the agent session behind it, so a
 * drop wipes the conversation while the transcript on screen still shows it.
 * Never fires on the direct path, which has no connection to lose.
 */
export function watchConnection(
  fn: (state: bridge.ConnectionState) => void,
): void {
  if (usingBridge) bridge.watchConnection(fn)
}

/** Labels for the HUD's SYSTEMS rail. */
export function connectedLabels(): string[] {
  return usingBridge ? bridge.bridgeServers() : direct.connectedLabels()
}
