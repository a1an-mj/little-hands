import { useEffect, useState, type ReactNode } from 'react'
import type { Theme } from '@shared/ipc-contract'
import { LogoIcon } from './icons'
import { ThemeSwitch } from './ThemeSwitch'

interface Props {
  theme: Theme
  onToggleTheme: () => void
  title: string
  subtitle: ReactNode
  wide?: boolean
  children: ReactNode
}

/** The centred card used by the lock, PIN setup and recovery screens (design/Lock.html). */
export function LockLayout({ theme, onToggleTheme, title, subtitle, wide, children }: Props) {
  return (
    <div className="lock-page">
      <div className="lock-switch">
        <ThemeSwitch theme={theme} onToggle={onToggleTheme} />
      </div>
      <div className="lock-center">
        <div className={wide ? 'lock-card wide card-in' : 'lock-card card-in'}>
          <div className="lock-logo" aria-hidden="true">
            <LogoIcon size={44} />
          </div>
          <div className="lock-title">
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

/** Seconds left until `until` (a timestamp), ticking every second; 0 once it has passed. */
export function useSecondsLeft(until: number | null): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (until === null) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [until])
  return until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000))
}

export function waitMessage(seconds: number): string {
  return `Too many wrong tries. Please wait ${seconds} second${seconds === 1 ? '' : 's'}.`
}
