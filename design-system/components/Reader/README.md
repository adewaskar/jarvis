The reader view: an article's words restyled for the blade, in a system sans at a reading measure, with its source line, title, headings, quotes and lists.

Use it inside a tall blade for an article result; offer “live” (the real page, scripts removed) as the alternative, which looks like the site. The bridge produces it server-side and frames it under its own stylesheet and policy, so it is never styled by the HUD root.

The consumer provides the extracted article: source, title, lead, paragraphs, headings, quotes and list items.

- `rd` sets `reader` (15px / 1.62, `reader-fg`), padded `pad-reader-y` by `pad-reader-x` (40px bottom), sentence case, no tracking.
- `rd-src`: `mono`, 10px, 0.16em, uppercase, `reader-source` at 0.8. `rd-title`: 25px / 1.2, 600, `reader-title`, 10px above and 18px below. `rd-h`: 16px, 600, `reader-title`, 22px above and 8px below.
- `rd-p` has 14px below; `rd-lead` 18px. `rd-li` is indented 18px with 7px below.
- `rd-q`: italic `reader-quote` beside a 2px `reactor-core` rule, 14px in, 16px above and below.
- Images are block, full width, 4px radius (the one rounded thing in the system, because it is someone else's picture), 14px above and below.
- The scrollbar thumb is `reader-scrollbar` at `radius-scrollbar`. A live page sits on `live-page-bg`.
