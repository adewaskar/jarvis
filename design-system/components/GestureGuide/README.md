The gesture legend: a small bordered panel, bottom-left, listing each hand gesture, its name and what it does, gone once you have proved you know how it works.

Use it while hand tracking is new to the user. `inset-guide` from the bottom-left corner, out of the way of the reactor and the blade stack, `z-hands-live`, no pointer events.

The consumer provides the rows (an icon glyph, a name, what it does) and the footer hint.

- Ground: accent 8% over `surface-guide`, `backdrop-guide`, 24% accent border, at least 210px wide, padded 11px 13px 9px. Resets uppercase and tracking.
- `gguide-head`: 9px, 0.2em, uppercase, `dim-kicker`, 8px below. `gguide-row`: 11px, 9px gaps, 3px vertical padding.
- `gguide-icon` is a 17px column of a glyph at 13px, desaturated to 20% so an emoji reads as a mark, not a sticker. This is the one place an emoji appears, and only as that mark.
- `gguide-name`: 9px, 0.14em, uppercase, accent mixed 95% with white, on a 44px column. `gguide-does` at `dim-does`.
- `gguide-foot`: 9px, 0.1em, `dim-muted`, over a 14% accent rule, with a key cap at a 30% border.
