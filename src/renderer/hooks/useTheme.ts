import { useCallback, useEffect, useState } from 'react'
import type { Theme } from '@shared/ipc-contract'

/**
 * The main process decides the theme: Windows' light/dark setting until the owner uses the
 * switch, then the remembered choice. This hook mirrors it and applies it to <html data-theme>.
 */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(window.lh.theme.initial)

  useEffect(() => window.lh.theme.onChange(setTheme), [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next) // switch immediately; main confirms with a change event
    void window.lh.theme.set(next)
  }, [theme])

  return [theme, toggle]
}
