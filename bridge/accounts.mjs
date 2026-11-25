import { AsyncLocalStorage } from 'node:async_hooks'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Several accounts per platform, for running more than one channel.
 *
 * Each platform has a main account (~/.jarvis/secrets/tiktok.json) and any
 * number of named ones (tiktok@cooking.json), connected with
 * `npm run social:connect -- tiktok --account cooking`. Names are short
 * lowercase labels the user picks; they never leave this machine.
 *
 * Code that talks to a platform does not take an account argument. It asks
 * accountSecret('tiktok'), which answers for whichever account the current
 * async call is running under: the main one by default, or the one a caller
 * chose with withAccount(). The autopilot wraps each channel's post that way,
 * so the same upload code serves every channel.
 */

export const SECRETS_DIR = join(homedir(), '.jarvis', 'secrets')
export const ACCOUNT_RE = /^[a-z0-9][a-z0-9-]{0,30}$/

const als = new AsyncLocalStorage()

/** Run fn with `account` as the current account (null or '' = main). */
export function withAccount(account, fn) {
  if (account && !ACCOUNT_RE.test(account)) throw new Error(`"${account}" is not a valid account name: use lowercase letters, digits and dashes.`)
  return als.run(account || null, fn)
}

export const currentAccount = () => als.getStore() ?? null

/** The secret file name for a platform's account: 'tiktok' (main) or 'tiktok@cooking'. */
export const accountSecret = (platform, account = currentAccount()) => (account ? `${platform}@${account}` : platform)

/** Every connected account for a platform: 'main' first if it exists, then the named ones. */
export function listAccounts(platform, dir = SECRETS_DIR) {
  if (!existsSync(dir)) return []
  const names = readdirSync(dir)
  const named = names
    .map((f) => f.match(new RegExp(`^${platform}@([a-z0-9-]+)\\.json$`))?.[1])
    .filter(Boolean)
    .sort()
  return [...(names.includes(`${platform}.json`) ? ['main'] : []), ...named]
}

/** 'main' -> null; anything else unchanged. */
export const accountKey = (name) => (!name || name === 'main' ? null : name)

/** Parse `--account <name>` (or `--account=<name>`) from argv. Returns null for the main account. */
export function accountArg(argv = process.argv) {
  const i = argv.findIndex((a) => a === '--account' || a.startsWith('--account='))
  if (i < 0) return null
  const name = (argv[i].includes('=') ? argv[i].split('=')[1] : argv[i + 1] ?? '').toLowerCase()
  if (!ACCOUNT_RE.test(name)) {
    console.error('\n  --account needs a short name: lowercase letters, digits and dashes (e.g. --account cooking).\n')
    process.exit(1)
  }
  return accountKey(name)
}

/** argv without `--account <name>`, so other positional arguments still parse. */
export function withoutAccountArg(argv = process.argv) {
  const out = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--account') i++
    else if (!argv[i].startsWith('--account=')) out.push(argv[i])
  }
  return out
}
