The fixed chrome around the scene: four corner brackets, the wordmark and status at the top, a SYSTEMS rail on the left, a SIGNAL rail on the right, and a hint line at the bottom.

Use it once, as the root of the HUD. It is `pointer-events: none` throughout; nothing on it is clicked.

The consumer provides the phase (which sets `--accent` on the root from a `phase-*` token), the list of linked systems for the left rail, the microphone level (0–1) for the meter, and the status word.

- The root sets `hud-base` (11px, uppercase, 0.16em) and `color: var(--accent)`; every child inherits both. Reset `text-transform` and `letter-spacing` only inside a panel body or the transcript.
- Corners are `corner-size` squares with two sides, at `inset-corner`, in accent at 55% and `dim-note` opacity. They are markings, not a border: never close the frame.
- The wordmark is `brand-mark` with `glow-brand`; the expansion under it is `brand-sub` at `dim-tag`. The status is a `dot-size` pulsing dot (`t-pulse`) and the status word, pinned right with `margin-left: auto` so it stays put when the wordmark is hidden.
- A rail item is a `tick-size` rotated square with `glow-tick`, then the name, at `dim-rail`; `.dim` drops it to `dim-faint` for “none linked”. `.mono` switches a readout to `mono` at 0.1em.
- The meter is `meter-width` by `meter-height`, a 16% accent track with a full-accent fill scaled from the bottom over `t-meter`.
- Under 900px the header padding is 46px and the rails 30px; under 1100px the tool chip drops to 60px.
