/**
 * TDD Spike test: Provider abstraction supporting FreeLLMAPI, Anthropic, OpenAI, and Local.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert'

describe('Provider routing & client abstraction', () => {
  it('should support multi-provider configuration schema', () => {
    const config = {
      defaultProvider: 'freellm',
      providers: {
        freellm: { baseUrl: 'http://127.0.0.1:31415/v1', apiKey: 'test-key', model: 'auto' },
        anthropic: { apiKey: 'sk-ant-test', model: 'claude-opus-5' },
        openai: { apiKey: 'sk-proj-test', model: 'gpt-4o' },
        local: { baseUrl: 'http://localhost:11434/v1', model: 'llama3' }
      }
    }
    assert.strictEqual(config.defaultProvider, 'freellm')
    assert.ok(config.providers.freellm.baseUrl)
    assert.ok(config.providers.anthropic.apiKey)
  })

  it('should support decision router logic', () => {
    // Decision model rules:
    // - coding / code review -> Claude (anthropic)
    // - deep reasoning / planning -> OpenAI or Claude
    // - everyday voice / quick queries -> FreeLLMAPI (default)
    const route = (taskType: string) => {
      if (taskType === 'code_review' || taskType === 'refactor') return 'anthropic'
      if (taskType === 'deep_reasoning') return 'openai'
      return 'freellm'
    }

    assert.strictEqual(route('code_review'), 'anthropic')
    assert.strictEqual(route('chat'), 'freellm')
  })
})
