The glanceable card: four corner brackets over a faint accent tint, a tracked title, and a body the model composes from the `hud-*` vocabulary.

Use it for something to glance at while listening (a list, a figure, a picture). Something to actually read or look at is a Blade instead. Panels are immutable once pushed; a new fact is a new panel.

The consumer provides a title, sanitised body markup, an accent (default, amber, violet, green, red), a slot (right, left, wide) and an arrival variant (materialise, sweep, unfold, stagger, snap). Nothing else: no inline colour, no scripts, no links.

- Ground: a 160° gradient from accent 9% to 3% over nothing, `backdrop-panel` blur, no border. The four `pk` brackets are `bracket-size`, 1px accent, at `dim-caption`. Instrument markings, not a box.
- Padding `pad-panel-y` by `pad-panel-x`; `panel-max-height` with overflow hidden, so a stray image cannot balloon the card.
- `p-title` (8px, 0.3em, `dim-p-title`) in a `p-head` with `margin-head` under it. `p-body` resets uppercase and tracking.
- The accent class re-declares `--accent` from `panel-*`. `panel-default` must exist and restate `interface`: without it the card would inherit the live phase colour and re-tint itself amber, violet and green as the phase moved.
- Arrival: one of five variants on a 300/28 spring (snap: 120ms, overshoot to 1.04); one scan wipe (`p-wipe`, `t-wipe`) travels down the card as it lands; exit is a 6px blur fade over `t-exit`. No layout animation between siblings: the gap is fixed.
- `p-stagger` makes each direct child (or each row inside `hud-rows`, `hud-grid`, `hud-gallery`) arrive from 12px right on the `t-stagger-first` + `t-stagger-step` ladder.
- An empty body shows `p-empty` (“no content returned”) rather than a blank rectangle.
- Slots: right `panel-right-width` at `panel-right-inset`; left `panel-left-width` at `panel-left-inset`; wide `panel-wide-width` centred above the transcript. Under 1400px both side slots narrow and move to 40px; the left one drops to 32% from the top.
