import { useCallback, useEffect, useState } from 'react'
import type { Theme } from '@shared/ipc-contract'
import { themeTransition } from '../lib/motion'

/**
 * The main process decides the theme: Windows' light/dark setting until the owner uses the
 * switch, then the remembered choice. This hook mirrors it and applies it to <html data-theme>.
 */
export function useTheme(): [Theme, (from?: { x: number; y: number }) => void] {
  const [theme, setTheme] = useState<Theme>(window.lh.theme.initial)

  useEffect(() => window.lh.theme.onChange(setTheme), [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const toggle = useCallback(
    (from?: { x: number; y: number }) => {
      const next: Theme = theme === 'dark' ? 'light' : 'dark'
      const apply = () => {
        setTheme(next) // switch immediately; main confirms with a change event
        document.documentElement.dataset.theme = next
      }
      // The new theme spreads out in a circle from the switch.
      themeTransition(apply, from?.x ?? innerWidth - 60, from?.y ?? 50)
      void window.lh.theme.set(next)
    },
    [theme]
  )

  return [theme, toggle]
}
