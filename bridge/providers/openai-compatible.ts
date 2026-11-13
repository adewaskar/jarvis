/**
 * OpenAI-Compatible Provider
 * 
 * Works with FreeLLMAPI, OpenAI, Ollama, vLLM, and any OpenAI-compatible endpoint.
 */

import OpenAI from 'openai'
import type {
  LLMProvider,
  ProviderConfig,
  LLMMessage,
  LLMTool,
  LLMStreamEvent,
  LLMToolCall
} from '../providers.ts'

export class OpenAICompatibleProvider implements LLMProvider {
  private client: OpenAI
  private config: ProviderConfig
  private initialized = false

  constructor(config: ProviderConfig) {
    this.config = config
    this.client = new OpenAI({
      baseURL: config.baseUrl,
      apiKey: config.apiKey || 'ollama', // Ollama accepts any string
      defaultHeaders: config.type === 'freellm' 
        ? { 'User-Agent': 'JARVIS-Bridge' }
        : undefined
    })
  }

  getType() {
    return this.config.type
  }

  isAvailable(): boolean {
    // FreeLLMAPI might work without key on local network
    // Local (Ollama) works without real API key
    return this.config.type === 'local' || this.config.type === 'freellm' || !!this.config.apiKey
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    
    // Test connection with a simple models list
    try {
      await this.client.models.list()
      this.initialized = true
      console.log(`[provider:${this.config.type}] Initialized successfully at ${this.config.baseUrl}`)
    } catch (e) {
      console.warn(`[provider:${this.config.type}] Initialization check failed:`, e)
      // Don't throw - some providers (FreeLLMAPI) might not support /models
      this.initialized = true
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await this.client.models.list()
      return response.data.map(m => m.id)
    } catch {
      return [this.config.model]
    }
  }

  private mapMessages(messages: LLMMessage[]) {
    return messages.map(m => {
      if (typeof m.content === 'string') {
        return { role: m.role, content: m.content }
      }
      // Handle multi-modal content
      return {
        role: m.role,
        content: m.content.map(block => {
          if (block.type === 'text') return { type: 'text', text: block.text }
          if (block.type === 'image_url') return { type: 'image_url', image_url: block.image_url }
          return { type: 'text', text: JSON.stringify(block) }
        })
      }
    })
  }

  private mapTools(tools: LLMTool[]) {
    return tools.map(t => ({
      type: 'function' as const,
      function: t.function
    }))
  }

  async *streamCompletion(
    messages: LLMMessage[],
    tools: LLMTool[],
    systemPrompt: string,
    options: { maxTokens?: number; temperature?: number; reasoningEffort?: string } = {}
  ): AsyncGenerator<LLMStreamEvent, void, unknown> {
    const allMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...this.mapMessages(messages)
    ]

    const stream = await this.client.chat.completions.create({
      model: this.config.model,
      messages: allMessages,
      tools: tools.length ? this.mapTools(tools) : undefined,
      tool_choice: tools.length ? 'auto' : undefined,
      max_tokens: options.maxTokens ?? this.config.maxTokens,
      temperature: options.temperature ?? this.config.temperature,
      stream: true,
      // OpenAI reasoning effort (for o1/o3 models)
      ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {})
    })

    let accumulatedText = ''
    let currentToolCall: LLMToolCall | null = null
    let toolCallBuffer = ''

    for await (const chunk of stream) {
      const choice = chunk.choices[0]
      if (!choice) continue

      const delta = choice.delta

      // Text delta
      if (delta.content) {
        accumulatedText += delta.content
        yield { type: 'text_delta', delta: delta.content }
      }

      // Tool calls
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.index === 0) {
            // New tool call
            if (currentToolCall) {
              yield { type: 'tool_use', toolCall: currentToolCall }
            }
            currentToolCall = {
              id: tc.id || `call_${Date.now()}`,
              type: 'function',
              function: {
                name: tc.function?.name || '',
                arguments: tc.function?.arguments || ''
              }
            }
          } else {
            // Continuation of tool call arguments
            if (currentToolCall && tc.function?.arguments) {
              currentToolCall.function.arguments += tc.function.arguments
            }
          }
        }
      }

      // Finish reason
      if (choice.finish_reason) {
        if (currentToolCall) {
          yield { type: 'tool_use', toolCall: currentToolCall }
          currentToolCall = null
        }
        
        let finishReason: LLMStreamEvent['finishReason'] = 'stop'
        if (choice.finish_reason === 'tool_calls') finishReason = 'tool_calls'
        else if (choice.finish_reason === 'length') finishReason = 'max_tokens'
        
        yield { type: 'end', finishReason }
        return
      }
    }
  }

  async complete(
    messages: LLMMessage[],
    tools: LLMTool[],
    systemPrompt: string,
    options: { maxTokens?: number; temperature?: number } = {}
  ): Promise<{ text: string; toolCalls: LLMToolCall[]; finishReason: string }> {
    const allMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...this.mapMessages(messages)
    ]

    const response = await this.client.chat.completions.create({
      model: this.config.model,
      messages: allMessages,
      tools: tools.length ? this.mapTools(tools) : undefined,
      tool_choice: tools.length ? 'auto' : undefined,
      max_tokens: options.maxTokens ?? this.config.maxTokens,
      temperature: options.temperature ?? this.config.temperature,
      stream: false
    })

    const choice = response.choices[0]
    const toolCalls: LLMToolCall[] = choice.message.tool_calls?.map(tc => ({
      id: tc.id,
      type: 'function' as const,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments
      }
    })) || []

    return {
      text: choice.message.content || '',
      toolCalls,
      finishReason: choice.finish_reason || 'stop'
    }
  }

  async shutdown(): Promise<void> {
    // OpenAI client doesn't need explicit shutdown
    this.initialized = false
  }
}