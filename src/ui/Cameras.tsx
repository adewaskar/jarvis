import { useEffect, useState } from 'react'
import { BRIDGE_HTTP_URL } from '../config'
import { useStore, type LanDevice } from '../store'

const REFRESH_MS = 8000
const src = (ip: string, mode: 'snap' | 'live', n = 0) => `${BRIDGE_HTTP_URL}/cam/${ip}/${mode}?n=${n}`
const label = (d: LanDevice) => d.name ?? `Cámara .${d.ip.split('.')[3]}`

/** A still that re-fetches itself, swapping only once the new frame has loaded
 *  so the tile never flashes empty. Staggered by `index` so 18 tiles do not all
 *  ask the bridge at the same instant. */
function Thumb({ d, index, onPick }: { d: LanDevice; index: number; onPick: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    let timer: number
    const load = (n: number) => {
      const next = src(d.ip, 'snap', n)
      const img = new Image()
      img.onload = () => {
        if (!live) return
        setUrl(next)
        setFailed(false)
        timer = window.setTimeout(() => load(n + 1), REFRESH_MS)
      }
      img.onerror = () => {
        if (!live) return
        setFailed(true)
        timer = window.setTimeout(() => load(n + 1), REFRESH_MS * 2)
      }
      img.src = next
    }
    timer = window.setTimeout(() => load(0), index * 400)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [d.ip, index])

  return (
    <button className="cam-tile" onClick={onPick}>
      {url && !failed ? <img src={url} alt="" /> : <span className="cam-empty">{failed ? 'SIN ACCESO' : '···'}</span>}
      <span className="cam-name">{label(d)}</span>
    </button>
  )
}

/** Grid of stills; one click opens that camera as live video, Esc steps back. */
export function Cameras() {
  const open = useStore((s) => s.camerasOpen)
  const setOpen = useStore((s) => s.setCamerasOpen)
  const devices = useStore((s) => s.lan?.devices)
  const [picked, setPicked] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return setPicked(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (picked) setPicked(null)
      else setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, picked, setOpen])

  if (!open) return null
  const cams = (devices ?? []).filter((d) => d.kind === 'camera')
  const one = cams.find((d) => d.ip === picked)

  return (
    <div className="cams" role="dialog" aria-label="Cámaras">
      <div className="cams-bar">
        <span>{one ? label(one) : `CÁMARAS · ${cams.length}`}</span>
        <button onClick={() => (one ? setPicked(null) : setOpen(false))}>{one ? '‹ REJILLA' : 'CERRAR ✕'}</button>
      </div>
      {one ? (
        // Unmounting the <img> drops the connection, which is what stops ffmpeg.
        <img className="cam-live" src={src(one.ip, 'live')} alt={label(one)} />
      ) : (
        <div className="cams-grid">
          {cams.map((d, i) => (
            <Thumb key={d.ip} d={d} index={i} onPick={() => setPicked(d.ip)} />
          ))}
        </div>
      )}
    </div>
  )
}
