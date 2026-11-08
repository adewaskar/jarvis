import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { probeUrl } from './page.mjs'

/**
 * The `display` tool — JARVIS's screen.
 *
 * Rather than filling in a fixed set of card templates, the model authors the
 * panel itself: markup, layout, emphasis, and which animation it arrives with.
 * A search result and a phone screenshot and a revenue figure should not look
 * like the same component with different words in it, and only the thing
 * composing the answer knows what the answer wants to look like.
 *
 * What's fixed is the design system below, so everything it builds still looks
 * like one interface. The browser sanitises the markup before it renders.
 *
 * It runs in-process (an SDK MCP server, not a subprocess), so the handler
 * pushes straight down the open WebSocket — no round trip, no temp file.
 */

const DESIGN_SYSTEM = `
LAYOUT CLASSES — compose these, and use NOTHING else. The renderer strips any
class name that is not on this list, so an invented one silently loses its
styling and the row lands as unformatted text.
  .hud-rows            vertical list container
  .hud-row             one row: put .hud-idx, .hud-main, .hud-tag inside
  .hud-idx             leading index or glyph, dim and monospaced
  .hud-main            the row's text column
  .hud-label           primary line (clamped to 2 lines)
  .hud-sub             secondary line, dimmed
  .hud-tag             small trailing tag, right-aligned
  .hud-metric          huge numeral, for a single headline figure
  .hud-unit            small caption under a metric
  .hud-note            a short passage of prose
  .hud-img             full-width image (use a plain <img> inside)
  .hud-caption         one line under an image
  .hud-grid            two-column grid
  .hud-bar             thin progress bar; set style="--v:0.62" for 62%
  .hud-dim             de-emphasise anything
  .hud-hot             emphasise anything (picks up the accent colour)
  .hud-gallery         grid container for several images at once
  .hud-thumb           one thumbnail, inside a .hud-gallery or beside a .hud-row
  .hud-video           a <video> player, full width of the panel
  .hud-embed           16:9 wrapper for an <iframe>; put the iframe inside it
  .hud-figure          an image or video with its .hud-caption grouped beneath

PICTURES AND VIDEO — these work. Use them.
  - Images from the web render. Image-search results, article thumbnails,
    photographs, product shots, chart images: paste the URL exactly as the tool
    result gave it and it appears. The bridge fetches every remote image
    server-side and hands the bytes to the display, so hosts that refuse to be
    hotlinked still render — nothing is loaded by the page itself.
  - Images off this machine work the same way: a render you generated, a
    screenshot you took, any file on disk. Give it as file:///absolute/path or
    a bare absolute path.
  - If a search came back with pictures, SHOW the pictures. A row of thumbnails
    down the side of the headlines beats headlines alone, every time — and a
    grid of results is the whole answer to an image search, not a decoration
    on it.
  - Video results are for playing, not describing. A YouTube or Vimeo result
    goes in an <iframe> inside .hud-embed; a direct .mp4 or .webm goes in a
    <video class="hud-video" controls>.
  - Never invent a URL. Use only ones that appeared verbatim in a tool result.
    A guessed address is a broken image, and a broken image is worse than none.

WHERE THE CONTENT COMES FROM — read this before showing anything from the web.
  - Fetch with exa. crawling_exa and web_fetch_exa return the page's actual
    text and its image URLs; deep_search_exa and web_search_advanced_exa
    return content alongside the results. That returned content is what you
    render — rewritten into these classes, in your own words and this interface's
    shape. You are not linking to an article, you are showing it.
  - Do NOT put a bare source URL on screen and leave the page to fetch it for
    itself. Half the web refuses that: news CDNs answer 403 to anything that
    is not their own page, and the panel renders as an empty rectangle. Going
    through exa is what makes the difference between an article appearing and a
    blank card.
  - So: asked about a page, crawl it, then panel the substance — the headline,
    the two or three lines that matter, the figure, the photograph.
  - Image URLs that came back IN a tool result are real and will render; the
    bridge fetches them server-side. An image URL you inferred or assembled
    yourself will not. Never guess one.

RULES
  - No inline colours. The accent is themed by the 'accent' argument; use the
    classes and it follows automatically.
  - No <style>, <script>, <form>, or event handlers. They are stripped.
  - <iframe> is allowed for exactly three hosts: www.youtube-nocookie.com/embed,
    www.youtube.com/embed and player.vimeo.com/video. Any other src and the
    whole element is removed. A youtube.com/watch?v=ID or youtu.be/ID link is
    fine to paste — it is rewritten into the embed form for you.
  - Every panel must have visible text or a working image. An empty body is
    rejected outright — a blank card reads as a broken interface.
  - Keep it to roughly 6 rows or 40 words. This is a heads-up display glanced at
    while listening, not a document. Four thumbnails in a gallery, six at the
    outside; one video, never two.

EXAMPLES

Search results:
<div class="hud-rows">
  <div class="hud-row"><span class="hud-idx">01</span><span class="hud-main"><span class="hud-label">Anthropic ships Claude Opus 5</span><span class="hud-sub">A step change on agentic coding</span></span><span class="hud-tag">reuters</span></div>
  <div class="hud-row"><span class="hud-idx">02</span><span class="hud-main"><span class="hud-label">OpenAI responds within the week</span></span><span class="hud-tag">verge</span></div>
</div>

A single figure:
<div><span class="hud-metric">1,284</span><span class="hud-unit">unread since monday</span></div>

An image:
<div><img class="hud-img" src="file:///Users/you/shot.png"><span class="hud-caption">Home screen, 9:41</span></div>

Image search results — the pictures ARE the answer, so lead with them:
<div class="hud-figure">
  <div class="hud-gallery">
    <img class="hud-thumb" src="https://images.example.com/sr71-01.jpg">
    <img class="hud-thumb" src="https://cdn.example.org/blackbird-takeoff.jpg">
    <img class="hud-thumb" src="https://static.example.net/sr71-cockpit.jpg">
    <img class="hud-thumb" src="https://images.example.com/sr71-hangar.jpg">
  </div>
  <span class="hud-caption">SR-71 Blackbird · four of two hundred results</span>
</div>

Headlines with their thumbnails:
<div class="hud-rows">
  <div class="hud-row"><img class="hud-thumb" src="https://cdn.example.com/launch.jpg"><span class="hud-main"><span class="hud-label">Starship clears the tower on the eleventh flight</span><span class="hud-sub">Booster caught, ship lost on re-entry</span></span><span class="hud-tag">reuters</span></div>
  <div class="hud-row"><img class="hud-thumb" src="https://cdn.example.org/pad.jpg"><span class="hud-main"><span class="hud-label">Pad damage limited to the flame trench</span></span><span class="hud-tag">ars</span></div>
</div>

A video result — embedded and playable:
<div class="hud-figure">
  <div class="hud-embed"><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" title="Flight 11, full replay" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
  <span class="hud-caption">SpaceX · 4:32</span>
</div>

A direct video file:
<video class="hud-video" controls playsinline preload="metadata" poster="https://cdn.example.com/still.jpg"><source src="https://cdn.example.com/clip.mp4" type="video/mp4"></video>

A short readout:
<p class="hud-note">Three of the four services are nominal. <span class="hud-hot">Vercel is degraded</span> in eu-west.</p>
`.trim()

const schema = {
  title: z
    .string()
    .describe('Short heading for the panel, two to four words. e.g. "SEARCH RESULTS", "INBOX".'),
  html: z
    .string()
    .describe(
      'The panel body as an HTML fragment, composed using the design system in ' +
        'this tool description. Author it for the specific content — a list, an ' +
        'image, a number and a caption, whatever fits.',
    ),
  anim: z
    .enum(['materialise', 'sweep', 'unfold', 'stagger', 'snap'])
    .default('materialise')
    .describe(
      'How it arrives. materialise = scan-wipe reveal, the default. ' +
        'sweep = slides in from the edge, good for results. ' +
        'unfold = expands vertically, good for images. ' +
        'stagger = children land one after another, good for lists. ' +
        'snap = instant with a flicker, good for alerts and single figures.',
    ),
  slot: z
    .enum(['right', 'left', 'wide'])
    .default('right')
    .describe(
      'Where it sits. right = the default stack beside the reactor. ' +
        'left = the opposite side, for a second simultaneous panel. ' +
        'wide = a broader card under the reactor, for images or dense tables.',
    ),
  accent: z
    .enum(['default', 'amber', 'violet', 'green', 'red'])
    .default('default')
    .describe(
      'Colour identity. default = the interface cyan. amber = caution or ' +
        'pending. violet = generated or synthetic content. green = confirmed ' +
        'or healthy. red = failure or alert. Use it meaningfully, not decoratively.',
    ),
  hold: z
    .enum(['turn', 'sticky'])
    .default('turn')
    .describe(
      'turn = clears when the user next speaks, the default. ' +
        'sticky = stays until replaced; use only when the user will refer back to it.',
    ),
}

const DESCRIPTION = `Put something on the JARVIS heads-up display.

You are designing the panel, not filling in a template — compose the markup for
the content at hand and choose the animation, position and colour that suit it.

Use it whenever the answer has substance worth seeing rather than hearing:
search results, images, screenshots, lists of mail or events, a figure, a short
readout. If you searched, show the results. If you generated an image, show it.
If you looked at the phone, show the screenshot.

If the search came back with pictures, show the pictures — thumbnails from the
web render properly here, and describing an image you are holding the URL of is
a worse answer than putting it on the screen. If it came back with a video,
embed it so it plays.

Call it BEFORE or WHILE you speak, so the panel is up as you start talking.
Never read a panel aloud — say what it means, not what it contains. Speaking
stays one or two sentences even when the panel is dense.

${DESIGN_SYSTEM}`

/**
 * Panel ids are React keys and they arrive in bursts, so `Date.now()` alone
 * collides. A random suffix looked like it solved that but was written
 * unpadded, so `p1700000000001` (from suffix 1) and `p170000000000` + `1`
 * are the same string. A counter is simply unique.
 */
let seq = 0

// ---------------------------------------------------------------------------
// Blades
// ---------------------------------------------------------------------------

const BLADE_DESCRIPTION = `Open something on the blades — the big surface.

A panel is a card you glance at. A blade is a thing you LOOK at: a photograph
worth seeing properly, an article worth reading, a video worth watching. Blades
stack, the newest in front, and the user can pull an older one forward or throw
one to full screen. Use a blade whenever the content deserves the frame, and a
panel when it deserves a line.

Choosing what to open:
  article — a web page. \`mode: "reader"\` strips it to the words and restyles
            them into this interface: always legible, ignores whether the site
            allows being embedded. \`mode: "live"\` shows the real page, which is
            right when the layout carries meaning — a dashboard, a profile, a
            table, a chart. Both are fetched by the bridge and served locally,
            so sites that block embedding still open.
  image   — one picture, full width of the blade.
  gallery — several pictures at once. This is the answer to an image search.
  video   — a direct .mp4/.webm file.
  embed   — a YouTube or Vimeo watch URL. It is turned into a player.
  markup  — your own composed HTML, in the same .hud-* system the display tool
            uses, when none of the above is the shape of the answer.
  camera  — the live view from the user's camera, on screen. Open it when they
            ask to see the camera, or when they want you to watch them do
            something: while it is open you can also review the seconds that
            have just passed, which you cannot do otherwise. Needs no url.

Size is about reading, not decoration. \`tall\` is a reading column — use it for
any article the user intends to actually read. \`wide\` suits images, video and
tables. \`full\` takes the screen and should be reserved for the moment the
content IS the answer. \`compact\` is a thumbnail that stays out of the way.

Call \`probe_url\` first when you are not certain what a URL is. Do not guess
from the file extension — image CDNs routinely serve pictures from URLs with no
extension, and a link that looks like a video is usually a page about one.

Never open a blade the user did not ask for and does not need. One blade that
answers the question beats three that surround it.`

const bladeSchema = {
  title: z
    .string()
    .describe('Two to four words naming what this is, e.g. "REUTERS" or "MARK VII".'),
  kind: z
    .enum(['article', 'image', 'gallery', 'video', 'embed', 'markup', 'camera'])
    .describe('What is being opened. See the tool description.'),
  url: z
    .string()
    .optional()
    .catch(undefined)
    .describe(
      'The address, for article / image / video / embed. Use a URL that ' +
        'appeared verbatim in a tool result — never one you assembled yourself.',
    ),
  images: z
    .array(z.string())
    .optional()
    .catch(undefined)
    .describe('Image URLs, for kind "gallery". Four is a good number, eight the most.'),
  html: z
    .string()
    .optional()
    .catch(undefined)
    .describe('Your own markup, for kind "markup", in the .hud-* design system.'),
  mode: z
    .enum(['reader', 'live'])
    .optional()
    .catch(undefined)
    .describe('For kind "article": reader = the words restyled, live = the real page.'),
  size: z
    .enum(['compact', 'tall', 'wide', 'full'])
    .optional()
    .catch(undefined)
    .describe('tall = a reading column. wide = pictures and tables. full = the screen.'),
  hold: z
    .enum(['turn', 'sticky'])
    .optional()
    .catch(undefined)
    .describe('turn = closes when the user next speaks. sticky = stays until replaced.'),
}

const PROBE_DESCRIPTION = `Find out what is actually at a URL before showing it.

Returns what it is, whether it can be reached at all, and — for a web page —
its title, how much readable prose it holds, and a lead image if it has one.

Worth calling whenever you are about to put something on screen and are not
certain of it. The failure this avoids is the visible kind: a blade that opens
onto a blank rectangle because the link was a consent wall, or an image that
turns out to be an HTML page, in front of the user, while you describe it as
though it worked.

It reports a \`suggestion\`. That is advice from something that has only seen
the bytes — it does not know whether the user asked to read this or merely to
see it, what is already on screen, or whether the point was the picture or the
argument. You know those things. Overrule it whenever you have reason to.`

/**
 * @param {(panel: object) => void} emit - pushes the panel to the browser
 * @param {(blade: object) => void} emitBlade - pushes a blade to the browser
 */
/**
 * The blade tool without the live camera view, for when the camera is switched
 * off (JARVIS_DISABLE=camera). Leaving the kind in would let a blade turn on the
 * very camera the user switched off.
 */
const CAMERA_BLADE =
  /  camera  — the live view from the user's camera[\s\S]*?Needs no url\.\n/
const NO_CAMERA_DESCRIPTION = BLADE_DESCRIPTION.replace(CAMERA_BLADE, '')
const noCameraSchema = {
  ...bladeSchema,
  kind: z
    .enum(['article', 'image', 'gallery', 'video', 'embed', 'markup'])
    .describe('What is being opened. See the tool description.'),
}

export function displayServer(emit, emitBlade, { camera = true } = {}) {
  return createSdkMcpServer({
    name: 'jarvis',
    version: '1.0.0',
    instructions:
      'The JARVIS heads-up display. Use `display` to put content on screen ' +
      'alongside what you say.',
    // Never defer this behind tool search — if the model has to go looking for
    // it, it won't occur to it to show anything.
    alwaysLoad: true,
    tools: [
      tool('display', DESCRIPTION, schema, async (args) => {
        // Refuse rather than warn. Emitting anyway put a blank card on screen
        // and told the model nothing, so it had no reason to try again; handed
        // back as an error it gets one more go with actual content in it.
        //
        // The media test counts video and iframe as well as img, because a
        // panel whose whole point is a playable result carries no text at all —
        // rejecting it would refuse the one thing this tool was just taught to
        // do. <source> counts too: a <video> is often written with its src on
        // the child element rather than the parent.
        const text = String(args.html ?? '').replace(/<[^>]*>/g, '').trim()
        if (!text && !/<(img|video|iframe|source)\b/i.test(args.html ?? '')) {
          console.warn('[jarvis] display called with an empty body:', args.title)
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text:
                  'Not shown: the panel body was empty. A panel needs visible ' +
                  'text or an image — call display again with the content ' +
                  'composed into the html argument.',
              },
            ],
          }
        }
        /**
         * Composed markup opens as a blade, not as a card.
         *
         * There is one surface now. A second place for things to appear meant
         * the user had two places to look and the model had a decision to make
         * every time it wanted to show something — and it made that decision
         * on grounds it could not possibly know, since only the person looking
         * at the screen knows whether they are glancing or reading.
         *
         * The tool keeps its name and its design system because the model is
         * fluent in both; only where the result lands has changed.
         */
        emitBlade({
          id: `p${Date.now().toString(36)}-${(seq++).toString(36)}`,
          title: String(args.title ?? '').trim() || 'DISPLAY',
          kind: 'markup',
          html: args.html,
          size: args.slot === 'wide' ? 'wide' : 'compact',
          hold: args.hold ?? 'turn',
        })
        return { content: [{ type: 'text', text: 'On screen.' }] }
      }),

      tool(
        'blade',
        camera ? BLADE_DESCRIPTION : NO_CAMERA_DESCRIPTION,
        camera ? bladeSchema : noCameraSchema,
        async (args) => {
        const kind = args.kind
        const url = String(args.url ?? '').trim()
        const images = Array.isArray(args.images) ? args.images.filter(Boolean) : []

        // Refused rather than emitted, for the same reason the display tool
        // refuses an empty body: a blade that opens onto nothing looks like the
        // interface failing, and the model gets no signal to try again.
        if (kind === 'gallery' && !images.length) {
          return refuse('Not opened: a gallery needs at least one image URL in `images`.')
        }
        if (kind === 'markup' && !String(args.html ?? '').trim()) {
          return refuse('Not opened: kind "markup" needs an `html` body.')
        }
        if (['article', 'image', 'video', 'embed'].includes(kind) && !url) {
          return refuse(`Not opened: kind "${kind}" needs a \`url\`.`)
        }

        const blade = {
          id: `b${Date.now().toString(36)}-${(seq++).toString(36)}`,
          title: String(args.title ?? '').trim() || 'DISPLAY',
          kind,
          url: url || undefined,
          images: images.length ? images.slice(0, 8) : undefined,
          html: args.html || undefined,
          mode: args.mode ?? 'reader',
          // A reading column for anything meant to be read, a broad frame for
          // anything meant to be looked at. Getting this wrong is the difference
          // between an article you can follow and one in a letterbox.
          size: args.size ?? (kind === 'article' ? 'tall' : 'wide'),
          hold: args.hold ?? 'turn',
        }
        emitBlade(blade)
        return { content: [{ type: 'text', text: `Open on the blades as "${blade.title}".` }] }
      }),

      tool(
        'probe_url',
        PROBE_DESCRIPTION,
        { url: z.string().describe('The absolute URL to inspect.') },
        async (args) => {
          const report = await probeUrl(String(args.url ?? ''))
          return { content: [{ type: 'text', text: JSON.stringify(report, null, 1) }] }
        },
      ),
    ],
  })
}

const refuse = (text) => ({ isError: true, content: [{ type: 'text', text }] })
