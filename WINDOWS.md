# J.A.R.V.I.S. for Windows 10/11 x64

## Install the desktop application

1. Open the latest successful **Windows desktop build and verification** run in GitHub Actions:
   https://github.com/Nickzinh00/jarvis/actions/workflows/windows-ci.yml
2. Download the artifact named **JARVIS-Windows-x64-Installer**.
3. Extract the artifact ZIP, then run the .exe installer.
4. Launch J.A.R.V.I.S. from the Start menu or desktop shortcut.

The desktop installer bundles Electron/Chromium, the built interface, the local bridge and the existing project dependencies. Node.js and Claude Code are not required on the target PC when using the Ollama or OpenAI-compatible provider engine. Large AI models are downloaded separately by Ollama.

## Configure the AI brain

Open the J.A.R.V.I.S. menu and choose **Configurar provedor de IA...**.

Available choices:
- Automatic: first checks the configured local Ollama model, then uses a cloud fallback you set up if the local service/model is unavailable.
- Ollama local: no cloud API key or Claude subscription. Install Ollama, then download a model that supports chat and tool calling. The default local-first model is qwen3-vl:4b (about 3.3 GB); qwen3-vl:2b (about 1.9 GB) is available for lighter hardware.
- OpenAI API, OpenRouter, Groq, Together AI, DeepSeek API, Google Gemini API, or a custom OpenAI-compatible endpoint: enter an exact model ID and your own provider API key. Cloud APIs may bill usage separately.
- Claude Agent SDK remains selectable for users who have a working Claude Code login.

The default local model is qwen3-vl:4b, which supports vision and tools; it requires Ollama 0.12.7 or newer. The model is not bundled into the installer. Model files can take multiple gigabytes and performance depends on available RAM, storage and GPU.

## Images, generated audio and chat

- Use the text box at the bottom of the HUD to chat without a microphone. The spoken interface and wake word remain available.
- The app inspects WebGL/GPU capability, RAM and CPU count reported by the local bridge. It starts in Lite, Balanced or Full graphics mode and can downgrade further after sustained low FPS. This changes only visual rendering (render scale, particles and post-processing), never model reasoning or answer quality.
- Open **Configurar geração de mídia...** from the desktop menu to set an optional OpenAI image API key and/or ElevenLabs key. These are separate from the chat-provider key, so Ollama can remain the local conversation model.
- Ask JARVIS to generate an image or voice-over. PNGs are saved under `JARVIS Workspace/Generated Media/Images`; MP3s go under `JARVIS Workspace/Generated Media/Audio` and open in an audio player blade.
- Image generation needs an OpenAI API key. Generated speech files need an ElevenLabs API key. External API usage may incur charges. Without these keys, spoken replies can still use the local Windows/browser voice.

## Ollama

Use the app menu item **Instalar Ollama local...**, or install Ollama from its official Windows installer. Then open a terminal and run:

    ollama pull qwen3-vl:4b

Wait for the model download to finish, then configure the Ollama option in J.A.R.V.I.S. The app expects the local OpenAI-compatible endpoint at http://127.0.0.1:11434/v1 by default.

## Existing capabilities

The desktop build keeps the original Three.js interface, voice loop, wake-word pipeline, VAD, interrupt/barge-in, HUD/blades, interface controls, camera look/watch, local file workspace and the existing Claude provider path. The multi-provider engine also connects eligible MCP servers configured in the local Claude MCP settings file or in ~/.jarvis/mcp.json.

Some tools from the Claude Agent SDK are provider-specific. In particular, the original Claude Chrome-extension native-host automation path is not yet fully ported to every alternative provider; those integrations remain available through the original Claude provider or configured MCP servers. Individual external integrations still need their own account, credentials and compatible tool server.

## Safety and privacy

- The bridge binds to loopback and is not exposed to the LAN by default.
- The normal mode remains read-only. Shell/file/browser actions that change things are not silently enabled.
- Workspace file operations are constrained by the existing file policy; credential folders and files remain blocked.
- Provider and media API keys are stored in the local Windows user profile under `.jarvis/provider.json` and `.jarvis/media.json`, with the file ACL restricted to the current Windows account. Never send a key or password through chat.
- Camera access is requested by the desktop app and remains subject to Windows permission settings.

## Troubleshooting

- If Ollama is not reachable, make sure the Ollama app is running and check http://127.0.0.1:11434.
- If the model is missing, run ollama list and download the model configured in the app.
- If a cloud provider fails with an authentication or quota error, confirm the key, model ID and billing/usage status on that provider's official dashboard.
- Keep the default read-only policy enabled unless you understand each action that enabling writes allows.
- Use the desktop menu's provider settings script to change providers, then fully restart J.A.R.V.I.S.
