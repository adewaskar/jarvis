import DOMPurify from 'dompurify'
import { BRIDGE_HTTP_URL } from '../config'

/**
 * The safety boundary for model-authored markup.
 *
 * Everything JARVIS composes for the screen passes through here — panel bodies
 * and blade markup alike. It lives in its own file so there is exactly one
 * implementation of these rules: a second surface that rendered model HTML with
 * its own slightly different allowlist would be a hole with a changelog.
 *
 * The markup is treated as untrusted, and it genuinely is: it is written by a
 * model that has, moments earlier, been reading pages off the open web.
 */

/**
 * Paths that are genuinely on this machine's disk, as opposed to app-relative
 * URLs that happen to start with a slash. `/vite.svg` is one of our own static
 * assets; `/Users/you/shot.png` is a screenshot JARVIS just took.
 */
const DISK_PATH =
  /^\/(Users|home|root|Volumes|Applications|System|Library|private|tmp|var|opt|mnt|media|srv|data)\//

/**
 * Every media URL is rewritten to point at the bridge. Two destinations, for
 * different reasons.
 *
 * `/file` — a page served over http can't load `file:///…`, and the interesting
 * images (phone screenshots, generated art) land on disk as absolute paths.
 *
 * Only real disk paths qualify. Rewriting every src beginning with a slash also
 * caught the app's own assets, so `<img src="/vite.svg">` turned into a read of
 * `/vite.svg` on the host, 404'd, and rendered as 'image unavailable'.
 *
 * `/img` and `/media` — remote http(s) sources, proxied rather than refused. The
 * browser still only ever talks to localhost, which is what lets the page CSP
 * stay closed and stops markup that summarises an untrusted web page from
 * beaconing this machine's address to a host the model was told to use. It also
 * gets the bytes at all: news sites and image CDNs routinely block hotlinking.
 *
 * data:, blob: and app-relative URLs are left exactly as they are — nothing
 * leaves the page for those, so there is nothing to proxy.
 */
function rewriteSrc(el: Element, attr: 'src' | 'poster', route: 'img' | 'media') {
  const raw = el.getAttribute(attr) ?? ''
  if (!raw) return

  const path = raw.replace(/^file:\/\//, '')
  if (DISK_PATH.test(path)) {
    el.setAttribute(attr, `${BRIDGE_HTTP_URL}/file?path=${encodeURIComponent(path)}`)
    return
  }

  if (!/^https?:\/\//i.test(raw)) return
  // Already ours. Proxying the proxy would ask the bridge to fetch itself.
  if (raw.startsWith(`${BRIDGE_HTTP_URL}/`)) return
  el.setAttribute(attr, `${BRIDGE_HTTP_URL}/${route}?url=${encodeURIComponent(raw)}`)
}

function rewriteMedia(root: Element) {
  root.querySelectorAll('img').forEach((img) => rewriteSrc(img, 'src', 'img'))
  root.querySelectorAll('video').forEach((video) => {
    rewriteSrc(video, 'src', 'media')
    // The poster is a still, so it goes down the image route and gets that
    // route's tighter size cap and content-type check.
    rewriteSrc(video, 'poster', 'img')
  })
  // A <source> is only reachable inside <video> here, but its `type` is the
  // model's own declaration of what it is — honour it, so an image-typed source
  // isn't sent to an endpoint that will refuse it for the wrong content-type.
  root.querySelectorAll('source').forEach((source) => {
    const type = source.getAttribute('type') ?? ''
    rewriteSrc(source, 'src', /^image\//i.test(type) ? 'img' : 'media')
  })
}

/**
 * The only iframe destinations that exist. An iframe is the one way to play a
 * YouTube or Vimeo result inline — they will not hand over the media file — so
 * these three load direct rather than through the proxy, and the trade is that
 * the host list is closed and the paths are pinned. Everything else is removed
 * outright; there is no proxying an embed and no unknown host worth framing.
 */
const EMBED_HOSTS: Record<string, RegExp> = {
  'www.youtube-nocookie.com': /^\/embed\/[\w-]+/,
  'www.youtube.com': /^\/embed\/[\w-]+/,
  'player.vimeo.com': /^\/video\/\d+/,
}

/** Eleven characters in practice; bounded rather than exact, in case that moves. */
const YT_ID = /^[\w-]{6,20}$/

/**
 * Search results hand back `youtube.com/watch?v=ID` and `youtu.be/ID`, so that
 * is what the model writes. Rejecting those would mean showing nothing — rewrite
 * them into the cookieless embed form instead.
 */
function toEmbedUrl(url: URL): URL | null {
  const host = url.hostname.toLowerCase().replace(/^(?:www|m|music)\./, '')
  let id = ''
  if (host === 'youtube.com' && url.pathname === '/watch') id = url.searchParams.get('v') ?? ''
  else if (host === 'youtu.be') id = url.pathname.slice(1)
  if (!YT_ID.test(id)) return null
  return new URL(`https://www.youtube-nocookie.com/embed/${id}`)
}

function rewriteEmbeds(root: Element) {
  root.querySelectorAll('iframe').forEach((frame) => {
    let url: URL
    try {
      // Resolved against the page so a relative or protocol-relative src can't
      // slip past the host test by never being parsed at all.
      url = new URL(frame.getAttribute('src') ?? '', document.baseURI)
    } catch {
      frame.remove()
      return
    }
    const embed = toEmbedUrl(url) ?? url
    const path = EMBED_HOSTS[embed.hostname.toLowerCase()]
    if (!path || !path.test(embed.pathname)) {
      frame.remove()
      return
    }
    // Pinned rather than merely permitted: the host is known-good, so an http
    // embed is upgraded instead of dropped.
    embed.protocol = 'https:'
    frame.setAttribute('src', embed.toString())
  })
}

/**
 * Powerful features an embed may ask for. Everything a video player needs and
 * nothing that reaches the room the user is sitting in: `camera`, `microphone`,
 * `geolocation` and `display-capture` are the interesting omissions. The host is
 * allowlisted, but the `allow` attribute is written by the model, and a panel
 * summarising a hostile page should not be able to hand a frame the webcam —
 * even one YouTube would never use, because the prompt alone is the attack.
 */
const EMBED_FEATURES = new Set([
  'accelerometer', 'autoplay', 'clipboard-write', 'encrypted-media',
  'fullscreen', 'gyroscope', 'picture-in-picture', 'web-share',
])

/**
 * Attributes the model is not required to remember, and one it is not trusted
 * to choose.
 *
 * `referrerpolicy` because a proxied fetch already hides the user from the
 * origin server. The embeds are the exception: by this point every iframe left
 * is an allowlisted YouTube or Vimeo player, and those refuse to play without a
 * referrer — YouTube's "Error 153". They get the origin and nothing more.
 *
 * The three video attributes because a <video> without `controls` is a still
 * frame the user cannot start, and on iOS one without `playsinline` hijacks the
 * whole screen the moment it plays. `preload="metadata"` keeps a panel with
 * several clips on it from pulling megabytes nobody asked for.
 */
function hardenMedia(root: Element) {
  root.querySelectorAll('img, video').forEach((el) => {
    el.setAttribute('referrerpolicy', 'no-referrer')
  })
  root.querySelectorAll('iframe').forEach((el) => {
    el.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
  })

  root.querySelectorAll('video').forEach((video) => {
    video.setAttribute('controls', '')
    video.setAttribute('preload', 'metadata')
    video.setAttribute('playsinline', '')
  })

  root.querySelectorAll('iframe[allow]').forEach((frame) => {
    // Each entry is a feature name optionally followed by an origin list. The
    // name is kept and the origin list dropped, which leaves the feature scoped
    // to the frame's own origin — the default, and the only one wanted here.
    const kept = (frame.getAttribute('allow') ?? '')
      .split(';')
      .map((part) => part.trim().split(/\s+/)[0].toLowerCase())
      .filter((feature) => EMBED_FEATURES.has(feature))
    if (kept.length) frame.setAttribute('allow', kept.join('; '))
    else frame.removeAttribute('allow')
  })
}

/**
 * The whole design-system vocabulary, and the only class names allowed to
 * survive. This has to be an allowlist rather than a `hud-` prefix test, and it
 * has to exist at all: `class` carries no URI, so DOMPurify never looks at its
 * value, and this stylesheet contains full-screen classes — `.ignition` and
 * `.boot` are both position:fixed, inset:0, opaque, above everything — so one
 * stray class token in model output blacks out the entire interface. `.hud-top`
 * and `.hud-bottom` are the same trap with a matching prefix, which is the
 * second reason a prefix test would not do.
 *
 * Kept in step with the list in the `display` tool description
 * (bridge/panels.mjs). A name there that is missing here is silently stripped,
 * which is the failure mode we want but not one the model can diagnose.
 */
const ALLOWED_CLASSES = new Set([
  'hud-rows', 'hud-row', 'hud-idx', 'hud-main', 'hud-label', 'hud-sub',
  'hud-tag', 'hud-metric', 'hud-unit', 'hud-note', 'hud-img', 'hud-caption',
  'hud-grid', 'hud-bar', 'hud-dim', 'hud-hot',
  'hud-gallery', 'hud-thumb', 'hud-video', 'hud-embed', 'hud-figure',
])

function narrowClasses(root: Element) {
  root.querySelectorAll('[class]').forEach((el) => {
    const kept = (el.getAttribute('class') ?? '')
      .split(/\s+/)
      .filter((c) => ALLOWED_CLASSES.has(c))
    if (kept.length) el.setAttribute('class', kept.join(' '))
    else el.removeAttribute('class')
  })
}

/**
 * Scripts, event handlers and styles are stripped; what survives is layout,
 * text and media, with every remote source pointed back at the bridge.
 */
export function sanitisePanelHtml(html: string): string {
  const doc = new DOMParser().parseFromString(
    DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [
        'div', 'span', 'p', 'ul', 'ol', 'li', 'img', 'b', 'strong', 'em', 'i',
        'br', 'small', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'code', 'pre',
        // Showing a video result as a line of text was the polite version of
        // refusing to answer.
        'video', 'source', 'iframe',
      ],
      // No href — a HUD panel isn't clickable, and it keeps navigation off the
      // table entirely.
      ALLOWED_ATTR: [
        'class', 'src', 'alt', 'style',
        'controls', 'poster', 'loop', 'muted', 'playsinline', 'preload',
        'width', 'height', 'allow', 'allowfullscreen', 'referrerpolicy',
        'type', 'title',
      ],
      // Attributes that are not URLs and must not be judged as if they were.
      //
      // DOMPurify tests ALLOWED_URI_REGEXP against the value of *every*
      // attribute, not only the ones that carry a URI — anything not on its
      // inert list has to look like a permitted URL or it is dropped. Its own
      // default regexp ends in a catch-all for values that aren't scheme-shaped,
      // so this never shows up until you tighten the regexp, and then it bites:
      // with the list below removed, `type="video/mp4"` disappears off every
      // <source>, `width` and `height` off every embed. `src` and `poster` are
      // deliberately absent — those are real URLs and stay under the regexp.
      ADD_URI_SAFE_ATTR: [
        'controls', 'loop', 'muted', 'playsinline', 'preload', 'width',
        'height', 'allow', 'allowfullscreen', 'referrerpolicy', 'type',
      ],
      // http(s) is permitted here and then immediately taken away again:
      // rewriteMedia below turns every remote src into a bridge URL, so nothing
      // that survives this function actually points off the machine except an
      // allowlisted embed. Supplying ALLOWED_TAGS/ALLOWED_ATTR replaces
      // DOMPurify's defaults wholesale, so there is deliberately no FORBID_*
      // list here — one would read as defence in depth while doing nothing.
      ALLOWED_URI_REGEXP: /^(?:data:(?:image|video|audio)\/|file:\/\/|https?:\/\/|\/)/i,
    }),
    'text/html',
  )
  /**
   * `style` survives only for the --v custom property the progress bar uses.
   *
   * This narrowing is load-bearing security, not tidying up. DOMPurify performs
   * no CSS parsing whatsoever: `style` is one of its DEFAULT_URI_SAFE_ATTRIBUTES,
   * so it short-circuits before ALLOWED_URI_REGEXP is ever consulted and the
   * declaration block passes through verbatim. Delete this and
   * `style="position:fixed;inset:0;z-index:9999"` renders exactly as written.
   */
  doc.body.querySelectorAll('[style]').forEach((el) => {
    const style = el.getAttribute('style') ?? ''
    const v = /--v:\s*([\d.]+)/.exec(style)
    if (v) el.setAttribute('style', `--v:${v[1]}`)
    else el.removeAttribute('style')
  })
  narrowClasses(doc.body)
  // Order matters: rewriteEmbeds runs before hardenMedia so an iframe that is
  // about to be removed is never dressed up first, and both run after
  // narrowClasses so a dropped element takes its classes with it.
  rewriteMedia(doc.body)
  rewriteEmbeds(doc.body)
  hardenMedia(doc.body)
  return doc.body.innerHTML
}
