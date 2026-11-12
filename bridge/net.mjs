// The outbound side of the bridge, and the gate in front of it.
//
// This process — unlike a browser tab — can reach the user's LAN, their
// router's admin page and cloud metadata endpoints, and everything it fetches
// is fetched at a URL some model chose while reading the open web. So every
// outbound request goes through here, and here is an SSRF gate first and a
// fetch second.
//
// It lives in its own file because there are now two callers with genuinely
// different jobs — the media proxy that streams bytes to an <img> or <video>,
// and the page proxy that reads whole documents — and the one thing neither of
// them may be allowed to reimplement is the gate.
//
// Built on the low-level http/https clients rather than fetch() on purpose: it
// needs a per-connection DNS hook to stop rebinding, manual control of every
// redirect hop, and a body it can stream and cut off mid-flight.

import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { lookup as dnsLookup } from 'node:dns'
import { isIP } from 'node:net'

/** A redirect chain longer than this is a loop or a game, not a CDN. */
export const MAX_REDIRECTS = 4

/**
 * A perfectly ordinary desktop browser, which is the entire point: the hosts we
 * are fetching from serve placeholders to anything that looks automated, and a
 * thumbnail that 403s is the bug we are here to fix. No Referer is sent and the
 * browser's own cookies never come near this, so nothing about the user leaks
 * upstream beyond the fact that some machine asked for a public page.
 */
export const PROXY_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' +
  ' (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

/**
 * Hostnames refused before a packet moves.
 *
 * `.local` is mDNS — every printer, NAS and Home Assistant box on the network
 * answers to it — and `.internal` / `.home.arpa` are the same idea by
 * convention. These never name anything on the public web, so a request for one
 * is either confused or hostile.
 */
const BLOCKED_HOSTNAME = /(^|\.)(localhost|local|internal|intranet|home\.arpa)$/i

/**
 * Is this *resolved address* one the bridge must not connect to?
 *
 * The list is the usual suspects plus the ones people forget: 169.254.169.254
 * is the cloud metadata endpoint, 100.64/10 is carrier-grade NAT (and Tailscale
 * lives there), 0.0.0.0/8 and the v4-mapped v6 forms are the classic ways of
 * writing "localhost" that a naive string check waves straight through.
 */
export function blockedAddress(ip) {
  let addr = String(ip ?? '').toLowerCase().split('%')[0]
  // ::ffff:127.0.0.1 is loopback wearing a hat. Unwrap before judging.
  //
  // Worth knowing where this can and cannot fire. WHATWG URL parsing serialises
  // an IPv4-mapped literal into hex — new URL('http://[::ffff:127.0.0.1]/')
  // gives a hostname of [::ffff:7f00:1] — so a dotted-quad form never survives
  // to reach this branch from a parsed URL. It is still load-bearing for the
  // other caller: DNS answers arrive as strings in exactly this shape.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr)
  if (mapped) addr = mapped[1]

  if (addr.includes('.')) {
    const parts = addr.split('.').map(Number)
    if (parts.length !== 4) return true
    if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
    const [a, b] = parts
    if (a === 0) return true // 0.0.0.0/8 — "this network", routes to localhost
    if (a === 10) return true // 10/8
    if (a === 127) return true // loopback
    if (a === 169 && b === 254) return true // link-local AND cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
    if (a === 192 && b === 168) return true // 192.168/16
    if (a === 192 && b === 0) return true // 192.0.0/24 protocol assignments
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT / tailnets
    if (a === 198 && (b === 18 || b === 19)) return true // benchmarking range
    if (a >= 224) return true // multicast, reserved, broadcast
    return false
  }

  // The hex forms the parser actually produces, including the mapped range that
  // the dotted-quad unwrap above can never see.
  if (addr === '::' || addr === '::1') return true
  if (/^::ffff:/.test(addr)) {
    const hex = addr.slice(7).split(':')
    if (hex.length === 2) {
      const high = parseInt(hex[0], 16)
      const low = parseInt(hex[1], 16)
      if (Number.isFinite(high) && Number.isFinite(low)) {
        return blockedAddress(
          [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.'),
        )
      }
    }
    return true
  }
  if (/^f[cd]/.test(addr)) return true // fc00::/7 unique local
  if (/^fe[89ab]/.test(addr)) return true // fe80::/10 link-local
  if (/^ff/.test(addr)) return true // multicast
  return false
}

/**
 * The DNS hook every outbound socket goes through.
 *
 * Checking the address *after* resolving and then letting net.connect resolve
 * again would leave a rebinding window — the second answer is free to be
 * 127.0.0.1. So we resolve once here, refuse the whole name if ANY answer is
 * private, and hand the vetted address straight to the connect call, which then
 * does no lookup of its own. Strict on purpose: a public host that also
 * advertises a LAN address is not a host we need to be able to reach.
 */
export function guardedLookup(hostname, options, callback) {
  const opts = typeof options === 'function' ? {} : (options ?? {})
  const done = typeof options === 'function' ? options : callback
  dnsLookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return done(err)
    const list = Array.isArray(addresses) ? addresses : [addresses]
    if (!list.length) return done(new Error('no address'))
    for (const entry of list) {
      if (blockedAddress(entry.address)) {
        const blocked = new Error(
          `refusing ${hostname}: resolves to the private address ${entry.address}`,
        )
        blocked.code = 'EBLOCKEDADDRESS'
        return done(blocked)
      }
    }
    if (opts.all) return done(null, list)
    return done(null, list[0].address, list[0].family)
  })
}

/** An error carrying the status we want the browser to see. */
export function proxyError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

/**
 * Only absolute http(s) URLs, and only ones whose host isn't obviously local.
 * Returns a URL or throws a proxyError, so callers can treat parse failure and
 * policy failure the same way.
 */
export function vetTarget(raw) {
  let url
  try {
    url = new URL(String(raw ?? ''))
  } catch {
    throw proxyError(400, 'absolute http(s) url required')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw proxyError(400, 'absolute http(s) url required')
  }
  if (!url.hostname) throw proxyError(400, 'absolute http(s) url required')
  if (BLOCKED_HOSTNAME.test(url.hostname)) throw proxyError(403, 'blocked host')
  // An IP literal never reaches DNS in any meaningful sense, so judge it here —
  // this is what turns http://127.0.0.1:8787/health into a refusal before a
  // socket is opened rather than after.
  const literal = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(literal) && blockedAddress(literal)) {
    throw proxyError(403, 'blocked host')
  }
  return url
}

/** One hop. Resolves with the IncomingMessage once headers are in. */
export function requestOnce(url, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'GET',
      headers,
      // The SSRF gate. Everything else here is plumbing.
      lookup: guardedLookup,
    })
    // Two different clocks, deliberately. This one is the deadline for getting
    // headers back at all — a host that accepts the connection and then says
    // nothing must not hold a panel open for ever.
    const deadline = setTimeout(() => {
      req.destroy(proxyError(504, 'upstream timed out'))
    }, timeoutMs)
    // And this one is idle-socket: once the body is flowing, a 200 MB video is
    // allowed to take longer than 30 seconds as long as bytes keep arriving.
    req.setTimeout(timeoutMs, () => {
      req.destroy(proxyError(504, 'upstream stalled'))
    })
    req.on('response', (res) => {
      clearTimeout(deadline)
      resolve(res)
    })
    req.on('error', (err) => {
      clearTimeout(deadline)
      reject(
        err.code === 'EBLOCKEDADDRESS'
          ? proxyError(403, 'blocked host')
          : err.status
            ? err
            : proxyError(502, 'upstream unreachable'),
      )
    })
    req.end()
  })
}

/**
 * Follow redirects by hand rather than letting a client library do it, because
 * every hop has to be vetted again: a public URL that 302s to
 * http://169.254.169.254/ is the whole SSRF attack, and a redirect to
 * file:// or data: is the other half of it.
 */
/**
 * A second test for each redirect hop, set by the bridge to the leak guard's
 * rule (see redirectBlocked in guard.mjs). Returns why a hop may not be
 * followed, or null. Kept as a hook so this module stays free of sessions.
 */
let hopCheck = () => null
export const setRedirectCheck = (fn) => {
  hopCheck = typeof fn === 'function' ? fn : () => null
}

export async function openRemote(startUrl, headers, timeoutMs) {
  let url = startUrl
  for (let hop = 0; ; hop++) {
    const res = await requestOnce(url, headers, timeoutMs)
    const status = res.statusCode ?? 0
    const location = res.headers.location
    if (status >= 300 && status < 400 && location) {
      res.resume() // drain, or the socket never returns to the pool
      if (hop >= MAX_REDIRECTS) throw proxyError(502, 'too many redirects')
      let next
      try {
        next = new URL(location, url)
      } catch {
        throw proxyError(502, 'bad redirect')
      }
      // vetTarget re-runs the scheme and host checks; guardedLookup re-runs the
      // address check when the next hop connects; hopCheck re-runs the leak
      // guard, so a redirect cannot reach a site the user has not approved.
      const vetted = vetTarget(next.href)
      const refused = hopCheck(String(url), String(vetted))
      if (refused) throw proxyError(403, refused)
      url = vetted
      continue
    }
    return { res, url }
  }
}

/**
 * Read a whole response as text, with a hard cap.
 *
 * Separate from the streaming proxy because a document is not media: we need
 * all of it in hand before we can rewrite it, and a page that will not fit in
 * the cap is one we should decline rather than truncate — half an HTML document
 * parses into something arbitrary.
 */
export async function fetchText(url, { maxBytes, timeoutMs, accept }) {
  const target = vetTarget(url)
  const { res, url: finalUrl } = await openRemote(
    target,
    {
      'user-agent': PROXY_UA,
      accept: accept ?? 'text/html,application/xhtml+xml,*/*;q=0.8',
      'accept-language': 'en-GB,en;q=0.9',
      'accept-encoding': 'identity',
    },
    timeoutMs,
  )

  const status = res.statusCode ?? 0
  const type = String(res.headers['content-type'] ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase()

  if (status !== 200) {
    res.resume()
    throw proxyError(status === 404 ? 404 : 502, `upstream said ${status}`)
  }

  const chunks = []
  let size = 0
  for await (const chunk of res) {
    size += chunk.length
    if (size > maxBytes) {
      res.destroy()
      throw proxyError(413, 'page too large')
    }
    chunks.push(chunk)
  }

  // Character set matters more here than anywhere else in the bridge: a page
  // decoded as UTF-8 when it is really windows-1252 turns every quotation mark
  // in the article into a replacement glyph, which looks like our bug.
  const raw = Buffer.concat(chunks)
  const declared = /charset=["']?([\w-]+)/i.exec(String(res.headers['content-type'] ?? ''))
  const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(raw.subarray(0, 4096).toString('latin1'))
  const charset = (declared?.[1] ?? meta?.[1] ?? 'utf-8').toLowerCase()
  let text
  try {
    text = new TextDecoder(charset).decode(raw)
  } catch {
    text = raw.toString('utf8')
  }

  return { text, type, url: finalUrl.href, headers: res.headers, bytes: size }
}

/**
 * Headers only, for deciding what a URL *is* before committing to fetching it.
 *
 * Sent as a GET rather than a HEAD, and immediately abandoned: a surprising
 * share of the web answers HEAD with 405, or with headers that disagree with
 * what a real GET would return, and being wrong about the content type is the
 * entire failure this is here to prevent.
 */
export async function peek(url, { timeoutMs }) {
  const target = vetTarget(url)
  const { res, url: finalUrl } = await openRemote(
    target,
    { 'user-agent': PROXY_UA, accept: '*/*', 'accept-encoding': 'identity' },
    timeoutMs,
  )
  const out = {
    status: res.statusCode ?? 0,
    type: String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase(),
    bytes: Number(res.headers['content-length']) || null,
    headers: res.headers,
    url: finalUrl.href,
  }
  res.destroy()
  return out
}
