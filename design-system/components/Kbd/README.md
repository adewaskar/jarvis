A key cap: a 1px `currentColor` outline around a key name in `mono`, used in hint lines.

Use it for a keyboard key in the footer hint, the blade hint and the gesture legend's footer. Inside a blade hint or the legend it inherits the surrounding font and takes a 30% accent border instead.

- `kbd` is 9px `mono`, padded 1px 5px, square (`radius-none`).
- Key names are uppercase: SPACE, ESC, TAB, D.
- The hint line around it is `hud-bottom` at `dim-chrome`, centred at `inset-frame` from the bottom.
