The figure vocabulary inside a panel: one big `hud-metric` with a `hud-unit` under it, a two-column `hud-grid`, a short `hud-note`, and a hairline `hud-bar`.

Use `hud-metric` for a single headline number; use `hud-grid` to set two side by side; use `hud-note` for one or two sentences; use `hud-bar` for a share of a whole.

The consumer provides the number as text (already formatted, with its separators), the unit in lowercase, and for a bar the share as `style="--v:0.62"`, the one inline style the sanitiser lets through.

- `hud-metric`: `mono`, 40px / 1, `ink-metric`, `glow-metric`. `hud-unit`: 9px, 0.24em, uppercase, `dim-secondary`, 6px below.
- `hud-grid`: two equal columns, `gap-grid-row` by `gap-grid-col`.
- `hud-note`: 12px / 1.55 in `ink-note` at `dim-note`, zero margin. Mark the important phrase `hud-hot`, the incidental one `hud-dim`; never both on the same words.
- `hud-bar`: `bar-height` tall, an 18% accent track; the fill is `calc(var(--v) * 100%)` wide in full accent with `glow-tick`.
