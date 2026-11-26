# J.A.R.V.I.S. 1.1.0 — Windows x64

## Download

The public installer is attached to the GitHub Release:

https://github.com/Nickzinh00/jarvis/releases/tag/v1.1.0

Download **JARVIS-Setup-1.1.0-x64.exe** from the Assets section of that release.

## Installation and first launch

1. Run the installer and follow the Windows setup wizard.
2. Launch J.A.R.V.I.S. from the Start menu or desktop shortcut.
3. Open the J.A.R.V.I.S. menu and choose **Configurar provedor de IA...**.
4. Choose automatic local-first mode or one of the supported providers.
5. For a local brain, install Ollama and download the Qwen model separately; the installer does not bundle multi-gigabyte AI models.

## Optional generation features

- **Images:** choose **Configurar geração de mídia...** and provide an OpenAI API key.
- **Voice files:** provide an ElevenLabs API key and, optionally, a voice ID in the same setup.
- The keys are stored in the current Windows profile, independently from the chat provider. External APIs may charge for use.

## Hardware adaptation

J.A.R.V.I.S. evaluates graphics capability and available system resources, then chooses Lite, Balanced or Full rendering. If the interface remains slow, it lowers visual effects and particle count. The selected AI model and answer quality are not changed by this setting.

See [WINDOWS.md](WINDOWS.md) for provider setup, local model requirements, privacy defaults and troubleshooting.
