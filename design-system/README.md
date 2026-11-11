A voice assistant's face: a dark field, one live accent, instrument markings instead of boxes. The interface is a cockpit drawn in light on `bg`, over a 3D reactor. Nothing is a filled card; hierarchy is opacity, depth is glow, and colour belongs to the moment.

## Content

- Chrome is UPPERCASE and tracked: statuses, rail titles, kickers, tags, panel titles. Set it in the Chrome styles (`hud-base`, `status`, `rail-title`, `p-title`, `hud-tag`).
- Body copy is sentence case and never tracked: the transcript (`log-line`), the live `caption`, `hud-label`, `hud-sub`, `hud-note`. A panel body resets `text-transform` and `letter-spacing`, so prose inside the HUD never shouts.
- Status words are short system nouns or present-tense verbs, in this order: OFFLINE, INITIALISING, STANDBY — SAY “HEY JARVIS”, ONLINE, LISTENING, PROCESSING, ACCESSING SYSTEMS, RESPONDING. British spelling throughout: INITIALISE, colour, sanitise.
- Hints read as spoken phrases, lowercase, in curly quotes: “hey jarvis, what's on my calendar tomorrow”. The lead-in is one word (“try”) in `suggest-lead`.
- Speakers are YOU and JARVIS in `log-who`. The user's line sits at `dim-user`; JARVIS's line is `ink-reply` with `glow-reply` and resolves out of glyph noise (the decode) rather than appearing.
- Errors are one plain line in `error`. An empty panel says “no content returned” in `p-empty`; a dead image says “image unavailable” in `hud-caption hud-dim`.
- No emoji anywhere on the chrome. Glyphs only: › before a boot-log line, ⟩ before a running tool, the rotated-square tick, the pulsing dot.
- Panel markup never carries a colour or a style. It is themed by its accent (default, amber, violet, green, red) and composed only from the `hud-*` classes; everything else is stripped before it reaches the DOM.

## Colour

- `bg` is the only ground. Over it sit the radial `vignette` and 3px `scanline`s; the scene is never flat black.
- `interface` is the fixed cyan. `accent` is the live colour: the HUD root re-declares it per phase from `phase-*`, every panel re-declares it per card from `panel-*`, and every border, glow and tint is written against `accent`, never against a phase token. Tints are `color-mix(in srgb, var(--accent) N%, transparent)` at N = 3, 6, 8, 9, 12, 16, 18, 22, 24, 26, 30, 38, 45, 55.
- Phase sets `accent`: offline `phase-offline`, boot `phase-boot`, dormant `phase-dormant`, waking `phase-waking`, listening `phase-listening`, thinking `phase-thinking` (amber reads as effort), tooling `phase-tooling` (violet reads as machinery), speaking `phase-speaking` (green reads as voice). The reactor, the instruments and the HUD change together over `t-accent`.
- A panel is a record of a moment: once landed it holds its accent while the phase moves underneath it. `panel-default` restates `interface` for exactly that reason.
- Text is near-white, never pure: `ink-label` on rows, `ink-reply` for JARVIS, `ink-note` for prose, `ink-metric` for the figure, `ink-tool` for the running tool. Only the live caption uses `ink-caption` (#fff), at `dim-caption`. The nine inks sit within a few steps of one another; choose by role, not by eye.
- Hierarchy on the chrome is opacity on the accent, from `dim-faint` (0.3) to `dim-rail` (0.82). Rail titles, tags, kickers and hints at 8–9px and 0.3–0.45 opacity fall below 4.5:1 on `bg`; the source keeps them as decoration, and nothing you must read is set that way. Every `ink-*` on `bg` or a panel tint clears 15:1.
- Signals: `error` and `panel-red` for faults, `camera-live` for the red camera dot, `diag-ok` and `diag-bad` only inside the diagnostics overlay. Thinking amber and speaking green differ in lightness as well as hue, and every state also carries its word.
- Surfaces are tints of the accent over a translucent ink (`surface-chip`, `surface-blade`, `surface-live`, `surface-guide`) behind a `backdrop-*` blur, so the scene shows through.
- Photographs get `filter: saturate(0.85) contrast(1.05)` so they lean toward the cyan rather than fight it.

## Type

- `display` (Chakra Petch 300, 400, 600; Google Fonts) for everything on the HUD. `mono` (JetBrains Mono 300, 400) for figures, indices, the boot readout, key caps and the tool name on the sweep. `system-mono` only for instrument labels and the diagnostics overlay. `reader` only inside a reader-view blade.
- Chrome is small: 8–11px, uppercase, tracked 0.14–0.52em. Balance a centred word's trailing letter-space with an equal `text-indent` (`ignition-word`, `tool-name`, `tool-kicker`).
- One big figure: `hud-metric` (40px mono) with `hud-unit` under it. The wordmark is `brand-mark`: 19px, 600, 0.42em, `glow-brand`.
- Body lines: `log-line` 14/1.55; `hud-label` 12.5/1.35 clamped to two lines; `hud-sub` 10.5 on one line with an ellipsis; `hud-note` 12/1.55.

## Spacing and layout

- The frame: `corner-size` brackets at `inset-corner`; header and footer at `inset-frame`; rails and header padding at `inset-rail`. Under 900px the header padding drops to 46px and the rails to 30px.
- Panels live in three slots. Right: `panel-right-width` at `panel-right-inset`. Left: `panel-left-width` at `panel-left-inset`, clear of the SYSTEMS rail. Wide: `panel-wide-width`, centred, sitting on the transcript's line at `offset-log`. Cards stack `gap-panels` apart, padded `pad-panel-y` by `pad-panel-x`, capped at `panel-max-height`.
- Inside a panel: rows `gap-rows` apart, a row's columns `gap-row` apart, label and sub `gap-main` apart, grid cells `gap-grid-row` by `gap-grid-col`, gallery tiles `gap-gallery`.
- The transcript is `log-width` wide, centred, `offset-log` from the bottom. Below it, the caption at `offset-caption`, the suggestion at `offset-suggest`, the error at `offset-error`.
- Blades take the middle of the frame at preset sizes (`blade-*-width`); `tall` is a reading measure of about sixty characters.
- Spacing comes from the source, not a grid: 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 22, 26, 44, 92.

## Shape, borders, depth

- Square. `radius-none` everywhere except the tool chip and the diagnostics overlay (`radius-chip`), scrollbar thumbs (`radius-scrollbar`), and dots, rings and spinners (`radius-round`).
- Brackets, not boxes: a panel shows four `bracket-size` corner marks, the frame four `corner-size` ones. A full border appears only on something you operate or watch: a blade, a button, the tool chip, the camera indicator, a key cap, a thumbnail.
- Borders are 1px at an accent tint of 22–38%; 1.5px on the boot bar; 2px on the shockwave ring.
- Depth is light, not shadow: `glow-*` text-shadows on words, `glow-tick` and `glow-dot` on marks. Drop shadows exist only under blades (`shadow-blade`, and `shadow-blade-front` for the one in front).

## Motion

- Colour follows a phase change over `t-accent`. The meter follows the microphone over `t-meter`, linear.
- A panel arrives by one of five variants chosen per card: materialise (blur and scale up), sweep (in from the right), unfold (down from its top edge), stagger (rows land in sequence on the `t-stagger-first` + `t-stagger-step` ladder, shared past the tenth), snap (overshoot to 1.04 and settle in `t-cell`). The spring is `spring-stiffness` / `spring-damping`. Every panel gets one scan wipe (`t-wipe`) as it lands. Leaving: fade and 6px blur over `t-exit`.
- Ambient: the status dot pulses on `t-pulse`; the ignition ring turns once per `t-ignition-spin`; the reactor and instrument rings spin harder while working (offline 0.08, dormant 0.25, listening 1.1, speaking 1.4, thinking 2.8, boot 3.2, tooling 3.6, waking 4.5 on the scene's spin scale).
- While a tool runs, six blades sweep the middle band on co-prime tempos from 1.15s to 2.6s with `ease-blade`, and the tool name rides in on `t-blade-carry` with `ease-carry`.
- One-shot effects: flash `t-flash`; scan `t-scan` with `ease-scan`; pulse, two rings on `t-wave` 150ms apart with `ease-wave`; glitch `t-glitch`, stepped, displacing the live scene behind it; shake `t-shake` with `ease-shake` on the HUD root only. The 3D scene never moves.
- Everything animates with transform and opacity on its own layer. Under `prefers-reduced-motion` every loop stops, each effect becomes a fade of the same colour in the same place, and the blades park where they would have crossed.

## States

- Working: the tool chip (`ToolBadge`) with a spinner and the name in `ink-tool`, and the blade sweep behind it.
- Listening: the live caption in `ink-caption` and the signal meter in the right rail.
- Idle: rotating suggestions until the first exchange, then nothing.
- Camera on: the camera indicator is always visible while tracking runs, red dot pulsing. An interface that can see the room says so without being asked.
- Controls: a blade button is transparent with a 24% accent border; hover fills 18% and raises the border to 46% over `t-button`. A blade drags by its header and resizes by its bottom-right grip.

## Layering

`z-scene` (1), `z-instruments` (2), `z-hud` (4), `z-scanlines` (5), `z-surface` (6: the tool chip, the boot screen, the blade stack), `z-ignition` (7), `z-fx` (9), `z-diag` (20), `z-hands-canvas` (95), `z-hands-live` (96). Text and panels always win over the instruments; the hand pointer wins over everything.

## Iconography

There is no icon set and no logo file. The mark is the wordmark J.A.R.V.I.S. set in `brand-mark`; the favicon in the source is the build tool's default and is not a brand asset. Marks are drawn, not loaded: the `tick-size` rotated square, the `dot-size` pulsing dot, the `spinner-size` ring, the › and ⟩ glyphs, and the SVG reticle (rings, ticks, brackets, hexagon) of the instrument layer.

## Not in this system

- The 3D reactor (Three.js and GLSL) beyond its three colours `reactor-core`, `reactor-hot` and `interface` (the particle field).
- The React components themselves. This system ships the stylesheet (`components/bundle.css`) and a static preview of each surface; the app's components are not a library and were not bundled.
- The instrument layer: its CSS is in the stylesheet but no component in the current source mounts it, so its preview is reconstructed from the stylesheet alone.
- Font files: both faces are hosted on Google Fonts and are named in `type.families` only.
