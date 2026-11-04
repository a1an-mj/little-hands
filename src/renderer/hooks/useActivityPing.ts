import { useEffect } from 'react'

const EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const
const THROTTLE_MS = 10_000

/** While unlocked, tells the main process the owner is active (at most every 10 s) so it can auto-lock when idle. */
export function useActivityPing(active: boolean): void {
  useEffect(() => {
    if (!active) return
    let last = 0
    const ping = () => {
      const now = Date.now()
      if (now - last < THROTTLE_MS) return
      last = now
      window.lh.lock.activity()
    }
    ping()
    for (const e of EVENTS) window.addEventListener(e, ping, { passive: true })
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, ping)
    }
  }, [active])
}
