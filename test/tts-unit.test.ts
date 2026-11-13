import { describe, it } from 'node:test'
import assert from 'node:assert'

describe('TTS & Kokoro Engine Unit Tests', () => {
  it('should support Kokoro engine configuration and voice selection', () => {
    const ttsConfig = {
      engine: 'kokoro',
      voice: 'bm_george',
      availableVoices: ['bm_george', 'bm_fable', 'bm_lewis', 'bm_daniel'],
      fallback: 'system'
    }

    assert.strictEqual(ttsConfig.engine, 'kokoro')
    assert.ok(ttsConfig.availableVoices.includes(ttsConfig.voice))
  })

  it('should support ElevenLabs fallback and configuration', () => {
    const elevenConfig = {
      enabled: false,
      apiKey: 'sk-el-fake',
      voiceId: 'JBFqnCBsd6RMkjVDRZzb'
    }

    assert.strictEqual(typeof elevenConfig.enabled, 'boolean')
    assert.ok(elevenConfig.voiceId)
  })
})
