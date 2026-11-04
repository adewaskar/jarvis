export function loadBridgeConfig(env) {
  return { provider: env.JARVIS_PROVIDER ?? 'claude', port: Number(env.JARVIS_BRIDGE_PORT ?? 8787), model: env.JARVIS_MODEL ?? 'claude-opus-5', effort: env.JARVIS_EFFORT ?? 'high', allowWrites: env.JARVIS_ALLOW_WRITES === '1' }
}
