/**
 * Bridge-side LLM Provider Abstraction
 * 
 * Allows JARVIS to use different LLM backends while keeping the same
 * tool-calling, streaming, and MCP integration interface.
 * 
 * Providers:
 * - FreeLLMAPI (OpenAI-compatible, default, primary)
 * - Anthropic (direct, via SDK)
 * - OpenAI (direct, via SDK)  
 * - Local (Ollama/vLLM, OpenAI-compatible)
 */

import { EventEmitter } from 'node:events'

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type ProviderType = 'freellm' | 'anthropic' | 'openai' | 'local'

export interface ProviderConfig {
  type: ProviderType
  baseUrl?: string
  apiKey?: string
  model: string
  // Optional overrides per provider
  maxTokens?: number
  temperature?: number
  reasoningEffort?: 'low' | 'medium' | 'high'
}

export interface BridgeProviderConfig {
  defaultProvider: ProviderType
  providers: Record<ProviderType, ProviderConfig>
  decisionRouterEnabled: boolean
  routerProvider?: ProviderType
  // Fallback chain when primary fails
  fallbackChain: ProviderType[]
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | LLMContentBlock[]
  tool_call_id?: string
  tool_calls?: LLMToolCall[]
}

export interface LLMContentBlock {
  type: 'text' | 'image_url' | 'tool_use' | 'tool_result'
  text?: string
  image_url?: { url: string }
  id?: string
  name?: string
  input?: any
  output?: string
}

export interface LLMToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface LLMTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: any
  }
}

export interface LLMStreamEvent {
  type: 'text_delta' | 'tool_use' | 'tool_result' | 'end' | 'error'
  delta?: string
  toolCall?: LLMToolCall
  toolResult?: { tool_use_id: string; output: string; is_error: boolean }
  finishReason?: 'stop' | 'tool_calls' | 'max_tokens' | 'error'
  error?: string
}

export interface LLMProvider {
  // Initialize provider (load models, connect, etc.)
  initialize(): Promise<void>
  // Check if provider is available
  isAvailable(): boolean
  // Get provider type
  getType(): ProviderType
  // Stream completion
  streamCompletion(
    messages: LLMMessage[],
    tools: LLMTool[],
    systemPrompt: string,
    options: { maxTokens?: number; temperature?: number; reasoningEffort?: string }
  ): AsyncGenerator<LLMStreamEvent, void, unknown>
  // Non-streaming completion (for simple calls)
  complete(
    messages: LLMMessage[],
    tools: LLMTool[],
    systemPrompt: string,
    options: { maxTokens?: number; temperature?: number }
  ): Promise<{ text: string; toolCalls: LLMToolCall[]; finishReason: string }>
  // Get available models
  listModels(): Promise<string[]>
  // Cleanup
  shutdown(): Promise<void>
}

// -----------------------------------------------------------------------------
// Default Configuration
// -----------------------------------------------------------------------------

export function createBridgeProviderConfig(): BridgeProviderConfig {
  return {
    defaultProvider: 'freellm',
    decisionRouterEnabled: true,
    routerProvider: 'freellm',
    fallbackChain: ['freellm', 'anthropic', 'openai', 'local'],
    providers: {
      freellm: {
        type: 'freellm',
        baseUrl: process.env.FREELLMAPI_BASE_URL || 'http://127.0.0.1:31415/v1',
        apiKey: process.env.FREELLMAPI_API_KEY || '',
        model: process.env.FREELLMAPI_MODEL || 'auto',
        maxTokens: 4096,
        temperature: 0.7
      },
      anthropic: {
        type: 'anthropic',
        apiKey: process.env.ANTHROPIC_API_KEY || '',
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
        maxTokens: 4096,
        temperature: 0.7
      },
      openai: {
        type: 'openai',
        baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        apiKey: process.env.OPENAI_API_KEY || '',
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        maxTokens: 4096,
        temperature: 0.7
      },
      local: {
        type: 'local',
        baseUrl: process.env.LOCAL_MODEL_BASE_URL || 'http://localhost:11434/v1',
        apiKey: process.env.LOCAL_MODEL_API_KEY || 'ollama',
        model: process.env.LOCAL_MODEL_NAME || 'llama3',
        maxTokens: 4096,
        temperature: 0.7
      }
    }
  }
}

// -----------------------------------------------------------------------------
// Decision Router
// -----------------------------------------------------------------------------

export type TaskType = 
  | 'code_review' 
  | 'refactor' 
  | 'planning' 
  | 'chat' 
  | 'search' 
  | 'offline'
  | 'analysis'
  | 'creative'

/**
 * Intelligent routing based on task type.
 * - code_review, refactor -> Anthropic (best for code)
 * - planning, analysis -> OpenAI or Anthropic (best for reasoning)
 * - chat, search -> FreeLLMAPI (default, fast, free)
 * - offline -> Local (privacy, no network)
 */
export function routeTask(
  taskType: TaskType,
  config: BridgeProviderConfig = createBridgeProviderConfig()
): ProviderType {
  if (!config.decisionRouterEnabled) {
    return config.defaultProvider
  }

  const providers = config.providers

  switch (taskType) {
    case 'code_review':
    case 'refactor':
      return providers.anthropic.apiKey ? 'anthropic' : config.defaultProvider
    case 'planning':
    case 'analysis':
      return providers.openai.apiKey ? 'openai' : 
             providers.anthropic.apiKey ? 'anthropic' : config.defaultProvider
    case 'offline':
      return 'local'
    case 'chat':
    case 'search':
    case 'creative':
    default:
      return config.defaultProvider
  }
}

/**
 * Get provider with fallback chain.
 * Tries providers in order until one is available.
 */
export function getAvailableProvider(
  preferred: ProviderType,
  config: BridgeProviderConfig = createBridgeProviderConfig()
): ProviderType {
  const providers = config.providers
  
  // Check preferred first
  if (providers[preferred]?.apiKey || preferred === 'freellm' || preferred === 'local') {
    return preferred
  }
  
  // Try fallback chain
  for (const p of config.fallbackChain) {
    if (providers[p]?.apiKey || p === 'freellm' || p === 'local') {
      return p
    }
  }
  
  // Last resort: freellm (might work without key on some setups)
  return 'freellm'
}

// -----------------------------------------------------------------------------
// Provider Factory
// -----------------------------------------------------------------------------

let providerCache: Map<ProviderType, LLMProvider> = new Map()

export async function createProvider(
  type: ProviderType,
  config: BridgeProviderConfig = createBridgeProviderConfig()
): Promise<LLMProvider> {
  if (providerCache.has(type)) {
    return providerCache.get(type)!
  }

  const providerConfig = config.providers[type]
  let provider: LLMProvider

  switch (type) {
    case 'freellm':
    case 'openai':
    case 'local':
      // All OpenAI-compatible
      const { OpenAICompatibleProvider } = await import('./providers/openai-compatible.ts')
      provider = new OpenAICompatibleProvider(providerConfig)
      break
    case 'anthropic':
      const { AnthropicProvider } = await import('./providers/anthropic.ts')
      provider = new AnthropicProvider(providerConfig)
      break
    default:
      throw new Error(`Unknown provider type: ${type}`)
  }

  await provider.initialize()
  providerCache.set(type, provider)
  return provider
}

export function clearProviderCache(): void {
  providerCache.clear()
}

// -----------------------------------------------------------------------------
// Streaming helper: converts provider events to bridge format
// -----------------------------------------------------------------------------

export async function* convertToBridgeEvents(
  provider: LLMProvider,
  messages: LLMMessage[],
  tools: LLMTool[],
  systemPrompt: string,
  options: { maxTokens?: number; temperature?: number; reasoningEffort?: string }
): AsyncGenerator<LLMStreamEvent, void, unknown> {
  for await (const event of provider.streamCompletion(messages, tools, systemPrompt, options)) {
    yield event
  }
}