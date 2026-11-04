import Anthropic from '@anthropic-ai/sdk'
import { env, MODEL, FAST_MODE, SYSTEM_PROMPT, activeServers } from '../config'
import { createDirectAgent } from './providers/anthropic-direct'
export type { Message as Msg, AskHandlers } from '../../shared/agent'
const agent = createDirectAgent({
  client: new Anthropic({ apiKey: env.anthropicKey, dangerouslyAllowBrowser: true }),
  model: MODEL, fastMode: FAST_MODE, systemPrompt: SYSTEM_PROMPT, servers: activeServers,
})
export const ask = agent.ask
export const cancel = agent.cancel
export const connectedLabels = () => activeServers().map(server => server.label)
