import { useStore, type LanDevice } from '../store'

const NEW_FOR_MS = 30_000

/** "10.0.0.7" -> ".7": the subnet is the same for everyone, the tail is what tells them apart. */
const tail = (ip: string) => '.' + ip.split('.')[3]

function Row({ d, isNew }: { d: LanDevice; isNew: boolean }) {
  return (
    <div className={`lan-row${d.alive ? '' : ' lan-standby'}${isNew ? ' lan-new' : ''}`}>
      <span className="lan-name">
        {d.name ?? (d.rand ? 'Teléfono / portátil' : 'Desconocido')}
      </span>
      {isNew && <span className="lan-tag">NUEVO</span>}
      <span className="lan-ip">{tail(d.ip)}</span>
    </div>
  )
}

/**
 * Live view of what is on the local network. Cameras and speakers are counted as
 * groups (18 identical rows would bury the rest); everything else is listed.
 * Cameras are only counted here, never opened.
 */
export function Lan() {
  const lan = useStore((s) => s.lan)
  if (!lan) return null

  const { devices, joined, at } = lan
  const alive = devices.filter((d) => d.alive)
  const standby = devices.length - alive.length
  const cams = devices.filter((d) => d.kind === 'camera')
  const sonos = devices.filter((d) => d.kind === 'sonos')
  const rest = devices.filter((d) => d.kind !== 'camera' && d.kind !== 'sonos')

  return (
    <aside className="lan" aria-label="Dispositivos en la red">
      <div className="rail-title">RED · {alive.length} ACTIVOS</div>
      <div className="lan-group">
        <span>CÁMARAS</span>
        <b>{cams.length}</b>
      </div>
      <div className="lan-group">
        <span>SONOS</span>
        <b>{sonos.length}</b>
      </div>
      <div className="lan-list">
        {rest.map((d) => (
          <Row key={d.mac} d={d} isNew={at - (joined[d.mac] ?? 0) < NEW_FOR_MS} />
        ))}
      </div>
      {standby > 0 && <div className="lan-foot">{standby} en espera</div>}
    </aside>
  )
}
