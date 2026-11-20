import { useEffect, useRef, useState } from 'react'
import { reducedMotion } from '../lib/motion'

/** A number that counts up to its value (ease-out), e.g. the dashboard figures. */
export function CountUp({ value, format = String, ms = 900, step = 1 }: { value: number; format?: (n: number) => string; ms?: number; step?: number }) {
  const [shown, setShown] = useState(reducedMotion() ? value : 0)
  const from = useRef(shown)
  useEffect(() => {
    if (reducedMotion()) {
      setShown(value)
      return
    }
    const start = performance.now()
    const a = from.current
    let raf = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms)
      const eased = 1 - Math.pow(1 - k, 4)
      const n = k === 1 ? value : a + (value - a) * eased
      from.current = n
      setShown(n)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  // Whole steps while counting (e.g. whole rupees, no flickering paise); the exact value at the end.
  return <span aria-label={format(value)}>{format(shown === value ? value : Math.round(shown / step) * step)}</span>
}
