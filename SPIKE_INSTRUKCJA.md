# JARVIS — Instrukcja uruchomienia Spike (Etap 1)

**Data:** 2026-11-12  
**Katalog:** `C:/Users/LukaszMichta/Repos-Private/jarvis`

---

## Wymagania wstępne

- Node.js 18+ (w environment: Node 26.7.0)
- `npm` (w environment: npm 10.x)
- FreeLLMAPI gateway uruchomiony na `http://127.0.0.1:31415/v1`
- Klucz API w zmiennej `FREELLMAPI_API_KEY` (z pliku `/c/Users/lukas/.hermes/.env`)

---

## Krok po kroku

### 1. Wejdź do katalogu projektu

```bash
cd "C:/Users/LukaszMichta/Repos-Private/jarvis"
```

### 2. Sprawdź, czy zależności są zainstalowane

```bash
ls node_modules/openai node_modules/@anthropic-ai/sdk 2>&1
```

Jeśli brakuje — zainstaluj:

```bash
npm install
```

### 3. Uruchom testy jednostkowe (TSX)

#### Wszystkie testy (25 testów):

```bash
npx tsx --test test/**/*.test.ts
```

#### Poszczególne pliki testowe:

```bash
# Provider & Router (frontend)
npx tsx --test test/providers-unit.test.ts

# Bridge providers (integracja z FreeLLMAPI)
FREELLMAPI_API_KEY=$(cat /c/Users/lukas/.hermes/.env | cut -d '=' -f2) \
  npx tsx --test test/bridge-providers.test.ts

# Security & permissions
npx tsx --test test/security.test.ts

# i18n (PL/EN)
npx tsx --test test/i18n.test.ts

# TTS config
npx tsx --test test/tts-unit.test.ts
```

### 4. Sprawdź FreeLLMAPI bezpośrednio (probe)

```bash
FREELLMAPI_API_KEY=$(cat /c/Users/lukas/.hermes/.env | cut -d '=' -f2) \
  python "C:/Users/lukas/AppData/Local/hermes/cache/scratch/probe3.py"
```

To sprawdzi:
- Streaming (SSE chunki)
- Tool calling (`tool_calls` w odpowiedzi)
- Bezpośredni Claude (`claude-sonnet-4-5`)
- Bezpośredni OpenAI (`gpt-4o`)
- Vision (image_url)

### 5. Uruchom bridge (serwer MCP + LLM)

```bash
# Tryb normalny (z zapisem)
npm run bridge

# Tryb read-only (tylko odczyt)
JARVIS_READ_ONLY=true npm run bridge

# Alternatywnie z flagą
npm run bridge:writes
```

### 6. Uruchom frontend (React + Vite)

```bash
npm run dev
```

Otwiera `http://localhost:5173` — Iron Man HUD interface.

### 7. Build (dla produkcji)

```bash
npm run build
```

---

## Struktura testów

| Plik testowy | Liczba testów | Co sprawdza |
|-------------|---------------|-------------|
| `test/providers-unit.test.ts` | 4 | `buildApiPayload`, `routeTask`, fallback |
| `test/bridge-providers.test.ts` | 5 | `createBridgeProviderConfig`, `routeTask`, `getAvailableProvider`, `createProvider('freellm')` |
| `test/security.test.ts` | 3 | Read-only, capability blocking |
| `test/i18n.test.ts` | 6 | PL/EN translations, interpolation, fallback |
| `test/tts-unit.test.ts` | 2 | Kokoro/ElevenLabs config |

---

## Oczekiwany wynik

```
ℹ tests 25
ℹ suites 7
ℹ pass 25
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms ~500-600
```

---

## Rozwiązanie problemów

| Problem | Rozwiązanie |
|---------|-------------|
| `Cannot find package 'openai'` | `npm install` w katalogu projektu |
| `Cannot find package '@anthropic-ai/sdk'` | `npm install @anthropic-ai/sdk` |
| `FREELLMAPI_API_KEY is empty` | Sprawdź `/c/Users/lukas/.hermes/.env` |
| `ERR_MODULE_NOT_FOUND` | `npm install` + `npx tsx --test ...` |
| Testy nie uruchamiają się | Sprawdź Node.js wersję: `node --version` |
| Bridge nie startuje | Sprawdź port 31415: `curl http://127.0.0.1:31415/v1/models` |

---

## Następny etap (Stage 2)

Po pomyślnym uruchomieniu spike — patrz `SPIKE_REPORT.md` dla planu etapu 2 (pełna aplikacja).