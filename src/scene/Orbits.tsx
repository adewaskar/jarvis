import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore, type OrbitObject } from '../store'
import { BRIDGE_HTTP_URL } from '../config'

/**
 * Images revolving around the reactor.
 *
 * This is JARVIS's shelf: a screenshot he has just taken, a still he generated,
 * the cover of whatever is playing. Each one is a camera-facing plane carried
 * round a tilted circle, which is enough to read as an orbit without any of the
 * cost of real 3D — no lighting, no shadows, no depth sorting to fight.
 *
 * Not one element in here is React. The list changes whenever JARVIS adds or
 * drops an object, and expressing that as JSX would put mounts and unmounts of
 * scene objects on the React render path — the exact thing the Drive object in
 * Scene.tsx exists to avoid, and worse here, because a re-render of this subtree
 * would drop and rebuild every texture in it. So the group is built by hand and
 * reconciled inside useFrame; the steady-state cost of that is one pointer
 * comparison per frame, because the store hands back the same array identity
 * until the list genuinely changes.
 */

/**
 * Paths that are genuinely on this machine's disk, as opposed to app-relative
 * URLs that happen to start with a slash. Mirrors the same test in
 * src/ui/Panels.tsx — the two cannot share it without one of them importing a
 * DOM component into the scene or the other way round, and the list of root
 * directories is the sort of thing that should be changed in both places
 * deliberately anyway.
 */
const DISK_PATH =
  /^(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|root|Volumes|Applications|System|Library|private|tmp|var|opt|mnt|media|srv|data)\/)/

/**
 * A page served over http cannot load `file:///…`, and everything interesting
 * lands on disk as an absolute path. Route those through the bridge, which can
 * read them; leave data: URIs and anything else exactly as given, since the
 * page CSP is the thing deciding what is loadable and it already refuses the
 * rest.
 */
function resolveSrc(src: string): string {
  const path = src.replace(/^file:\/\//, '')
  if (!DISK_PATH.test(path)) return src
  return `${BRIDGE_HTTP_URL}/file?path=${encodeURIComponent(path)}`
}

type Entry = {
  def: OrbitObject
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  texture: THREE.Texture | null
  /**
   * Accumulated rather than derived from the clock. Deriving it means that
   * changing an object's speed teleports it to wherever the new rate says it
   * should have been by now, which looks like a dropped frame rather than like
   * an object speeding up.
   */
  angle: number
  /** Width over height of the loaded image; 1 until it arrives. */
  aspect: number
  /** A source that failed to load. Warned about once, then left alone. */
  dead: boolean
  /**
   * Bumped on every load. Two sources for one id can be in flight at once —
   * "show me the other photo" while the first is still decoding — and without
   * this the slower of the two wins whichever one was asked for last.
   */
  token: number
}

const DEG = Math.PI / 180
/** Revolutions per minute to radians per second. */
const RPM = (Math.PI * 2) / 60

/**
 * Textures are the only thing here the GPU cannot get back on its own: three
 * caches nothing for us, so an object that comes and goes ten times leaks ten
 * decoded images unless each one is dropped on the way out.
 */
function release(group: THREE.Group, entry: Entry) {
  entry.texture?.dispose()
  entry.mesh.material.dispose()
  group.remove(entry.mesh)
}

export function Orbits() {
  const loader = useMemo(() => new THREE.TextureLoader(), [])
  const group = useMemo(() => new THREE.Group(), [])
  /** One quad, shared by every object — only the scale differs. */
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), [])
  const entries = useMemo(() => new Map<string, Entry>(), [])
  /** Last list identity seen, so the reconcile below is skipped when idle. */
  const seen = useMemo<{ list: OrbitObject[] | null }>(() => ({ list: null }), [])

  useEffect(() => {
    return () => {
      for (const entry of entries.values()) release(group, entry)
      entries.clear()
      geometry.dispose()
    }
  }, [entries, geometry, group])

  function attach(entry: Entry, src: string) {
    const mine = ++entry.token
    entry.dead = false
    loader.load(
      resolveSrc(src),
      (texture) => {
        // The list may have moved on while the image was in flight.
        if (entry.token !== mine || entries.get(entry.def.id) !== entry) {
          texture.dispose()
          return
        }
        texture.colorSpace = THREE.SRGBColorSpace
        entry.texture?.dispose()
        entry.texture = texture
        const image = texture.image as { width?: number; height?: number }
        entry.aspect =
          image?.width && image?.height ? image.width / image.height : 1
        entry.mesh.material.map = texture
        entry.mesh.material.needsUpdate = true
        entry.mesh.visible = true
      },
      undefined,
      () => {
        if (entry.token !== mine) return
        // One line, once. A bad path is a fact about the request, not a reason
        // to take the scene down, so the entry simply never becomes visible.
        entry.dead = true
        console.warn('[jarvis] orbit image failed to load', entry.def.id, src)
      },
    )
  }

  function spawn(def: OrbitObject): Entry {
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: def.opacity,
      // Nothing in this scene writes depth — the reactor is additive — so the
      // orbits are ordered by the renderer's own back-to-front pass, which is
      // exactly the reading we want: an object behind the orb gets the orb's
      // glow laid over it, one in front covers it.
      depthWrite: false,
      toneMapped: false,
    })
    const mesh = new THREE.Mesh(geometry, material)
    // Hidden until its texture lands, so a slow load is an object that has not
    // arrived yet rather than a white rectangle in orbit.
    mesh.visible = false
    mesh.frustumCulled = false
    group.add(mesh)
    return {
      def,
      mesh,
      texture: null,
      angle: def.phase * DEG,
      aspect: 1,
      dead: false,
      token: 0,
    }
  }

  function sync(list: OrbitObject[]) {
    const alive = new Set<string>()
    for (const def of list) {
      alive.add(def.id)
      const entry = entries.get(def.id)
      if (!entry) {
        // Registered before the load starts, since the callback identifies
        // itself by looking itself up in here.
        const created = spawn(def)
        entries.set(def.id, created)
        attach(created, def.src)
        continue
      }
      // Replacing an id keeps the object on screen and swaps what it is showing
      // rather than blinking it out and back in — but only the source is worth
      // reloading for, and a re-stated phase is a request to reposition.
      if (entry.def.src !== def.src) attach(entry, def.src)
      if (entry.def.phase !== def.phase) entry.angle = def.phase * DEG
      entry.def = def
    }
    for (const [id, entry] of entries) {
      if (alive.has(id)) continue
      release(group, entry)
      entries.delete(id)
    }
  }

  useFrame((state, dt) => {
    const { orbits } = useStore.getState().ui
    if (orbits !== seen.list) {
      seen.list = orbits
      sync(orbits)
    }
    if (entries.size === 0) return

    /**
     * Both conversions come off the live viewport rather than off a constant,
     * so a window resize reframes the orbits the same way it reframes the ring.
     * `fit` is the shorter axis in world units and `perPx` is what one CSS
     * pixel is worth out at the reactor's plane.
     */
    const fit = Math.min(state.viewport.width, state.viewport.height)
    const perPx = state.viewport.width / state.size.width

    for (const entry of entries.values()) {
      if (entry.dead || !entry.texture) continue
      const def = entry.def
      entry.angle += dt * def.speed * RPM

      // The radius is read as a share of the frame's shorter axis in the same
      // sense as Core's FIT, which is a diameter: radius 0.6 therefore puts the
      // object exactly on the reactor's own ring, and anything above that is
      // outside it. That correspondence is the whole point of the units.
      const distance = def.radius * fit * 0.5
      const tilt = def.tilt * DEG
      const x = Math.cos(entry.angle) * distance
      const y = Math.sin(entry.angle) * distance
      // Tilting the circle about the screen's horizontal axis trades height for
      // depth, so the path flattens into an ellipse and the far half of it
      // genuinely passes behind the orb.
      entry.mesh.position.set(x, y * Math.cos(tilt), y * Math.sin(tilt))

      // `size` is the longer edge in CSS pixels, so the image keeps its own
      // proportions instead of being squashed into a square.
      const span = def.size * perPx
      const wide = entry.aspect >= 1
      entry.mesh.scale.set(
        wide ? span : span * entry.aspect,
        wide ? span / entry.aspect : span,
        1,
      )
      // Billboarded off the camera's own orientation rather than by lookAt, so
      // the planes stay parallel to the screen instead of each one turning to
      // face a slightly different point.
      entry.mesh.quaternion.copy(state.camera.quaternion)
      entry.mesh.material.opacity = def.opacity
    }
  })

  return <primitive object={group} />
}
