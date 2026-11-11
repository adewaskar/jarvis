The graduated rings, gauges and reticles that make the reactor read as a cockpit instrument rather than a glowing ball.

Use it as one SVG centred on the reactor, between the 3D scene (`z-scene`) and the HUD (`z-instruments`), 2vh above centre to match the camera. The stylesheet defines this layer in full, but no component in the current source mounts it; this preview reconstructs the assembly from those rules.

The consumer provides the stroke colour as `--ins` (normally the live accent) and three tempos, `--spin`, `--spin-slow` and `--spin-fast`, retimed per phase. Easing a duration is not possible in CSS, so the speed steps while the stroke eases over `t-accent`.

- The SVG is `instruments-size` or 82vmin, overflow visible, viewBox centred on the origin so `transform-box: view-box` rotations turn about the centre.
- Strokes, all `vector-effect: non-scaling-stroke` in `--ins`: `ins-tick` 1px at 0.55, `ins-tick-major` 1.4px at 1, `ins-bar` 2.2px at 0.75, `ins-ring` 1px at 0.5 (`ins-ring-dashed`: 46 12 4 12 at 0.8), `ins-bracket` 1.6px at 0.85, `ins-spoke` 1px at 0.6, `ins-hex` 1.2px at 0.7 (`ins-hex-inner` at 0.45).
- `ins-label`: `system-mono`, 13px / 1, 0.18em, filled `--ins` at 0.75, anchored middle.
- Rotation groups: `ins-spin-cw`, `ins-spin-cw-slow`, `ins-spin-ccw`, `ins-spin-ccw-fast`, linear and infinite; all stop under reduced motion.
