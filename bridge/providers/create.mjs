export async function createProvider(id, factories) {
  if (!Object.hasOwn(factories, id))
    throw new Error(`Unknown provider: ${id}`)
  return factories[id]()
}
export function diagnoseProvider(id, { run }) {
  if (id !== 'claude')
    return { ok: false, message: `Unknown provider: ${id}` }
  const result = run('claude', ['--version'], { encoding: 'utf8', timeout: 10000 })
  return { ok: result.status === 0, message: result.status === 0 ? 'Claude CLI available' : 'Claude CLI unavailable; install and log in with claude' }
}
