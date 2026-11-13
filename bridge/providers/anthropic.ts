/**
 * Anthropic Provider (Direct API)
 * 
 * Uses the official Anthropic SDK for Claude models.
 * Provides native tool calling and streaming support.
 */

import Anthropic from '@anthropic-ai/sdk'
import type {
  LLMProvider,
  ProviderConfig,
  LLMMessage,
  LLMTool,
  LLMStreamEvent,
  LLMToolCall
} from '../providers.ts'

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic
  private config: ProviderConfig
  private initialized = false

  constructor(config: ProviderConfig) {
    this.config = config
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || 'https://api.anthropic.com',
      defaultHeaders: {
        'anthropic-version': '2023-06-01'
      }
    })
  }

  getType() {
    return this.config.type
  }

  isAvailable(): boolean {
    return !!this.config.apiKey
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    
    try {
      // Test with a simple call - Anthropic doesn't have models.list
      // Just validate the key format
      if (!this.config.apiKey?.startsWith('sk-ant-')) {
        throw new Error('Invalid Anthropic API key format')
      }
      this.initialized = true
      console.log(`[provider:anthropic] Initialized with model ${this.config.model}`)
    } catch (e) {
      console.error('[provider:anthropic] Initialization failed:', e)
      throw e
    }
  }

  async listModels(): Promise<string[]> {
    // Anthropic doesn't expose models via API
    return [
      'claude-opus-5',
      'claude-sonnet-4-5',
      'claude-haiku-4-5',
      'claude-opus-4',
      'claude-sonnet-4'
    ]
  }

  private mapMessages(messages: LLMMessage[]) {
    return messages.map(m => {
      if (typeof m.content === 'string') {
        return { role: m.role, content: m.content }
      }
      return {
        role: m.role,
        content: m.content.map(block => {
          if (block.type === 'text') return { type: 'text', text: block.text }
          if (block.type === 'image_url') return { 
            type: 'image', 
            source: { 
              type: 'base64', 
              media_type: 'image/png', 
              data: block.image_url?.url.split(',')[1] || '' 
            } 
          }
          if (block.type === 'tool_use') return {
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input
          }
          if (block.type === 'tool_result') return {
            type: 'tool_result',
            tool_use_id: block.tool_call_id,
            content: block.output
          }
          return { type: 'text', text: JSON.stringify(block) }
        })
      }
    })
  }

  private mapTools(tools: LLMTool[]) {
    return tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters
    }))
  }

  async *streamCompletion(
    messages: LLMMessage[],
    tools: LLMTool[],
    systemPrompt: string,
    options: { maxTokens?: number; temperature?: number; reasoningEffort?: string } = {}
  ): AsyncGenerator<LLMStreamEvent, void, unknown> {
    const allMessages = this.mapMessages(messages)

    // Thinking configuration for Opus 5 / Sonnet 4.5
    const thinking = options.reasoningEffort ? { type: 'enabled', budget_tokens: 2048 } : undefined

    const stream = this.client.messages.stream({
      model: this.config.model,
      max_tokens: options.maxTokens ?? this.config.maxTokens,
      temperature: options.temperature ?? this.config.temperature,
      system: systemPrompt,
      messages: allMessages,
      tools: tools.length ? this.mapTools(tools) : undefined,
      tool_choice: tools.length ? { type: 'auto' } : undefined,
      thinking,
      // Beta: streaming tool calls
      betas: ['message-batches-2024-09-24']
    })

    let currentToolCall: LLMToolCall | null = null
    let toolCallInput = ''

    for await (const event of stream) {
      switch (event.type) {
        case 'content_block_start': {
          const block = event.content_block
          if (block.type === 'tool_use') {
            currentToolCall = {
              id: block.id,
              type: 'function',
              function: {
                name: block.name,
                arguments: ''
              }
            }
            toolCallInput = ''
          }
          break
        }
        case 'content_block_delta': {
          const delta = event.delta
          if (delta.type === 'text_delta') {
            yield { type: 'text_delta', delta: delta.text }
          } else if (delta.type === 'input_json_delta') {
            toolCallInput += delta.partial_json
            if (currentToolCall) {
              currentToolCall.function.arguments = toolCallInput
            }
          }
          break
        }
        case 'content_block_stop': {
          if (currentToolCall) {
            yield { type: 'tool_use', toolCall: currentToolCall }
            currentToolCall = null
            toolCallInput = ''
          }
          break
        }
        case 'message_stop': {
          const finishReason = event.message?.stop_reason || 'stop'
          let reason: LLMStreamEvent['finishReason'] = 'stop'
          if (finishReason === 'tool_use') reason = 'tool_calls'
          else if (finishReason === 'max_tokens') reason = 'max_tokens'
          
          yield { type: 'end', finishReason: reason }
          return
        }
        case 'message_delta': {
          if (event.delta?.stop_reason) {
            const finishReason = event.delta.stop_reason
            let reason: LLMStreamEvent['finishReason'] = 'stop'
            if (finishReason === 'tool_use') reason = 'tool_calls'
            else if (finishReason === 'max_tokens') reason = 'max_tokens'
            yield { type: 'end', finishReason: reason }
            return
          }
          break
        }
        case 'error': {
          yield { type: 'error', error: event.error?.message || 'Unknown Anthropic error' }
          return
        }
      }
    }
  }

  async complete(
    messages: LLMMessage[],
    tools: LLMTool[],
    systemPrompt: string,
    options: { maxTokens?: number; temperature?: number } = {}
  ): Promise<{ text: string; toolCalls: LLMToolCall[]; finishReason: string }> {
    const allMessages = this.mapMessages(messages)

    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: options.maxTokens ?? this.config.maxTokens,
      temperature: options.temperature ?? this.config.temperature,
      system: systemPrompt,
      messages: allMessages,
      tools: tools.length ? this.mapTools(tools) : undefined,
      tool_choice: tools.length ? { type: 'auto' } : undefined
    })

    const toolCalls: LLMToolCall[] = response.content
      .filter(b => b.type === 'tool_use')
      .map(b => ({
        id: b.id,
        type: 'function' as const,
        function: {
          name: b.name,
          arguments: JSON.stringify(b.input)
        }
      }))

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')

    return {
      text,
      toolCalls,
      finishReason: response.stop_reason || 'stop'
    }
  }

  async shutdown(): Promise<void> {
    this.initialized = false
  }
}