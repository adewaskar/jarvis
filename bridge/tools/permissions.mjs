export function createPermissionPolicy({ allowWrites = false } = {}) {
  return {
    decide(tool) {
      const allowed = ['read', 'ui', 'camera'].includes(tool.effect) || allowWrites
      return { allowed, ...(allowed ? {} : { reason: 'JARVIS is running in read-only mode.' }) }
    },
  }
}
