import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  type ProviderConfig,
  type MultiProviderConfig,
  createDefaultConfig,
  routeTask,
  buildApiPayload,
} from '../src/lib/providers.ts'

describe('Provider & Router Unit Tests', () => {
  it('buildApiPayload constructs OpenAI-compatible payload for FreeLLMAPI', () => {
    const config = createDefaultConfig()
    const payload = buildApiPayload(config.providers.freellm, [
      { role: 'user', content: 'Cześć Jarvis' }
    ], { stream: true })

    assert.strictEqual(payload.model, 'auto')
    assert.strictEqual(payload.stream, true)
    assert.deepStrictEqual(payload.messages[0], { role: 'user', content: 'Cześć Jarvis' })
  })

  it('buildApiPayload respects model overrides for Claude and OpenAI', () => {
    const config = createDefaultConfig()
    config.providers.anthropic.apiKey = 'sk-ant-test'
    config.providers.anthropic.model = 'claude-opus-5'

    const payload = buildApiPayload(config.providers.anthropic, [
      { role: 'user', content: 'Przeanalizuj ten kod' }
    ])

    assert.strictEqual(payload.model, 'claude-opus-5')
  })

  it('routeTask routes tasks correctly according to decision matrix', () => {
    const config = createDefaultConfig()
    config.providers.anthropic.apiKey = 'sk-ant-key'
    config.providers.openai.apiKey = 'sk-proj-key'

    assert.strictEqual(routeTask('code_review', config), 'anthropic')
    assert.strictEqual(routeTask('refactor', config), 'anthropic')
    assert.strictEqual(routeTask('planning', config), 'openai')
    assert.strictEqual(routeTask('chat', config), 'freellm')
    assert.strictEqual(routeTask('offline', config), 'local')
  })

  it('routeTask falls back safely when key is missing', () => {
    const config = createDefaultConfig()
    config.providers.anthropic.apiKey = '' // No key set

    // Should fall back to default (freellm)
    assert.strictEqual(routeTask('code_review', config), 'freellm')
  })
})
