import type { Theme } from '@shared/ipc-contract'
import { MoonIcon, SunIcon } from './icons'

export function ThemeSwitch({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      role="switch"
      className="sw"
      aria-checked={dark}
      onClick={onToggle}
      title="Switch between light and dark"
    >
      Dark theme
      <span className="track">
        <span className="thumb">{dark ? <MoonIcon key="m" /> : <SunIcon key="s" />}</span>
      </span>
    </button>
  )
}
