/**
 * The bridge's own secrets, and keeping them away from the agent.
 *
 * Two jobs, both small and both easy to get wrong:
 *
 *   1. Where the keys come from. Setting an environment variable differs in
 *      every Windows shell, so the bridge also reads `~/.jarvis/.env` (or the
 *      file JARVIS_ENV_FILE names): one place, outside the repository, that a
 *      commit can never pick up. A variable already set in the shell wins.
 *
 *   2. Who gets to see them. The SDK starts the Claude Code CLI as a child
 *      process, and a child inherits its parent's whole environment unless told
 *      otherwise. So a key the bridge holds for its own use — the ElevenLabs key
 *      that pays for JARVIS's voice — would sit in the agent's environment,
 *      where one `echo $ELEVENLABS_API_KEY` reads it out, and a web page is
 *      exactly the thing that would ask for that. `agentEnv()` is the
 *      environment the agent gets instead: everything else, without these.
 *
 * The agent's file tools already refuse `.env` files (see SECRET_FILES in
 * policy.mjs), so the file itself is out of reach too.
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Variables only the bridge may see. */
export const BRIDGE_ONLY = [/^ELEVENLABS_/i, /^JARVIS_.*(KEY|TOKEN|SECRET)$/i]

/** The default location of the bridge's private settings file. */
export const defaultEnvFile = (home = homedir()) => join(home, '.jarvis', '.env')

/**
 * Load the private settings file into process.env, if there is one. Returns
 * the path loaded, or null. Variables already set are left as they are, so a
 * one-off `ELEVENLABS_API_KEY=… npm run bridge` still overrides the file.
 */
export function loadPrivateEnv(file = process.env.JARVIS_ENV_FILE || defaultEnvFile()) {
  if (!file || !existsSync(file)) return null
  if (typeof process.loadEnvFile !== 'function') {
    console.warn(`[jarvis] this Node.js cannot read ${file}; use Node 20.12 or newer, or set the variables in the shell`)
    return null
  }
  try {
    process.loadEnvFile(file)
    return file
  } catch (err) {
    console.error(`[jarvis] could not read ${file}: ${err.message}`)
    return null
  }
}

/** The environment for the agent: the bridge's own, minus its secrets. */
export function agentEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !BRIDGE_ONLY.some((re) => re.test(k))))
}
