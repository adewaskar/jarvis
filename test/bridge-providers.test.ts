import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { createBridgeProviderConfig, routeTask, getAvailableProvider, createProvider } from '../bridge/providers.ts'

describe('Bridge Provider Abstraction Tests', () => {
  const config = createBridgeProviderConfig()
  
  // Set test API keys
  before(() => {
    config.providers.freellm.apiKey = process.env.FREELLMAPI_API_KEY || 'test-key'
    config.providers.anthropic.apiKey = process.env.ANTHROPIC_API_KEY || ''
    config.providers.openai.apiKey = process.env.OPENAI_API_KEY || ''
    config.providers.local.apiKey = 'ollama'
  })

  it('should create default config with all providers', () => {
    assert.strictEqual(config.defaultProvider, 'freellm')
    assert.ok(config.providers.freellm)
    assert.ok(config.providers.anthropic)
    assert.ok(config.providers.openai)
    assert.ok(config.providers.local)
  })

  it('should route tasks correctly', () => {
    config.providers.anthropic.apiKey = 'sk-ant-test'
    config.providers.openai.apiKey = 'sk-proj-test'
    
    assert.strictEqual(routeTask('code_review', config), 'anthropic')
    assert.strictEqual(routeTask('refactor', config), 'anthropic')
    assert.strictEqual(routeTask('planning', config), 'openai')
    assert.strictEqual(routeTask('analysis', config), 'openai')
    assert.strictEqual(routeTask('chat', config), 'freellm')
    assert.strictEqual(routeTask('offline', config), 'local')
  })

  it('should fall back when key missing', () => {
    config.providers.anthropic.apiKey = ''
    config.providers.openai.apiKey = ''
    
    assert.strictEqual(routeTask('code_review', config), 'freellm')
    assert.strictEqual(routeTask('planning', config), 'freellm')
  })

  it('should get available provider with fallback', () => {
    config.providers.anthropic.apiKey = ''
    config.providers.openai.apiKey = ''
    
    // freellm should be available (has baseUrl)
    const provider = getAvailableProvider('anthropic', config)
    assert.strictEqual(provider, 'freellm')
  })

  it('should create FreeLLMAPI provider and list models', async () => {
    // Skip if no real API key
    if (!process.env.FREELLMAPI_API_KEY) {
      console.log('[test] Skipping FreeLLMAPI integration - no API key')
      return
    }
    
    const provider = await createProvider('freellm', config)
    assert.strictEqual(provider.getType(), 'freellm')
    assert.ok(provider.isAvailable())
    
    const models = await provider.listModels()
    assert.ok(Array.isArray(models))
    assert.ok(models.length > 0)
    console.log('[test] FreeLLMAPI models:', models.slice(0, 5))
    
    await provider.shutdown()
  })
})