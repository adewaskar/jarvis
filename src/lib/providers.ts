/**
 * Multi-provider client abstraction supporting FreeLLMAPI (OpenAI-compatible),
 * Anthropic, OpenAI, and Local models, plus decision routing.
 */

export type ProviderType = 'freellm' | 'anthropic' | 'openai' | 'local'

export interface ProviderConfig {
  type: ProviderType
  baseUrl?: string
  apiKey?: string
  model: string
}

export interface MultiProviderConfig {
  defaultProvider: ProviderType
  providers: Record<ProviderType, ProviderConfig>
  decisionRouterEnabled: boolean
  routerModel?: ProviderType
}

export function createDefaultConfig(): MultiProviderConfig {
  return {
    defaultProvider: 'freellm',
    decisionRouterEnabled: true,
    routerModel: 'freellm',
    providers: {
          freellm: {
            type: 'freellm',
            baseUrl: import.meta.env.FREELLMAPI_BASE_URL || 'http://127.0.0.1:31415/v1',
            apiKey: import.meta.env.FREELLMAPI_API_KEY || '',
            model: 'auto'
          },
          anthropic: {
            type: 'anthropic',
            apiKey: import.meta.env.ANTHROPIC_API_KEY || '',
            model: 'claude-sonnet-4-5'
          },
          openai: {
            type: 'openai',
            apiKey: import.meta.env.OPENAI_API_KEY || '',
            model: 'gpt-4o'
          },
          local: {
            type: 'local',
            baseUrl: import.meta.env.LOCAL_MODEL_BASE_URL || 'http://localhost:11434/v1',
            apiKey: import.meta.env.LOCAL_MODEL_API_KEY || '',
            model: import.meta.env.LOCAL_MODEL_NAME || 'llama3'
          }
        }
  }
}

/**
 * Intelligent decision router: selects the optimal provider based on the task type.
 * - Code review, complex refactoring -> Anthropic (Claude)
 * - Heavy architecture & planning -> OpenAI / Claude
 * - General queries, daily chat, search -> FreeLLMAPI (default)
 * - Offline / private queries -> Local
 */
export function routeTask(
  taskType: 'code_review' | 'refactor' | 'planning' | 'chat' | 'search' | 'offline',
  config: MultiProviderConfig = createDefaultConfig()
): ProviderType {
  if (!config.decisionRouterEnabled) {
    return config.defaultProvider
  }

  switch (taskType) {
    case 'code_review':
    case 'refactor':
      return config.providers.anthropic.apiKey ? 'anthropic' : config.defaultProvider
    case 'planning':
      return config.providers.openai.apiKey ? 'openai' : config.defaultProvider
    case 'offline':
      return 'local'
    case 'chat':
    case 'search':
    default:
      return config.defaultProvider
  }
}

/**
 * Builds standard OpenAI-compatible chat completion payload.
 */
export function buildApiPayload(
  provider: ProviderConfig,
  messages: Array<{ role: string; content: string | any[] }>,
  options: { stream?: boolean; tools?: any[]; toolChoice?: string } = {}
) {
  return {
    model: provider.model,
    messages,
    ...(options.stream ? { stream: true } : {}),
    ...(options.tools ? { tools: options.tools } : {}),
    ...(options.toolChoice ? { tool_choice: options.toolChoice } : {}),
  }
}

