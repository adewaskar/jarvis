The boot sequence: a clipped status bar with a typing title, a segment gauge and a scrolling log, then a centre stage where reticle rings assemble, a suit wireframe is drawn and the reactor lights.

Use it between ignition and the first phase, on `z-surface`, in `phase-boot`. The bar dims to `dim-faint`-ish (0.28, `blur-boot-dim`) once the centre stage takes over.

The consumer provides the log lines and the progress (how many segments are on). Beats 2 to 4 are SVG drawn by the app; this card shows beat 1, which is the reusable part.

- `boot-bar-frame`: 1.5px accent rules top and bottom, clipped to a polygon with 3% chamfers, padded 14px 26px 12px, `glow-boot-frame`.
- `boot-bar-title`: `mono`, 300, clamp(18px, 3.4vw, 40px), 0.14em, `ink-boot`, `glow-boot-title`; `boot-dots` at `dim-kicker`; `boot-cursor` is a 0.6em block blinking on `t-spin` in steps.
- `boot-seg`: equal cells 3px apart, 12px tall, 45% accent border; a cell with `data-on="1"` fills accent with a 10px glow over `t-cell`.
- `boot-log`: `mono`, 10px / 1.9, 0.06em, `dim-kicker`; each line is prefixed › at half opacity and slides in from 8px left over 250ms.
- Centre stage: rings in accent at `dim-note` with a 4px drop glow; the name `boot-name` in `ink-boot`; wire strokes 1.4px (dim ones 1px at 0.4); tags `boot-tag` at 0.55; reactor segments 8px at 30% accent, lit ones `ink-reactor-lit`; the triangle stroked `ink-boot` 3px with a `reactor-vector` V inside.
