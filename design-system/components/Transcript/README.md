The conversation log under the reactor: the user's line, JARVIS's line resolving out of glyph noise, the live caption while listening, and the one-line error.

Use the log for the exchange in progress, at most a few lines; it is `log-width` wide, centred, `offset-log` from the bottom, and resets the chrome's uppercase and tracking.

The consumer provides turns (role and text), the partial transcript while listening, and an error string if any. JARVIS's text streams a token at a time; the decode frontier only ever moves forward and must never trail the voice by more than about 420ms.

- A line is `log-line` (14px / 1.55) with the speaker in `log-who` (8px, 0.26em, `dim-muted`) on a 54px column, `gap-who` apart.
- The user's text sits at `dim-user`. JARVIS's text is `ink-reply` with `glow-reply`.
- The decode is two spans: `decode-ghost` (the scramble, `mono`, 0.92em, accent at `dim-p-title` with `glow-ghost`) and `decode-veil` (the unreached text at opacity 0, present in the DOM so the wrapping and the accessibility tree hold the real sentence). Ghost glyphs are uppercase, digits and rules only, 22 characters ahead, repainted every 42ms.
- The caption is `caption` in `ink-caption` at `dim-caption`, centred at `offset-caption`, at most 66vw.
- The error is `error` in `error` colour at `offset-error`, at most 70vw.
- Under 900px the log is 84vw wide.
