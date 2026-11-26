import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openAIEndpoint, readProviderConfig, readMediaConfig, resolveProviderConfig, makeToolMessages, providerNativeTools, restrictToolRegistries, streamCompletion, toolName } from '../bridge/provider-agent.mjs'

test('OpenAI-compatible endpoint adds the chat completion path once', () => {
  assert.equal(
    openAIEndpoint('http://127.0.0.1:11434/v1/'),
    'http://127.0.0.1:11434/v1/chat/completions',
  )
  assert.equal(
    openAIEndpoint('https://example.test/v1/chat/completions/'),
    'https://example.test/v1/chat/completions',
  )
})

test('local Ollama provider can be selected without a Claude installation', () => {
  const config = readProviderConfig({
    JARVIS_PROVIDER: 'ollama',
    JARVIS_BASE_URL: 'http://127.0.0.1:11434/v1',
    JARVIS_MODEL_NAME: 'llama3.1',
    JARVIS_API_KEY: 'ollama',
  })
  assert.equal(config.provider, 'ollama')
  assert.equal(config.baseUrl, 'http://127.0.0.1:11434/v1')
  assert.equal(config.model, 'llama3.1')
  assert.equal(config.apiKey, 'ollama')
})

test('cloud provider configuration is read from environment settings', () => {
  const config = readProviderConfig({
    JARVIS_PROVIDER: 'openrouter',
    JARVIS_BASE_URL: 'https://openrouter.ai/api/v1',
    JARVIS_MODEL_NAME: 'provider/model-id',
    JARVIS_API_KEY: 'test-only-key',
  })
  assert.equal(config.provider, 'openrouter')
  assert.equal(config.model, 'provider/model-id')
  assert.equal(config.apiKey, 'test-only-key')
})

test('automatic provider mode prefers an installed local Ollama model', async () => {
  let requestedUrl = ''
  const config = await resolveProviderConfig({
    provider: 'auto',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.1',
    fallback: { provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'provider/fallback', apiKey: 'local-test-key' },
  }, async (url) => {
    requestedUrl = url
    return { ok: true, json: async () => ({ models: [{ name: 'llama3.1:latest' }] }) }
  })
  assert.equal(requestedUrl, 'http://127.0.0.1:11434/api/tags')
  assert.equal(config.provider, 'ollama')
  assert.equal(config.model, 'llama3.1:latest')
})

test('automatic provider mode falls back when the local Ollama service is absent', async () => {
  const config = await resolveProviderConfig({
    provider: 'auto',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.1',
    fallback: { provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'provider/fallback', apiKey: 'local-test-key' },
  }, async () => ({ ok: false }))
  assert.equal(config.provider, 'openrouter')
  assert.equal(config.model, 'provider/fallback')
})

test('automatic provider mode gives a setup error when no local or cloud option is ready', async () => {
  const config = await resolveProviderConfig({
    provider: 'auto',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.1',
    fallback: null,
  }, async () => { throw new Error('offline') })
  assert.match(config.error, /Start Ollama/)
})


test('tool results keep tool replies separate from vision follow-up messages', () => {
  const result = makeToolMessages('call-1', {
    text: 'camera captured',
    image: 'data:image/jpeg;base64,AAAA',
    images: ['data:image/png;base64,BBBB', 'data:image/gif;base64,CCCC'],
  })
  assert.equal(result.toolMessage.role, 'tool')
  assert.equal(result.toolMessage.tool_call_id, 'call-1')
  assert.equal(result.toolMessage.content, 'camera captured')
  assert.deepEqual(result.images, [
    'data:image/jpeg;base64,AAAA',
    'data:image/png;base64,BBBB',
  ])
})

test('tool vision attachments are capped and reject non-supported image payloads', () => {
  const images = Array.from({ length: 7 }, (_, index) => `data:image/webp;base64,IMAGE${index}`)
  const result = makeToolMessages('call-2', { text: 'many images', images })
  assert.equal(result.images.length, 4)
  assert.ok(result.images.every((image) => image.startsWith('data:image/webp;')))
})

test('automatic provider selection resolves a shorthand to the exact installed Ollama tag', async () => {
  const config = await resolveProviderConfig({
    provider: 'auto',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen3-vl',
    fallback: null,
  }, async () => ({
    ok: true,
    json: async () => ({ models: [{ name: 'qwen3-vl:4b' }] }),
  }))
  assert.equal(config.provider, 'ollama')
  assert.equal(config.model, 'qwen3-vl:4b')
})

test('MCP tool names stay unique after sanitisation and within provider limits', () => {
  const first = toolName('my.server', 'get/item')
  const second = toolName('my_server', 'get_item')
  assert.notEqual(first, second)
  assert.ok(first.length <= 64)
  assert.ok(second.length <= 64)
})

test('alternative provider keeps Chrome read tools but gates browser actions by default', () => {
  const safe = providerNativeTools(false).tools.map((item) => item.function.name)
  for (const name of ['jarvis_chrome_status', 'jarvis_chrome_tabs', 'jarvis_chrome_navigate', 'jarvis_chrome_read_page', 'jarvis_chrome_screenshot']) {
    assert.ok(safe.includes(name), name + ' should be available in read-only mode')
  }
  for (const name of ['jarvis_chrome_click', 'jarvis_chrome_type', 'jarvis_chrome_key', 'jarvis_chrome_form_input', 'jarvis_chrome_new_tab', 'jarvis_chrome_close_tab', 'jarvis_write_file']) {
    assert.ok(!safe.includes(name), name + ' must be withheld in read-only mode')
    assert.ok(!providerNativeTools(false).toolMap.has(name), name + ' must not remain executable when hidden')
  }
  const writableSet = providerNativeTools(true)
  const writable = writableSet.tools.map((item) => item.function.name)
  assert.ok(writable.includes('jarvis_chrome_click'))
  assert.ok(writable.includes('jarvis_chrome_close_tab'))
  assert.ok(writableSet.toolMap.has('jarvis_chrome_click'))
})

test('compatible provider accepts a non-streaming JSON completion response', async () => {
  const emitted = []
  const result = await streamCompletion(
    { provider: 'custom', baseUrl: 'https://api.example.test/v1', model: 'test-model', apiKey: 'test-key' },
    [{ role: 'user', content: 'hello' }],
    [],
    new AbortController().signal,
    (chunk) => emitted.push(chunk),
    async (url, options) => {
      assert.equal(url, 'https://api.example.test/v1/chat/completions')
      assert.equal(options.method, 'POST')
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          choices: [{
            message: {
              content: 'Hello from JSON mode.',
              tool_calls: [{
                id: 'call-json',
                function: { name: 'jarvis_web_search', arguments: { query: 'test' } },
              }],
            },
          }],
        }),
      }
    },
  )
  assert.equal(result.text, 'Hello from JSON mode.')
  assert.deepEqual(emitted, ['Hello from JSON mode.'])
  assert.equal(result.toolCalls[0].id, 'call-json')
  assert.equal(result.toolCalls[0].function.arguments, '{"query":"test"}')
})

test('only provider tools actually advertised to the model remain executable', () => {
  const exposed = [{ function: { name: 'visible_tool' } }]
  const registry = new Map([
    ['visible_tool', { policyName: 'Read' }],
    ['hidden_tool', { policyName: 'Write' }],
  ])
  const result = restrictToolRegistries(exposed, registry)
  assert.equal(result, exposed)
  assert.equal(registry.has('visible_tool'), true)
  assert.equal(registry.has('hidden_tool'), false)
})


test('image and speech credentials are independent from a local chat model', () => {
  const media = readMediaConfig({ JARVIS_PROVIDER: 'ollama', JARVIS_IMAGE_API_KEY: 'image-test-key', ELEVENLABS_API_KEY: 'speech-test-key' }, {})
  assert.equal(media.imageApiKey, 'image-test-key')
  assert.equal(media.elevenLabsApiKey, 'speech-test-key')
  assert.equal(media.imageModel, 'gpt-image-2.6-flare')
  assert.match(media.voiceId, /^[A-Za-z0-9_-]{6,100}$/)
})

test('image and speech generation are available in default read-only mode', () => {
  const { tools, toolMap } = providerNativeTools(false)
  const names = tools.map((item) => item.function.name)
  assert.ok(names.includes('jarvis_generate_image'))
  assert.ok(names.includes('jarvis_generate_speech'))
  assert.ok(toolMap.has('jarvis_generate_image'))
  assert.ok(toolMap.has('jarvis_generate_speech'))
})
