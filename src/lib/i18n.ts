/**
 * Internationalization (i18n) for JARVIS
 * 
 * Default: Polish (pl)
 * Optional: English (en)
 * 
 * Supports runtime language switching and easy extension.
 */

export type Language = 'pl' | 'en'

export interface Translations {
  // UI Strings
  ui: {
    jarvisTitle: string
    listening: string
    thinking: string
    speaking: string
    ready: string
    error: string
    settings: string
    language: string
    voice: string
    provider: string
    security: string
    readOnlyMode: string
    allowWrites: string
    blockedCapabilities: string
    mcp: string
    shell: string
    files: string
    browser: string
  }
  // Voice/TTS
  voice: {
    kokoro: string
    elevenlabs: string
    system: string
    voiceLabel: string
    languageLabel: string
    testVoice: string
    stopVoice: string
  }
  // Provider/Router
  provider: {
    freellm: string
    anthropic: string
    openai: string
    local: string
    routingEnabled: string
    codeReview: string
    planning: string
    chat: string
    offline: string
  }
  // Errors/Messages
  errors: {
    providerUnavailable: string
    apiKeyMissing: string
    networkError: string
    permissionDenied: string
    readOnlyViolation: string
    capabilityBlocked: string
  }
}

export const TRANSLATIONS: Record<Language, Translations> = {
  pl: {
    ui: {
      jarvisTitle: 'JARVIS',
      listening: 'Słucham...',
      thinking: 'Myślę...',
      speaking: 'Mówię...',
      ready: 'Gotowy',
      error: 'Błąd',
      settings: 'Ustawienia',
      language: 'Język',
      voice: 'Głos',
      provider: 'Dostawca LLM',
      security: 'Bezpieczeństwo',
      readOnlyMode: 'Tryb tylko do odczytu',
      allowWrites: 'Zezwalaj na zapisy',
      blockedCapabilities: 'Zablokowane możliwości',
      mcp: 'MCP',
      shell: 'Terminal',
      files: 'Pliki',
      browser: 'Przeglądarka'
    },
    voice: {
      kokoro: 'Kokoro (lokalny)',
      elevenlabs: 'ElevenLabs (chmura)',
      system: 'Systemowy',
      voiceLabel: 'Głos',
      languageLabel: 'Język',
      testVoice: 'Przetestuj głos',
      stopVoice: 'Zatrzymaj'
    },
    provider: {
      freellm: 'FreeLLMAPI (domyślny)',
      anthropic: 'Anthropic (Claude)',
      openai: 'OpenAI (ChatGPT)',
      local: 'Lokalny (Ollama/vLLM)',
      routingEnabled: 'Inteligentny router zadań',
      codeReview: 'Code review / Refaktoryzacja',
      planning: 'Planowanie / Analiza',
      chat: 'Czat / Ogólne',
      offline: 'Offline / Prywatne'
    },
    errors: {
      providerUnavailable: 'Dostawca {provider} jest niedostępny',
      apiKeyMissing: 'Brak klucza API dla {provider}',
      networkError: 'Błąd sieci: {message}',
      permissionDenied: 'Odmowa dostępu: {reason}',
      readOnlyViolation: 'System w trybie tylko do odczytu — operacja odrzucona',
      capabilityBlocked: 'Możliwość {capability} jest zablokowana'
    }
  },
  en: {
    ui: {
      jarvisTitle: 'JARVIS',
      listening: 'Listening...',
      thinking: 'Thinking...',
      speaking: 'Speaking...',
      ready: 'Ready',
      error: 'Error',
      settings: 'Settings',
      language: 'Language',
      voice: 'Voice',
      provider: 'LLM Provider',
      security: 'Security',
      readOnlyMode: 'Read-only mode',
      allowWrites: 'Allow writes',
      blockedCapabilities: 'Blocked capabilities',
      mcp: 'MCP',
      shell: 'Shell',
      files: 'Files',
      browser: 'Browser'
    },
    voice: {
      kokoro: 'Kokoro (local)',
      elevenlabs: 'ElevenLabs (cloud)',
      system: 'System',
      voiceLabel: 'Voice',
      languageLabel: 'Language',
      testVoice: 'Test voice',
      stopVoice: 'Stop'
    },
    provider: {
      freellm: 'FreeLLMAPI (default)',
      anthropic: 'Anthropic (Claude)',
      openai: 'OpenAI (ChatGPT)',
      local: 'Local (Ollama/vLLM)',
      routingEnabled: 'Smart task router',
      codeReview: 'Code review / Refactor',
      planning: 'Planning / Analysis',
      chat: 'Chat / General',
      offline: 'Offline / Private'
    },
    errors: {
      providerUnavailable: 'Provider {provider} is unavailable',
      apiKeyMissing: 'Missing API key for {provider}',
      networkError: 'Network error: {message}',
      permissionDenied: 'Access denied: {reason}',
      readOnlyViolation: 'System in read-only mode — operation rejected',
      capabilityBlocked: 'Capability {capability} is blocked'
    }
  }
}

let currentLanguage: Language = (import.meta.env.VITE_LANGUAGE as Language) || 'en'

export function setLanguage(lang: Language): void {
  currentLanguage = lang
}

export function getLanguage(): Language {
  return currentLanguage
}

export function t(key: string, params?: Record<string, string>): string {
  const keys = key.split('.')
  let value: any = TRANSLATIONS[currentLanguage]
  
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k]
    } else {
      // Fallback to English
      value = TRANSLATIONS.en
      for (const fk of keys) {
        if (value && typeof value === 'object' && fk in value) {
          value = value[fk]
        } else {
          return key // Return key as last resort
        }
      }
      break
    }
  }
  
  if (typeof value === 'string' && params) {
    return value.replace(/{(\w+)}/g, (_, p) => params[p] || `{${p}}`)
  }
  
  return typeof value === 'string' ? value : key
}

export function getAvailableLanguages(): Language[] {
  return ['pl', 'en']
}

export function getTranslationSection(section: keyof Translations): any {
  return TRANSLATIONS[currentLanguage][section]
}