import { describe, it } from 'node:test'
import assert from 'node:assert'
import { setLanguage, getLanguage, t, getAvailableLanguages } from '../src/lib/i18n.ts'

describe('i18n (Polish/English) Tests', () => {
  it('should default to Polish', () => {
    setLanguage('pl')
    assert.strictEqual(getLanguage(), 'pl')
  })

  it('should translate UI strings in Polish', () => {
    setLanguage('pl')
    assert.strictEqual(t('ui.jarvisTitle'), 'JARVIS')
    assert.strictEqual(t('ui.listening'), 'Słucham...')
    assert.strictEqual(t('ui.thinking'), 'Myślę...')
    assert.strictEqual(t('ui.ready'), 'Gotowy')
  })

  it('should translate UI strings in English', () => {
    setLanguage('en')
    assert.strictEqual(t('ui.jarvisTitle'), 'JARVIS')
    assert.strictEqual(t('ui.listening'), 'Listening...')
    assert.strictEqual(t('ui.thinking'), 'Thinking...')
    assert.strictEqual(t('ui.ready'), 'Ready')
  })

  it('should support parameter interpolation', () => {
    setLanguage('pl')
    const msg = t('errors.providerUnavailable', { provider: 'FreeLLMAPI' })
    assert.strictEqual(msg, 'Dostawca FreeLLMAPI jest niedostępny')
    
    setLanguage('en')
    const msgEn = t('errors.providerUnavailable', { provider: 'FreeLLMAPI' })
    assert.strictEqual(msgEn, 'Provider FreeLLMAPI is unavailable')
  })

  it('should return key when translation missing', () => {
    setLanguage('pl')
    const result = t('nonexistent.key')
    assert.strictEqual(result, 'nonexistent.key')
  })

  it('should list available languages', () => {
    const langs = getAvailableLanguages()
    assert.deepStrictEqual(langs, ['pl', 'en'])
  })
})