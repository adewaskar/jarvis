import { describe, it } from 'node:test'
import assert from 'node:assert'
import { createDefaultConfig, routeTask } from '../src/lib/providers.ts'

describe('Multi-provider routing and config tests', () => {
  it('should initialize default config correctly', () => {
    const cfg = createDefaultConfig()
    assert.strictEqual(cfg.defaultProvider, 'freellm')
    assert.strictEqual(cfg.providers.freellm.model, 'auto')
  })

  it('should route code review to anthropic if key available', () => {
    const cfg = createDefaultConfig()
    cfg.providers.anthropic.apiKey = 'sk-ant-fake'
    const provider = routeTask('code_review', cfg)
    assert.strictEqual(provider, 'anthropic')
  })

  it('should fallback to default if requested provider lacks API key', () => {
    const cfg = createDefaultConfig()
    cfg.providers.anthropic.apiKey = '' // empty
    const provider = routeTask('code_review', cfg)
    assert.strictEqual(provider, 'freellm')
  })
})
