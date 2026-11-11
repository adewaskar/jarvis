The big surface, centred in the frame: a bordered, blurred card with a draggable header, action buttons, a scrolling body and a resize grip, stacked with other blades.

Use it for something to be looked at rather than glanced at: an article, a picture, a gallery, a clip, a live page, the camera. It covers the reactor, and it should: when there is something worth reading, the reactor is no longer the subject.

The consumer provides a title, a kind (article, image, video, embed, gallery, markup, camera), a size preset (compact, tall, wide, full; expanded when focused), and the content. The body of an article or live page is a framed document with its own stylesheet and policy; markup uses the `hud-*` vocabulary.

- Ground: 160° gradient from accent 11% over `surface-blade` to 4% over `surface-blade-deep`, `backdrop-blade` blur, a 26% accent border, `shadow-blade`. The front blade alone takes `shadow-blade-front`.
- Sizes: compact `blade-compact-width` × 380; tall `blade-tall-width` × 900 (a reading measure); wide `blade-wide-width` × 720; full 92vw × 88vh; expanded 94vw × 92vh. A resized blade is sized inline and the presets step aside.
- Header: `bl-head`, padded `pad-blade-head-y` by `pad-blade-head-x` (12px right), accent 7% ground, 18% rule below, `cursor: grab`. `bl-title` is 10px, 0.2em, accent mixed 92% with white, one line; `bl-kind` sits beside it at `dim-muted`; `bl-acts` on the right.
- `bl-btn`: transparent, 24% accent border, accent mixed 80% with white, 11px, padded `pad-btn-y` by `pad-btn-x`; hover fills 18% and raises the border to 46% over `t-button`.
- Body: `bl-body` scrolls with a `reader-scrollbar` thumb; an image or video is contained, never cropped, over `surface-media-dim`; a gallery is 190px auto-fill tiles 8px apart; a note is `bl-note` at `dim-kicker`.
- `bl-grip` is `grip-size` in the bottom-right corner, two hairlines at 60% and 40% accent, `cursor: nwse-resize`.
- `bl-hint` sits under the stack at 3.2vh: 9px, 0.14em, `dim-tag`, with key caps.
