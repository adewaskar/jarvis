The camera indicator: a small bordered chip with a pulsing red dot, always visible while hand tracking runs.

Use it whenever the camera is on, and never hide it: an interface that can see the room has to say so without being asked. Top centre at 14px, `z-hands-live`, no pointer events.

The consumer provides nothing but the mounted state; the label is fixed.

- 9px, 0.18em, accent mixed 90% with white, padded 4px 10px, 30% accent border, accent 10% over `surface-live`, `backdrop-live`.
- The dot is 6px `camera-live` with its own 8px glow, pulsing to `dim-low` every 1.6s; the pulse stops under reduced motion but the dot stays.
- The hand pointer itself is a canvas on `z-hands-canvas`, a picture of a pointer rather than a pointer; the real events are synthesised at whatever is underneath.
