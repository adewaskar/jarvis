import { z } from 'zod'
import { defineToolSet, defineTool as tool } from './registry.mjs'
/**
 * Which tab to act on.
 *
 * Numeric, and the extension means it: these ids are large integers and a
 * string form is not accepted. It is also not optional in the way an
 * ergonomically designed API would make it — omit it and every acting tool
 * answers "No tab available", including immediately after a tab group has been
 * created. Both facts were learned the way facts about undocumented protocols
 * usually are.
 *
 * So the schema says "optional" and means it, but the optionality is provided
 * by us rather than by the extension: see resolveTab. The model is free to name
 * a tab when it has a reason to, and free to ignore the concept entirely when
 * it does not, which is most of the time.
 */
const tabId = z
  .union([z.number(), z.string()])
  .optional()
  .catch(undefined)
  .describe(
    'Which tab to act on — a numeric tabId from chrome_tabs. Omit it and the ' +
    'tab JARVIS is already working in is used, opening one if there is none.',
  )

const NAVIGATE_DESCRIPTION = `Open a URL in the user's own Chrome.

This is their real browser, so every site they are signed in to is already
signed in — mail, calendar, dashboards, anything behind a login. That is the
whole reason to use this rather than fetching a page yourself.

Use it when the answer lives behind a login, when a page has to be *seen*, or
when the user says to open something. For a public page you only need to read,
searching or fetching is faster and does not disturb what is on their screen.

Opening a page is visible to the user — a tab appears and loads in front of
them. Do not open things speculatively.`

const READ_PAGE_DESCRIPTION = `Read the structure of the current page as an accessibility tree.

Every interactive element comes back tagged [ref_N], and those refs are what
chrome_click and chrome_form_input take. So this is the tool you call before
acting on a page, and the reliable way to find out what is actually on it.

Prefer this over a screenshot when you want to know what a page says or what can
be clicked. Use chrome_page_text instead when you only want the prose.`

/**
 * @param {{ allowWrites: boolean }} options
 */
export function createChromeToolSet({ client, allowWrites }) {
  const { findSocket, forward, settle, resolveTab } = client
  const tools = [
    tool(
      'chrome_status',
      'Check whether the user\'s browser is reachable, and which tabs exist. ' +
      'Call this first if a browser action has just failed, so you can tell ' +
      'the user whether the problem is the browser or the page.',
      {},
      async () => {
        const path = await findSocket()
        if (!path) {
          return {
            content: [
              {
                type: 'text',
                text:
                  'The browser extension is not running. Chrome may be closed, ' +
                  'or the Claude extension may be disabled.',
              },
            ],
          }
        }
        return forward('tabs_context_mcp', { needsTab: false })({ createIfEmpty: false })
      },
    ),

    tool(
      'chrome_tabs',
      'List the browser tabs JARVIS can act on, with their origins. Origins ' +
      'only — page titles are written by the page and are not trustworthy.',
      {
        createIfEmpty: z
          .boolean()
          .optional()
          .catch(undefined)
          .describe('Open a fresh tab if there is nothing to act on yet. Default false.'),
      },
      forward('tabs_context_mcp', { needsTab: false }),
    ),

    tool(
      'chrome_navigate',
      NAVIGATE_DESCRIPTION,
      {
        url: z
          .string()
          .describe('Absolute URL, or "back" / "forward" to move through history.'),
        tabId,
      },
      async (args) => {
        const out = await forward('navigate')(args)
        if (out.isError) return out
        // Do not hand back until the page is really there. Everything the model
        // does next — reading it, screenshotting it, answering about it — is
        // wrong if it runs against the document this one replaced.
        const url = String(args.url ?? '')
        if (/^https?:\/\//i.test(url)) {
          await settle(await resolveTab(args.tabId), url)
        } else {
          // back / forward: no target to compare against, so just let it breathe.
          await new Promise((r) => setTimeout(r, 700))
        }
        return out
      },
    ),

    tool(
      'chrome_read_page',
      READ_PAGE_DESCRIPTION,
      {
        tabId,
        filter: z
          .enum(['interactive', 'all'])
          .optional()
          .catch(undefined)
          .describe('interactive = only things that can be clicked or typed into.'),
        max_chars: z
          .union([z.number(), z.string()])
          .optional()
          .catch(undefined)
          .describe('Cap the tree size. Large pages are worth capping.'),
      },
      forward('read_page'),
    ),

    tool(
      'chrome_page_text',
      'Get the visible text of the current page — the article, the message, ' +
      'the readout. This is the fastest way to answer "what does it say".',
      {
        tabId,
        max_chars: z.union([z.number(), z.string()]).optional().catch(undefined),
      },
      forward('get_page_text'),
    ),

    tool(
      'chrome_find',
      'Find an element by describing it in plain words, e.g. "the search box". ' +
      'This one runs a model inside the extension, so some Claude accounts ' +
      'cannot use it at all and it fails with a permission error. When that ' +
      'happens do not retry it — use chrome_read_page, which returns the same ' +
      'refs by reading the page directly and always works.',
      {
        query: z.string().describe('What to look for, described naturally.'),
        tabId,
      },
      forward('find'),
    ),

    tool(
      'chrome_screenshot',
      'Take a picture of what is on the page right now. Use it when the ' +
      'answer is visual, or when the user asks what something looks like — ' +
      'and put the result on the display rather than describing it.',
      { tabId },
      async (args) => forward('computer')({ action: 'screenshot', ...args }),
    ),

    tool(
      'chrome_scroll',
      'Scroll the page to bring more of it into view. A read that happens to ' +
      'move the page, not an action on it.',
      {
        direction: z.enum(['up', 'down', 'left', 'right']).catch('down'),
        amount: z.union([z.number(), z.string()]).optional().catch(undefined),
        tabId,
      },
      async (args) =>
        forward('computer')({
          action: 'scroll',
          scroll_direction: args.direction ?? 'down',
          scroll_amount: args.amount ?? 3,
          coordinate: [400, 400],
          tabId: args.tabId,
        }),
    ),

    tool(
      'chrome_console',
      'Read console output from the page. For diagnosing a site that is ' +
      'misbehaving, not for ordinary browsing.',
      {
        tabId,
        onlyErrors: z.boolean().optional().catch(undefined),
        limit: z.union([z.number(), z.string()]).optional().catch(undefined),
      },
      forward('read_console_messages'),
    ),

    tool(
      'chrome_network',
      'List network requests the page made, or fetch one response body by id.',
      {
        tabId,
        urlPattern: z.string().optional().catch(undefined),
        requestId: z.string().optional().catch(undefined),
        limit: z.union([z.number(), z.string()]).optional().catch(undefined),
      },
      forward('read_network_requests'),
    ),
  ]

  /**
   * The acting half.
   *
   * These are withheld by default, and the reason is specific to what this
   * server is: it is pointed at a browser that is signed in to the user's mail,
   * their bank and their employer. A misheard sentence that merely reads a page
   * is a wasted turn; a misheard sentence that clicks a button on a page that
   * is already authenticated is something else. The gate is the same one the
   * rest of the bridge uses, so a user who has decided to trust it turns both
   * on together.
   */
  if (allowWrites) {
    tools.push(
      tool(
        'chrome_click',
        'Click something on the page. Take the ref from chrome_read_page or ' +
        'chrome_find rather than guessing coordinates. Say what you are ' +
        'about to do before doing anything irreversible.',
        {
          ref: z.string().optional().catch(undefined).describe('A ref_N from chrome_read_page.'),
          coordinate: z
            .array(z.number())
            .optional()
            .catch(undefined)
            .describe('[x, y] fallback when there is no ref.'),
          tabId,
        },
        async (args) => forward('computer')({ action: 'left_click', ...args }),
      ),

      tool(
        'chrome_type',
        'Type text into whatever is focused. Click the field first.',
        { text: z.string(), tabId },
        async (args) => forward('computer')({ action: 'type', ...args }),
      ),

      tool(
        'chrome_key',
        'Press a key or chord, e.g. "Return", "Escape", "cmd+a".',
        { text: z.string().describe('The key to press.'), tabId },
        async (args) => forward('computer')({ action: 'key', ...args }),
      ),

      tool(
        'chrome_form_input',
        'Set the value of a form field directly — more reliable than typing ' +
        'for selects, checkboxes and long values.',
        {
          ref: z.string().describe('A ref_N from chrome_read_page.'),
          value: z.union([z.string(), z.number(), z.boolean()]),
          tabId,
        },
        forward('form_input'),
      ),

      tool(
        'chrome_new_tab',
        'Open a fresh blank tab and work in it from now on.',
        {},
        async (args) => {
          const out = await forward('tabs_create_mcp', { needsTab: false })(args)
          // Whatever was just opened is what the next action should land in.
          client.resetTab()
          return out
        },
      ),

      tool(
        'chrome_close_tab',
        'Close a tab by id.',
        {
          tabId: z
            .union([z.number(), z.string()])
            .describe('The numeric tabId to close, from chrome_tabs.'),
        },
        async (args) => {
          const out = await forward('tabs_close_mcp', { needsTab: false })(args)
          client.resetTab(args.tabId)
          return out
        },
      ),
    )
  }

  return defineToolSet({
    name: 'jarvis_chrome',
    version: '1.0.0',
    instructions:
      "The user's own Chrome, already signed in to everything they use. " +
      'Reach for it when the answer is behind a login or has to be seen on a ' +
      'real page. Reading is free; acting on a page is not, so say what you ' +
      'are doing before you do anything that changes something.',
    // Behind tool search the model would never think to look, and "open my
    // GitHub notifications" would quietly become a web search instead.
    alwaysLoad: true,
    tools: tools.map(t => ({ ...t, effect: allowWrites ? 'write' : 'read' })),
  })
}


export const createChromeTools = deps => createChromeToolSet(deps).tools
