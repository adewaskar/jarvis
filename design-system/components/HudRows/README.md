The list vocabulary inside a panel: `hud-rows` holds `hud-row`s, each with an optional `hud-idx` or `hud-thumb`, a `hud-main` text column of `hud-label` and `hud-sub`, and a trailing `hud-tag`.

Use it for a ranked or scanned list: headlines, mail, results, calendar items. Three to six rows; past ten the stagger delay is shared and the card is already too long.

The consumer provides the markup using only these classes; the sanitiser strips every other class and attribute. A leading index is text (“01”); a leading image is an `img.hud-thumb` and must be a remote or `file:` URL the bridge can fetch.

- `hud-rows` is a flex column, `gap-rows` apart. `hud-row` is a baseline-aligned flex row, `gap-row` apart.
- `hud-idx`: `mono`, 9px, `dim-muted`, padded 2px down. `hud-thumb` in a row: a `thumb-row` tile, self-centred, 4:3, 22% accent border.
- `hud-main`: `min-width: 0` so it can shrink; `hud-label` (12.5px / 1.35, `ink-label`) clamps to two lines; `hud-sub` (10.5px, `dim-secondary`) is one line with an ellipsis, `gap-main` under the label.
- `hud-tag`: 8px, 0.14em, uppercase, `dim-tag`, never wraps.
- `hud-hot` on anything lifts it to the accent with `glow-hot`; `hud-dim` drops it to `dim-muted`.
