# About this folder

The JARVIS HUD design system, extracted from this codebase: the tokens, the brand book, the stylesheet and a static preview of each surface.

- `README.md` — the brand book: usage rules that name tokens, styles and surfaces.
- `tokens.json` — every colour, text style, spacing, radius, glow, layout, blur, opacity, z-index and timing value, each with a usage note. `meta` records the commit it was read from.
- `tokens.css` — compiled from `tokens.json` by `npm run tokens` (`scripts/tokens.mjs`): one custom property per token (no classes: the text styles share names with the app's own classes and stay documentation). `src/index.css` imports it, so the app reads these values live. Regenerate it after editing the JSON and commit both; never edit it by hand.
- `components/bundle.css` — `src/index.css` rewired to read the tokens (plus the reader-view rules from `bridge/page.mjs`), so a value changed in the tokens reaches every preview.
- `components/<Surface>/preview.html` and `README.md` — a small document rendering that surface, and its guidelines. Each preview expects `tokens.css` and `bundle.css` to be loaded by the host; open one standalone by adding `<link rel="stylesheet" href="../../tokens.css"><link rel="stylesheet" href="../bundle.css">` to its head.

`tokens.json` is now the source of truth for every colour, size, glow and tempo: change a value there, run `npm run tokens`, and the app, the previews and the artifact page all follow. `src/index.css` owns layout and the rules that use the tokens; `src/store.ts` still carries the phase colour map the 3D scene reads (keep `phaseColor` and the `phase-*` tokens in step); `bridge/panels.mjs` and `src/ui/sanitise.ts` define the `hud-*` vocabulary. When you add a class to `src/index.css`, mirror it in `components/bundle.css` so the previews keep up.

The same system is published as a browsable Design System artifact: https://claude.ai/artifact/5uLecEPcMLXW6hf3F47xkd
