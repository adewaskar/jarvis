Five one-shot frame effects JARVIS can fire: flash, scan, pulse, glitch and shake.

Use them sparingly, one at a time, as punctuation for something that just happened. They mount only while playing (`z-fx`), take no pointer events, and cost nothing at rest. This card loops them; in the app each plays once.

The consumer provides the effect name. Shake is applied to the HUD root; the rest render inside the `fx` layer.

- Flash: a radial accent at 55% fading from the centre over `t-flash`, peaking at 12%.
- Scan: a 16vh band (accent 26%, then accent mixed 80% with white) crossing from above the frame to below it over `t-scan` with `ease-scan`.
- Pulse: two `fx-wave` rings centred on the reactor (2vh above centre, not the viewport), 2px accent with `glow-wave`, scaling 0.22 to 3.4 over `t-wave` with `ease-wave`, the second 150ms behind.
- Glitch: three `fx-slice` bands that displace what is behind them with a `backdrop-filter` (hue-rotate 90°, saturate 1.9), stepped over `t-glitch`, plus two full-frame casts in `glitch-magenta` and `glitch-cyan` pulling apart. Stepped timing, because a glitch that eases is a wipe.
- Shake: `fx-shaking` on the HUD root, seven translate steps over `t-shake` with `ease-shake`; the 3D scene is a separate layer and keeps still, which is what sells it as the instruments being knocked.
- Reduced motion: displacement goes; each effect becomes `fxFade` of the same colour in the same place.
