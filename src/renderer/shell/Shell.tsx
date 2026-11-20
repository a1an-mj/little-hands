import { useEffect, useState } from 'react'
import type { Theme } from '@shared/ipc-contract'
import { SnackbarProvider } from '../components/Snackbar'
import { AttendanceScreen } from '../screens/attendance/AttendanceScreen'
import { Dashboard } from '../screens/home/Dashboard'
import { FeesScreen } from '../screens/fees/FeesScreen'
import { RecordPayment } from '../screens/fees/RecordPayment'
import { SettingsScreen } from '../screens/settings/SettingsScreen'
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
          onRecordPayment={() => setRoute({ name: 'pay' })}
          onLock={onLock}
        />
        <main className="main" key={route.name === 'student' ? `student-${route.id}-${route.tab ?? ''}` : route.name === 'pay' ? `pay-${route.studentId ?? ''}-${JSON.stringify(route.target ?? '')}` : route.name}>
          {route.name === 'students' && (
            <StudentsList {...common} state={listState} setState={setListState} navigate={setRoute} />
          )}
          {route.name === 'admit' && <AdmissionForm {...common} navigate={setRoute} />}
          {route.name === 'student' && <StudentProfile {...common} id={route.id} tab={route.tab} navigate={setRoute} />}
          {route.name === 'pay' && <RecordPayment {...common} navigate={setRoute} studentId={route.studentId} target={route.target} />}
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
          {route.name === 'fees' && <FeesScreen {...common} navigate={setRoute} />}
          {route.name === 'settings' && <SettingsScreen {...common} />}
        </main>
      </div>
    </SnackbarProvider>
  )
}
