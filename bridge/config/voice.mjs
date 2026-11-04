export function resolveVoiceCredentials({ env, legacySource }) {
  return env.ELEVENLABS_API_KEY || legacySource.voiceKey || null
}
