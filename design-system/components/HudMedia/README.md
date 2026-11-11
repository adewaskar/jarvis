The media vocabulary inside a panel: a full-width `hud-img`, a `hud-gallery` of `hud-thumb`s, a `hud-video`, a 16:9 `hud-embed`, each grouped with its `hud-caption` inside a `hud-figure`.

Use `hud-img` for one picture JARVIS made or captured; `hud-gallery` for several results (four is a good number, eight the most); `hud-video` for a direct mp4 or webm; `hud-embed` for a YouTube or Vimeo result, which can only be framed. Put anything that needs width in the wide slot.

The consumer provides URLs. Every remote URL is rewritten to the bridge, which fetches server-side; the page itself only ever asks localhost for bytes. A frame is only allowed for the three video hosts; anything else is removed before it reaches the DOM.

- `hud-img` and `hud-thumb` get `filter: saturate(0.85) contrast(1.05)` so photographs lean toward the cyan. Never remove it.
- `hud-gallery` is an auto-fill grid of `thumb-min` tiles, `gap-gallery` apart, with `min-width: 0` on every tile so a 1200px photograph cannot blow a track out sideways. `hud-thumb` is 4:3, covered, 22% accent border over a 6% accent ground.
- `hud-img` and `hud-video` cap at `media-max-height`; `hud-embed` is a 16:9 box over `surface-media`, and `hud-video` and `hud-embed` are the only things in a panel that take pointer events.
- `hud-figure` keeps media and caption as one unit; `hud-caption` is 10px at `dim-secondary`, `margin-caption` below the media (6px inside a figure).
- A dead image or video is replaced by “image unavailable” / “video unavailable” in `hud-caption hud-dim`, never left as a blank or black rectangle.
