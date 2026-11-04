import type { ReactNode } from 'react'
import {
  AttendanceIcon,
  FeesIcon,
  HomeIcon,
  LockIcon,
  LogoIcon,
  PlusIcon,
  ReportsIcon,
  SettingsIcon,
  StudentsIcon
} from '../components/icons'

export type Page = 'home' | 'students' | 'fees' | 'attendance'

const DESTINATIONS: { id: Page; label: string; icon: ReactNode }[] = [
  { id: 'home', label: 'Home', icon: <HomeIcon /> },
  { id: 'students', label: 'Students', icon: <StudentsIcon /> },
  { id: 'fees', label: 'Fees', icon: <FeesIcon /> },
  { id: 'attendance', label: 'Attendance', icon: <AttendanceIcon /> }
]

const LATER = [
  { label: 'Reports', icon: <ReportsIcon /> },
  { label: 'Settings', icon: <SettingsIcon /> }
]

interface Props {
  page: Page
  onNavigate: (page: Page) => void
  onRecordPayment: () => void
  onLock: () => void
}

export function NavRail({ page, onNavigate, onRecordPayment, onLock }: Props) {
  return (
    <nav className="rail" aria-label="Main menu">
      <div className="logo" aria-hidden="true">
        <LogoIcon />
      </div>
      <button type="button" className="fab" aria-label="Record a payment" title="Record a payment" onClick={onRecordPayment}>
        <PlusIcon />
      </button>
      {DESTINATIONS.map((d) => (
        <button
          key={d.id}
          type="button"
          className="dest"
          aria-current={page === d.id ? 'page' : undefined}
          onClick={() => onNavigate(d.id)}
        >
          <span className="pill">{d.icon}</span>
          {d.label}
        </button>
      ))}
      {LATER.map((d) => (
        <span key={d.label} className="dest soon" aria-disabled="true" title="Coming in a later version">
          <span className="pill">{d.icon}</span>
          {d.label}
        </span>
      ))}
      <button type="button" className="dest rail-end" onClick={onLock}>
        <span className="pill">
          <LockIcon />
        </span>
        Lock
      </button>
    </nav>
  )
}
