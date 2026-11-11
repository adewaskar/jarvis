The chip that names the tool JARVIS is running, with a ring spinner and a RUNNING kicker.

Use it while a tool call is in flight and only then; the answer arriving removes it. It sits in the status band at `offset-tool-badge`, centred, above the panels (`z-surface`).

The consumer provides the tool name; underscores and hyphens are shown as spaces. The horizontal centring is applied by the consumer (the app does it with a motion prop), because the stylesheet leaves `transform` alone.

- Ground: accent at 9% over `surface-chip`, `backdrop-chip` blur, a 38% accent border, `radius-chip`, `glow-chip`.
- Kicker: `tool-kicker` at `dim-kicker` with a `spinner-size` ring spinning on `t-spin`, separated from the name by a 24% accent rule and `gap-chip`.
- Name: `tool-name` in `ink-tool` with `glow-tool-name`, truncated with an ellipsis past `tool-name-max`. Never let it wrap or stretch the chip off-frame.
- Under 1100px: 12px at 0.18em, chip at 60px from the top.
- The blade sweep plays behind it while it is up; they say the same thing in two registers.
