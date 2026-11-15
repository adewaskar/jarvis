// Pure helpers behind `npm run setup`, kept apart so they can be tested
// without spawning anything.

/**
 * The Node versions JARVIS runs on. Vite and Rolldown, which build and serve
 * the page, require `^20.19.0 || >=22.12.0`; keep this in step with
 * `engines.node` in package.json.
 */
export const NODE_RANGE = '^20.19.0 || >=22.12.0'

/** True when a Node version string such as "22.12.0" or "v20.19.1" satisfies NODE_RANGE. */
export function nodeVersionOk(version) {
  const [major, minor] = String(version).replace(/^v/, '').split('.').map(Number)
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return false
  if (major === 20) return minor >= 19
  if (major === 22) return minor >= 12
  return major > 22
}

/**
 * Reads the JSON `claude auth status` prints.
 * Returns 'yes' or 'no' for a clear answer, and 'unknown' when the output
 * cannot be read (an older CLI without the subcommand, a changed format).
 */
export function loginState(stdout) {
  try {
    const status = JSON.parse(stdout)
    if (status && typeof status.loggedIn === 'boolean') return status.loggedIn ? 'yes' : 'no'
  } catch {
    // not JSON — fall through
  }
  return 'unknown'
}
