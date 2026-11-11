The diagnostics overlay (press D): deliberately plain and deliberately ugly, an instrument rather than part of the interface, so it is never mistaken for one on camera.

Use it only for debugging state: a verdict, then sections of key/value rows. Top-right at 1rem, `z-diag`, no pointer events, scrolling past `100vh - 2rem`.

The consumer provides the verdict lines and the sections. Values are strings; `diag-ok` and `diag-bad` colour a value or a verdict.

- Ground `surface-diag`, 1px accent border (falls back to `phase-listening`), `radius-chip`, `backdrop-diag`, padded 0.75rem 0.9rem, `diag-width` wide.
- Type is `system-mono`: `diag` 0.72rem / 1.6 in `diag-fg`; `diag-verdict` 0.78rem; `diag-head` tracked 0.18em in the accent over a `diag-rule`; `diag-sec` tracked 0.16em in `diag-muted` over a `diag-rule-soft`.
- `diag-row` is a grid of an 8.5rem key column (`diag-k`, `diag-muted`) and a value (`diag-v`, `diag-fg`, wrapping anywhere).
- Do not reuse these colours or this type on the HUD proper.
