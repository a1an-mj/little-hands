import { useState } from 'react'
import type { Theme } from '@shared/ipc-contract'
import { ThemeSwitch } from '../components/ThemeSwitch'
import { NavRail, type Page } from './NavRail'

interface Props {
  theme: Theme
  onToggleTheme: () => void
  onLock: () => void
}

// Placeholders until each module is built (see "Way of working" in CLAUDE.md).
const PAGES: Record<Page, { title: string; step: number; text: string }> = {
  home: {
    step: 5,
    title: 'Good day',
    text: "Today's arrivals and the fees to follow up will appear here."
  },
  students: {
    step: 2,
    title: 'Students',
    text: 'The list of children, their parents and guardians, and the admission form will appear here.'
  },
  fees: {
    step: 4,
    title: 'Fees',
    text: 'Recording payments, partial payments and balances for each month will appear here.'
  },
  attendance: {
    step: 5,
    title: 'Attendance',
    text: 'Marking arrivals, departures and absences will appear here.'
  }
}

function greeting(d: Date): string {
  const h = d.getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export function Shell({ theme, onToggleTheme, onLock }: Props) {
  const [page, setPage] = useState<Page>('home')
  const now = new Date()
  const info = PAGES[page]
  const title = page === 'home' ? greeting(now) : info.title

  return (
    <div className="shell">
      <NavRail page={page} onNavigate={setPage} onRecordPayment={() => setPage('fees')} onLock={onLock} />
      <main className="main">
        <header className="topbar in" key={`h-${page}`}>
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <div className="muted">
              {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
            <h1 className="h-lg">{title}</h1>
          </div>
          <ThemeSwitch theme={theme} onToggle={onToggleTheme} />
        </header>
        <section className="card soon-card in" key={`c-${page}`} style={{ animationDelay: '60ms' }}>
          <span className="step-chip">Coming in step {info.step}</span>
          <h2 className="h-md">{page === 'home' ? 'Dashboard' : info.title}</h2>
          <p className="muted" style={{ margin: 0 }}>{info.text}</p>
        </section>
      </main>
    </div>
  )
}
