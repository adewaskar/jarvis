import { useCallback, useEffect, useRef, useState } from 'react'
import { watchConfirm, watchConfirmCancel, watchGuard, type ConfirmCard } from '../lib/bridge'

/**
 * The approval card, and the "private session" chip beside it.
 *
 * Voice is a poor channel for "are you sure": JARVIS's own speech, a video
 * playing in a blade, or someone else in the room can all say "yes". So an
 * approval is a key press — Enter to allow, Escape to decline — or a click on
 * the card. Nothing the model writes reaches this component; it only renders
 * what the bridge sent, as text.
 *
 * Three rules keep an approval deliberate:
 *   - Only real input counts. An event a script made (`isTrusted` false) is
 *     ignored, which also means the hand-gesture pointer cannot approve: a
 *     misread pinch should not be able to run a shell command.
 *   - A card is deaf for a moment after it appears, to keys and clicks alike,
 *     so an Enter or a click already on its way cannot approve something unseen.
 *   - Cards queue, oldest first, and one answer answers one card.
 *
 * The bridge withdraws a card when its turn ends or is interrupted; a card that
 * nobody answers gives up as a "no" shortly before the bridge stops waiting.
 */

const ARM_MS = 600
const GIVE_UP_MS = 55_000

type Pending = ConfirmCard & { resolve: (ok: boolean) => void; timer: number }

export function Confirm() {
  const [queue, setQueue] = useState<Pending[]>([])
  const [isPrivate, setPrivate] = useState(false)
  /** Answers are given outside the state updater, so each is given once. */
  const pending = useRef(new Map<string, Pending>())
  /** Which card is at the front, and since when — for the arming delay. */
  const front = useRef<{ id: string; at: number } | null>(null)
  const current = queue[0]

  const settle = useCallback((id: string | null, ok: boolean) => {
    const ids = id === null ? [...pending.current.keys()] : [id]
    for (const one of ids) {
      const card = pending.current.get(one)
      if (!card) continue
      pending.current.delete(one)
      // The bridge numbers cards afresh on each connection, so a timer left
      // running here could decline a later card that happens to share the id.
      window.clearTimeout(card.timer)
      card.resolve(ok)
    }
    setQueue((q) => q.filter((p) => pending.current.has(p.id)))
  }, [])

  useEffect(() => {
    watchConfirm(
      (card) =>
        new Promise<boolean>((resolve) => {
          // An id already on screen is answered as a no before it is replaced.
          settle(card.id, false)
          const timer = window.setTimeout(() => settle(card.id, false), GIVE_UP_MS)
          const entry = { ...card, resolve, timer }
          pending.current.set(card.id, entry)
          setQueue((q) => [...q, entry])
        }),
    )
    watchConfirmCancel((id) => settle(id, false))
    watchGuard(setPrivate)
    return () => {
      watchConfirm(null)
      watchConfirmCancel(null)
      watchGuard(null)
      // Unmounting answers everything outstanding, as a no.
      settle(null, false)
    }
  }, [settle])

  // The arming clock starts when a card reaches the front, not when it queued.
  if (current && front.current?.id !== current.id) {
    front.current = { id: current.id, at: performance.now() }
  } else if (!current) {
    front.current = null
  }

  /** True once the front card has been on screen long enough to be read. */
  const armed = useCallback(
    (id: string) => front.current?.id === id && performance.now() - front.current.at >= ARM_MS,
    [],
  )

  useEffect(() => {
    if (!current) return
    const id = current.id
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return
      // Ours while a card is up: Escape must not also stand JARVIS down, and
      // Enter must not reach anything behind the card.
      e.preventDefault()
      e.stopImmediatePropagation()
      if (!e.isTrusted || e.repeat || !armed(id)) return
      settle(id, e.key === 'Enter')
    }
    // Capture phase, so this runs before the app's own key handler.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [current, armed, settle])

  const onButton = (id: string, ok: boolean) => (e: React.MouseEvent) => {
    if (!e.nativeEvent.isTrusted || !armed(id)) return
    settle(id, ok)
  }

  return (
    <>
      {isPrivate && (
        <div className="guard-chip" title="Private data has been read in this session. New sites need your approval.">
          PRIVATE · NEW SITES NEED APPROVAL
        </div>
      )}
      {current && (
        <div className={`confirm confirm-${current.kind}`} role="alertdialog" aria-label={current.title}>
          <div className="confirm-head">
            {current.kind === 'leak'
              ? 'PRIVATE DATA · APPROVAL NEEDED'
              : current.kind === 'site'
                ? 'NEW SITE · APPROVAL NEEDED'
                : 'APPROVAL NEEDED'}
            {queue.length > 1 && <span className="confirm-more"> · {queue.length - 1} more</span>}
          </div>
          <div className="confirm-title">{current.title}</div>
          {current.tool && <div className="confirm-tool">{current.tool}</div>}
          {current.detail && <pre className="confirm-detail">{current.detail}</pre>}
          {current.note && <div className="confirm-note">{current.note}</div>}
          <div className="confirm-actions">
            <button type="button" className="confirm-deny" onClick={onButton(current.id, false)}>
              Decline <kbd>Esc</kbd>
            </button>
            <button type="button" className="confirm-allow" onClick={onButton(current.id, true)}>
              Allow <kbd>Enter</kbd>
            </button>
          </div>
        </div>
      )}
    </>
  )
}
