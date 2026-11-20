import { flushSync } from 'react-dom'

/** True when Windows asks for less motion ("Show animations" off). */
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

type VT = { finished: Promise<void> }
type Doc = Document & { startViewTransition?: (cb: () => void) => VT }

/**
 * Runs a React state change as a view transition (the browser morphs the old screen into the new
 * one). `kind` becomes a class on <html> for the duration, so CSS can pick the animation.
 * Falls back to a plain update when motion is reduced or the API is missing.
 */
export function transition(update: () => void, kind = 'vt-page'): void {
  const doc = document as Doc
  if (!doc.startViewTransition || reducedMotion()) {
    update()
    return
  }
  const root = document.documentElement
  root.classList.add(kind)
  const vt = doc.startViewTransition(() => flushSync(update))
  void vt.finished.finally(() => root.classList.remove(kind))
}

/** Theme switch: the new theme grows in a circle from the point that was clicked. */
export function themeTransition(update: () => void, x: number, y: number): void {
  const root = document.documentElement
  root.style.setProperty('--vt-x', `${x}px`)
  root.style.setProperty('--vt-y', `${y}px`)
  const far = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  root.style.setProperty('--vt-r', `${Math.ceil(far)}px`)
  transition(update, 'vt-theme')
}
