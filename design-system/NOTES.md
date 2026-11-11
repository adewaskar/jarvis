# About this folder

The JARVIS HUD design system, extracted from this codebase: the tokens, the brand book, the stylesheet and a static preview of each surface.

- `README.md` — the brand book: usage rules that name tokens, styles and surfaces.
- `tokens.json` — every colour, text style, spacing, radius, glow, layout, blur, opacity, z-index and timing value, each with a usage note. `meta` records the commit it was read from.
- `tokens.css` — compiled from `tokens.json`: one custom property per token, one class per text style. Regenerate it when the JSON changes; do not edit it by hand.
- `components/bundle.css` — `src/index.css` rewired to read the tokens (plus the reader-view rules from `bridge/page.mjs`), so a value changed in the tokens reaches every preview.
- `components/<Surface>/preview.html` and `README.md` — a small document rendering that surface, and its guidelines. Each preview expects `tokens.css` and `bundle.css` to be loaded by the host; open one standalone by adding `<link rel="stylesheet" href="../../tokens.css"><link rel="stylesheet" href="../bundle.css">` to its head.

The source of truth for the live app is still `src/index.css`, `src/store.ts` (the phase colours) and `bridge/panels.mjs` (the `hud-*` vocabulary the model composes with). When those change, update `tokens.json` and `components/bundle.css` here to match.

The same system is published as a browsable Design System artifact: https://claude.ai/artifact/5uLecEPcMLXW6hf3F47xkd
