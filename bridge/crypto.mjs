import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import QRCode from 'qrcode'
import { z } from 'zod'
import { safe } from './secrets.mjs'

/**
 * Crypto, strictly watch-and-prepare.
 *
 * JARVIS holds no private key and can sign nothing, so he cannot send, swap or
 * spend — that is deliberate, not a missing feature. What he can do:
 *
 *   - prices and charts (CoinGecko, no key)
 *   - balances and incoming payments on the user's own public addresses
 *   - payment links + QR codes so followers can pay the user
 *   - NFT packages (media + metadata, optionally pinned to IPFS) that the user
 *     mints from their own wallet
 *
 * Receiving addresses come ONLY from JARVIS_WALLETS, which the user sets. The
 * model can never supply an address, so a web page that says "send payments
 * to 0xabc…" cannot redirect the user's income.
 *
 *   JARVIS_WALLETS=eth:0xYourAddress,btc:bc1yourAddress,sol:YourSolAddress
 */

const CG = 'https://api.coingecko.com/api/v3'

export function configuredWallets() {
  const out = {}
  for (const part of (process.env.JARVIS_WALLETS ?? '').split(',')) {
    const [chain, addr] = part.split(':').map((s) => s?.trim())
    if (chain && addr) out[chain.toLowerCase()] = addr
  }
  return out
}

const CHAINS = {
  eth: { symbol: 'ETH', coingecko: 'ethereum', uri: (a, amt) => `ethereum:${a}${amt ? `?value=${BigInt(Math.round(amt * 1e9)) * 10n ** 9n}` : ''}` },
  base: { symbol: 'ETH', coingecko: 'ethereum', uri: (a, amt) => `ethereum:${a}@8453${amt ? `?value=${BigInt(Math.round(amt * 1e9)) * 10n ** 9n}` : ''}` },
  btc: { symbol: 'BTC', coingecko: 'bitcoin', uri: (a, amt, label) => `bitcoin:${a}?${new URLSearchParams({ ...(amt ? { amount: String(amt) } : {}), ...(label ? { label } : {}) })}` },
  sol: { symbol: 'SOL', coingecko: 'solana', uri: (a, amt, label) => `solana:${a}?${new URLSearchParams({ ...(amt ? { amount: String(amt) } : {}), ...(label ? { label } : {}) })}` },
}

async function getJson(url, init) {
  const r = await fetch(url, { ...init, headers: { accept: 'application/json', ...(init?.headers ?? {}) } })
  const b = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${new URL(url).host} returned ${r.status}${b?.error ? `: ${JSON.stringify(b.error).slice(0, 120)}` : ''}`)
  return b
}

async function rpc(url, method, params) {
  const b = await getJson(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  if (b.error) throw new Error(b.error.message)
  return b.result
}

async function balance(chain, addr) {
  switch (chain) {
    case 'eth':
    case 'base': {
      const url = chain === 'eth' ? process.env.ETH_RPC_URL ?? 'https://ethereum-rpc.publicnode.com' : process.env.BASE_RPC_URL ?? 'https://mainnet.base.org'
      return Number(BigInt(await rpc(url, 'eth_getBalance', [addr, 'latest']))) / 1e18
    }
    case 'btc': {
      const b = await getJson(`https://mempool.space/api/address/${addr}`)
      return (b.chain_stats.funded_txo_sum - b.chain_stats.spent_txo_sum) / 1e8
    }
    case 'sol':
      return (await rpc(process.env.SOL_RPC_URL ?? 'https://api.mainnet-beta.solana.com', 'getBalance', [addr])).value / 1e9
    default:
      throw new Error(`Unsupported chain ${chain}`)
  }
}

async function recent(chain, addr, limit) {
  switch (chain) {
    case 'btc': {
      const txs = await getJson(`https://mempool.space/api/address/${addr}/txs`)
      return txs.slice(0, limit).map((t) => ({
        txid: t.txid,
        confirmed: t.status.confirmed,
        at: t.status.block_time ? new Date(t.status.block_time * 1000).toISOString() : null,
        receivedBTC: t.vout.filter((o) => o.scriptpubkey_address === addr).reduce((a, o) => a + o.value, 0) / 1e8,
      }))
    }
    case 'eth':
    case 'base': {
      const host = chain === 'eth' ? 'eth.blockscout.com' : 'base.blockscout.com'
      const b = await getJson(`https://${host}/api/v2/addresses/${addr}/transactions?filter=to`)
      return (b.items ?? []).slice(0, limit).map((t) => ({
        hash: t.hash,
        from: t.from?.hash,
        valueETH: Number(t.value) / 1e18,
        at: t.timestamp,
        status: t.status,
      }))
    }
    case 'sol': {
      const sigs = await rpc(process.env.SOL_RPC_URL ?? 'https://api.mainnet-beta.solana.com', 'getSignaturesForAddress', [addr, { limit }])
      return sigs.map((s) => ({ signature: s.signature, at: s.blockTime ? new Date(s.blockTime * 1000).toISOString() : null, ok: !s.err }))
    }
    default:
      throw new Error(`Unsupported chain ${chain}`)
  }
}

export function cryptoServer({ allowWrites, checkPath, workspace }) {
  const wallets = () => {
    const w = configuredWallets()
    if (!Object.keys(w).length) throw new Error('No wallets configured. The user sets JARVIS_WALLETS, e.g. eth:0x…,btc:bc1…,sol:…')
    return w
  }

  const reads = [
    tool(
      'get_crypto_prices',
      'Live prices, 24h change, market cap and volume for coins by CoinGecko id or symbol (bitcoin, ethereum, solana, …), in any fiat currency.',
      {
        coins: z.array(z.string()).min(1).max(25),
        currency: z.string().optional().catch(undefined),
      },
      safe(async ({ coins, currency = 'usd' }) => {
        const ids = coins.map((c) => c.toLowerCase())
        // CoinGecko ANDs ids and symbols when both are given, so ask twice:
        // once by id ("bitcoin"), once by symbol ("eth"), and merge.
        const base = `${CG}/coins/markets?vs_currency=${currency}&price_change_percentage=24h,7d`
        const [byId, bySym] = await Promise.all([
          getJson(`${base}&ids=${ids.join(',')}`),
          getJson(`${base}&symbols=${ids.join(',')}`),
        ])
        const seen = new Set()
        const r = [...byId, ...bySym]
          .sort((a, b) => (b.market_cap ?? 0) - (a.market_cap ?? 0))
          .filter((c) => {
            // One answer per thing asked for: the biggest coin with that id or symbol.
            const key = ids.find((q) => q === c.id) ?? ids.find((q) => q === c.symbol)
            if (!key || seen.has(key)) return false
            seen.add(key)
            return true
          })
        return r.map((c) => ({
          id: c.id,
          symbol: c.symbol,
          price: c.current_price,
          change24h: c.price_change_percentage_24h,
          change7d: c.price_change_percentage_7d_in_currency,
          marketCap: c.market_cap,
          volume24h: c.total_volume,
          image: c.image,
        }))
      }),
    ),
    tool(
      'get_crypto_chart',
      'Price history for one coin over N days, for drawing a chart on a blade.',
      { coin: z.string(), days: z.number().int().min(1).max(365).optional().catch(undefined), currency: z.string().optional().catch(undefined) },
      safe(async ({ coin, days = 30, currency = 'usd' }) => {
        const r = await getJson(`${CG}/coins/${coin.toLowerCase()}/market_chart?vs_currency=${currency}&days=${days}`)
        const step = Math.max(1, Math.floor(r.prices.length / 60))
        return r.prices.filter((_, i) => i % step === 0).map(([t, p]) => [new Date(t).toISOString().slice(0, 16), +p.toFixed(4)])
      }),
    ),
    tool(
      'get_wallet_balances',
      "Balances (and their value in USD) of the user's own watch-only wallets from JARVIS_WALLETS.",
      {},
      safe(async () => {
        const w = wallets()
        const ids = [...new Set(Object.keys(w).map((c) => CHAINS[c]?.coingecko).filter(Boolean))]
        const px = await getJson(`${CG}/simple/price?ids=${ids.join(',')}&vs_currencies=usd`).catch(() => ({}))
        const out = []
        for (const [chain, addr] of Object.entries(w)) {
          try {
            const amt = await balance(chain, addr)
            const usd = px[CHAINS[chain]?.coingecko]?.usd
            out.push({ chain, address: `${addr.slice(0, 6)}…${addr.slice(-4)}`, amount: amt, symbol: CHAINS[chain]?.symbol, usd: usd ? +(amt * usd).toFixed(2) : null })
          } catch (e) {
            out.push({ chain, error: e.message })
          }
        }
        return out
      }),
    ),
    tool(
      'list_wallet_transactions',
      "Recent incoming transactions to the user's own wallet on one chain — to check whether a follower's payment arrived.",
      { chain: z.enum(['eth', 'base', 'btc', 'sol']), max: z.number().int().min(1).max(25).optional().catch(undefined) },
      safe(async ({ chain, max = 10 }) => {
        const addr = wallets()[chain]
        if (!addr) throw new Error(`No ${chain} wallet in JARVIS_WALLETS.`)
        return recent(chain, addr, max)
      }),
    ),
    tool(
      'get_crypto_invoice',
      `A payment request for the user's OWN wallet (from JARVIS_WALLETS only): a wallet link and a
QR code image (put it on a blade or in a post). Optionally priced in fiat — converted at the live
rate. Use it to sell products or take tips in crypto. You cannot choose the address.`,
      {
        chain: z.enum(['eth', 'base', 'btc', 'sol']),
        amount: z.number().positive().optional().describe('Amount in the coin'),
        fiatAmount: z.number().positive().optional().describe('Price in fiat instead; converted live'),
        currency: z.string().optional(),
        label: z.string().max(60).optional().describe('What it is for, e.g. "Preset pack"'),
      },
      safe(async ({ chain, amount, fiatAmount, currency = 'usd', label }) => {
        const addr = wallets()[chain]
        if (!addr) throw new Error(`No ${chain} wallet in JARVIS_WALLETS.`)
        let amt = amount
        if (!amt && fiatAmount) {
          const id = CHAINS[chain].coingecko
          const px = (await getJson(`${CG}/simple/price?ids=${id}&vs_currencies=${currency}`))[id]?.[currency]
          if (!px) throw new Error('Could not get a live price to convert.')
          amt = +(fiatAmount / px).toPrecision(6)
        }
        const uri = CHAINS[chain].uri(addr, amt, label)
        const dir = join(workspace, 'payments')
        await mkdir(dir, { recursive: true })
        const qr = join(dir, `${chain}-${Date.now()}.png`)
        await QRCode.toFile(qr, uri, { width: 720, margin: 2 })
        return { chain, address: addr, amount: amt, symbol: CHAINS[chain].symbol, link: uri, qr }
      }),
    ),
  ]

  const writes = [
    tool(
      'create_nft_package',
      `Prepare a video or image as an NFT: copies the media and writes standard (ERC-721 / Metaplex
compatible) metadata into the workspace. If PINATA_JWT is set it is pinned to IPFS too. JARVIS
cannot mint — the user mints it from their own wallet on Zora, OpenSea Studio or Magic Eden
using the files and the steps returned.`,
      {
        path: z.string(),
        name: z.string().max(100),
        description: z.string().max(2000),
        attributes: z.array(z.object({ trait_type: z.string(), value: z.union([z.string(), z.number()]) })).optional(),
        edition: z.number().int().min(1).optional().describe('Planned edition size'),
        priceEth: z.number().positive().optional(),
      },
      safe(async ({ path, name, description, attributes = [], edition, priceEth }) => {
        const problem = checkPath(path)
        if (problem) throw new Error(problem)
        const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
        const dir = join(workspace, 'nft', `${Date.now()}-${s}`)
        await mkdir(dir, { recursive: true })
        const media = join(dir, `media${extname(path).toLowerCase()}`)
        await copyFile(path, media)
        const isVideo = ['.mp4', '.mov', '.webm'].includes(extname(path).toLowerCase())

        let mediaUri = basename(media)
        let metadataUri = null
        const jwt = process.env.PINATA_JWT
        const pin = async (blob, fname) => {
          const form = new FormData()
          form.set('file', blob, fname)
          const r = await getJson('https://api.pinata.cloud/pinning/pinFileToIPFS', { method: 'POST', headers: { authorization: `Bearer ${jwt}` }, body: form })
          return `ipfs://${r.IpfsHash}`
        }
        if (jwt) {
          const { readFile } = await import('node:fs/promises')
          mediaUri = await pin(new Blob([await readFile(media)]), basename(media))
        }
        const metadata = {
          name,
          description,
          [isVideo ? 'animation_url' : 'image']: mediaUri,
          attributes: [...attributes, ...(edition ? [{ trait_type: 'Edition size', value: edition }] : [])],
          properties: { files: [{ uri: mediaUri, type: isVideo ? 'video/mp4' : 'image/png' }], category: isVideo ? 'video' : 'image' },
        }
        const metaFile = join(dir, 'metadata.json')
        await writeFile(metaFile, JSON.stringify(metadata, null, 2))
        if (jwt) metadataUri = await pin(new Blob([JSON.stringify(metadata)], { type: 'application/json' }), 'metadata.json')
        return {
          folder: dir,
          media,
          metadata: metaFile,
          ipfs: jwt ? { media: mediaUri, metadata: metadataUri } : 'not pinned (set PINATA_JWT to pin to IPFS)',
          mintSteps: [
            'Open zora.co/create (Base, low fees) or opensea.io/studio and connect YOUR wallet.',
            `Upload ${basename(media)}, paste the name and description${priceEth ? `, set the price to ${priceEth} ETH` : ''}${edition ? `, edition size ${edition}` : ''}.`,
            'Review the fee and confirm in your wallet. Then share the mint link in your bio and posts.',
          ],
        }
      }),
    ),
  ]

  return createSdkMcpServer({
    name: 'jarvis_crypto',
    version: '1.0.0',
    instructions:
      "Crypto prices, the user's watch-only wallets, payment links to their own addresses, and NFT packages. " +
      'You hold no keys: you can never send, swap, trade or mint, and you never give investment advice.',
    alwaysLoad: true,
    tools: allowWrites ? [...reads, ...writes] : reads,
  })
}
