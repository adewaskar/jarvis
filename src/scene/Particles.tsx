import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Drive } from './Scene'

/**
 * A shell of points around the core. Each one drifts on its own orbit and gets
 * pushed outward by loudness, so the whole cloud expands when JARVIS speaks.
 */

const vertex = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;
  uniform float uSize;

  attribute float aSeed;
  attribute float aRadius;

  varying float vAlpha;

  void main() {
    float t = uTime * (0.06 + aSeed * 0.05);

    // Rotate each point about Y at its own rate — cheap parallax.
    float c = cos(t), s = sin(t);
    vec3 p = vec3(position.x * c - position.z * s, position.y, position.x * s + position.z * c);

    // Loudness pushes the shell out and adds a little jitter.
    float push = 1.0 + uLevel * 0.35 + sin(uTime * 2.0 + aSeed * 12.0) * 0.02;
    p *= push;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    // Fade the far side so the cloud reads as volumetric, and thin it out
    // toward the outer edge of the shell.
    //
    // The range is the actual geometry: the camera sits 6.2 out and the shell
    // spans 1.9 to 4.5, so view depth runs from about -1.7 at the front to
    // -10.7 at the back. The old window closed at -3.5, which put nine tenths
    // of the cloud at alpha zero while still shading and rasterising every one
    // of those points.
    vAlpha = smoothstep(-11.5, -2.5, mv.z)
           * (0.30 + uLevel * 0.35)
           * (1.0 - aRadius * 0.55);

    // Perspective-correct sizing. The constant is tuned for the default 6-unit
    // camera distance — bigger values make the cloud read as fog, not points.
    gl_PointSize = uSize * (1.0 + uLevel * 0.7) * (13.0 / -mv.z);
  }
`

const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying float vAlpha;

  void main() {
    // Round, soft-edged points.
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d);
    if (r > 0.5) discard;
    float falloff = 1.0 - smoothstep(0.0, 0.5, r);
    // The dust belongs to the orb: turning the reactor down and leaving its own
    // atmosphere at full brightness reads as a bug, not as a dimmer.
    gl_FragColor = vec4(uColor, vAlpha * falloff * uIntensity);
  }
`

export function Particles({ drive, count = 4000 }: { drive: Drive; count?: number }) {
  const mat = useRef<THREE.ShaderMaterial>(null)
  const pts = useRef<THREE.Points>(null)

  const { positions, seeds, radii } = useMemo(() => {
    const positions = new Float32Array(count * 3)
    const seeds = new Float32Array(count)
    const radii = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      // Even distribution on a sphere, then jittered into a shell.
      const u = Math.random() * 2 - 1
      const theta = Math.random() * Math.PI * 2
      const r = Math.sqrt(1 - u * u)
      const radius = 1.9 + Math.pow(Math.random(), 2) * 2.6
      positions[i * 3] = Math.cos(theta) * r * radius
      positions[i * 3 + 1] = u * radius
      positions[i * 3 + 2] = Math.sin(theta) * r * radius
      seeds[i] = Math.random()
      radii[i] = (radius - 1.9) / 2.6
    }
    return { positions, seeds, radii }
  }, [count])

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uSize: { value: 3.4 },
      uColor: { value: new THREE.Color('#00e5ff') },
      uIntensity: { value: 1 },
    }),
    [],
  )

  useFrame((state, dt) => {
    if (!mat.current || !pts.current) return
    const u = mat.current.uniforms
    pts.current.visible = drive.reactor.visible
    u.uIntensity.value = drive.reactor.intensity
    u.uTime.value = state.clock.elapsedTime
    u.uLevel.value += (drive.level - u.uLevel.value) * Math.min(1, dt * 6)
    ;(u.uColor.value as THREE.Color).lerp(drive.color, Math.min(1, dt * 3))
  })

  // Each point's own orbit runs at a constant per-particle rate, so unlike the
  // core the shader can take the clock directly — nothing here rescales time by
  // a value that changes. Culling, though, is off for the same reason as the
  // core: loudness pushes the shell out past its authored radius.
  return (
    <points ref={pts} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
        <bufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
        <bufferAttribute attach="attributes-aRadius" args={[radii, 1]} />
      </bufferGeometry>
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        vertexShader={vertex}
        fragmentShader={fragment}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  )
}
