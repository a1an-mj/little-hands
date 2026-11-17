import { useEffect, useState } from 'react'
import type { Theme } from '@shared/ipc-contract'
import { SnackbarProvider } from '../components/Snackbar'
import { ThemeSwitch } from '../components/ThemeSwitch'
import { AttendanceScreen } from '../screens/attendance/AttendanceScreen'
import { Dashboard } from '../screens/home/Dashboard'
import { AdmissionForm } from '../screens/students/AdmissionForm'
import { StudentProfile } from '../screens/students/StudentProfile'
import { StudentsList } from '../screens/students/StudentsList'
import { NavRail } from './NavRail'
import { pageOf, type ListState, type Route } from './routes'

interface Props {
  theme: Theme
  onToggleTheme: () => void
  onLock: () => void
}

// Placeholders until each module is built (see "Way of working" in CLAUDE.md).
const SOON = {
  fees: { step: 4, title: 'Fees', text: 'Recording payments, partial payments and balances for each month will appear here.' }
} as const

export function Shell({ theme, onToggleTheme, onLock }: Props) {
  const [route, setRoute] = useState<Route>({ name: 'home' })
  const [listState, setListState] = useState<ListState>({ search: '', status: 'active', program: 'all', page: 0 })
  const common = { theme, onToggleTheme }

  // New screen → start at the top.
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [route])

  return (
    <SnackbarProvider>
      <div className="shell">
        <NavRail
          page={pageOf(route)}
          onNavigate={(page) => setRoute({ name: page } as Route)}
          onRecordPayment={() => setRoute({ name: 'fees' })}
          onLock={onLock}
        />
        <main className="main" key={route.name === 'student' ? `student-${route.id}` : route.name}>
          {route.name === 'students' && (
            <StudentsList {...common} state={listState} setState={setListState} navigate={setRoute} />
          )}
          {route.name === 'admit' && <AdmissionForm {...common} navigate={setRoute} />}
          {route.name === 'student' && <StudentProfile {...common} id={route.id} navigate={setRoute} />}
          {route.name === 'home' && (
            <Dashboard
              {...common}
              navigate={setRoute}
              onSearch={(search) => {
                setListState({ search, status: 'active', program: 'all', page: 0 })
                setRoute({ name: 'students' })
              }}
            />
          )}
          {route.name === 'attendance' && <AttendanceScreen {...common} navigate={setRoute} />}
          {route.name === 'fees' && <Placeholder {...common} page={route.name} />}
        </main>
      </div>
    </SnackbarProvider>
  )
}

function Placeholder({ theme, onToggleTheme, page }: { theme: Theme; onToggleTheme: () => void; page: keyof typeof SOON }) {
  const now = new Date()
  const info = SOON[page]
  return (
    <>
      <header className="topbar in">
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <div className="muted">
            {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
          <h1 className="h-lg">{info.title}</h1>
        </div>
        <ThemeSwitch theme={theme} onToggle={onToggleTheme} />
      </header>
      <section className="card soon-card in" style={{ animationDelay: '60ms' }}>
        <span className="step-chip">Coming in step {info.step}</span>
        <h2 className="h-md">{info.title}</h2>
        <p className="muted" style={{ margin: 0 }}>{info.text}</p>
      </section>
    </>
  )
}
