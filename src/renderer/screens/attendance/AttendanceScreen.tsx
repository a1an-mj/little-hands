import { useMemo, useState } from 'react'
import { type SessionView } from '@shared/attendance'
import { formatDayLong } from '@shared/dates'
import { PROGRAM_CODES, PROGRAM_NAME, type ProgramCode } from '@shared/enrollments'
import type { Theme } from '@shared/ipc-contract'
import { formatTimeRange } from '@shared/schedule'
import { Avatar } from '../../components/Avatar'
import { AttendanceIcon, CheckIcon, SearchIcon } from '../../components/icons'
import { useSnackbar } from '../../components/Snackbar'
import { TextField } from '../../components/TextField'
import { ThemeSwitch } from '../../components/ThemeSwitch'
import { call, messageOf, useLoad } from '../../lib/api'
import type { Navigate } from '../../shell/routes'
import { ProgramTag } from '../students/ProgramFields'
import { statusTag } from './parts'

interface Props {
  theme: Theme
  onToggleTheme: () => void
  navigate: Navigate
}

type Mark = 'present' | 'absent' | 'none'

const markOf = (s: SessionView): Mark =>
  s.state.status === 'in' || s.state.status === 'out' ? 'present' : s.state.status === 'absent' ? 'absent' : 'none'

/**
 * "Mark attendance": Present / Absent for everyone expected on a day, then Save
 * (design: Students.html, attendance mode). Opens on today; earlier days can be filled in too.
 */
export function AttendanceScreen({ theme, onToggleTheme, navigate }: Props) {
  const snack = useSnackbar()
  const [date, setDate] = useState<string | null>(null) // null = today, as the laptop sees it
  const [program, setProgram] = useState<ProgramCode | 'all'>('all')
  const [search, setSearch] = useState('')
  const [marks, setMarks] = useState<Record<string, Mark>>({})
  const [busy, setBusy] = useState(false)
  const { data: day, error, reload } = useLoad(() => window.lh.attendance.day(date ?? undefined), [date])

  const sessions = useMemo(() => day?.sessions ?? [], [day])
  const markFor = (s: SessionView): Mark => marks[s.enrollmentId] ?? markOf(s)
  const changed = sessions.filter((s) => marks[s.enrollmentId] !== undefined && marks[s.enrollmentId] !== markOf(s))
  const dirty = changed.length > 0

  const q = search.trim().toLowerCase()
  const shown = sessions.filter(
    (s) => (program === 'all' || s.program === program) && (!q || `${s.studentName} ${s.studentCode}`.toLowerCase().includes(q))
  )
  const nPresent = sessions.filter((s) => markFor(s) === 'present').length
  const nAbsent = sessions.filter((s) => markFor(s) === 'absent').length
  const nLeft = sessions.length - nPresent - nAbsent

  const set = (s: SessionView, m: Mark) => setMarks((cur) => ({ ...cur, [s.enrollmentId]: markFor(s) === m ? 'none' : m }))

  function restPresent() {
    const next = { ...marks }
    for (const s of shown) if (markFor(s) === 'none') next[s.enrollmentId] = 'present'
    setMarks(next)
  }

  async function save() {
    if (!day) return
    setBusy(true)
    try {
      await call(
        window.lh.attendance.setMany(
          day.date,
          changed.map((s) => ({ enrollmentId: s.enrollmentId, day: { status: markFor(s) } }))
        )
      )
      snack(`Attendance saved · ${nPresent} present, ${nAbsent} absent`)
      setMarks({})
      await reload()
    } catch (e) {
      snack(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="topbar in">
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <h1 className="h-lg">Attendance</h1>
          <div className="muted">Present or absent for each program the child attends that day</div>
        </div>
        <label className="search">
          <SearchIcon />
          <span className="sr">Search students</span>
          <input type="search" placeholder="Name or student ID" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <ThemeSwitch theme={theme} onToggle={onToggleTheme} />
      </header>

      <div className="in" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, animationDelay: '60ms' }}>
        <div style={{ width: 200 }}>
          <TextField
            label="Day"
            type="date"
            value={day?.date ?? ''}
            max={day?.today}
            readOnly={dirty}
            help={dirty ? 'Save or cancel first' : undefined}
            onChange={(v) => v && v <= (day?.today ?? v) && setDate(v)}
          />
        </div>
        <div role="group" aria-label="Program" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {(['all', ...PROGRAM_CODES] as const).map((c) => (
            <button key={c} type="button" className="chip" aria-pressed={program === c} onClick={() => setProgram(c)}>
              {program === c && <CheckIcon />}
              {c === 'all' ? 'All programs' : PROGRAM_NAME[c]}
            </button>
          ))}
        </div>
      </div>

      <section aria-labelledby="att-h" className="attbar in" style={{ animationDelay: '100ms' }}>
        <AttendanceIcon />
        <div style={{ flex: '1 1 220px' }}>
          <h2 id="att-h" className="t-lg" style={{ margin: 0 }}>
            Attendance · {day ? formatDayLong(day.date) : ''}
          </h2>
          <div data-testid="att-counts">
            {nPresent} present · {nAbsent} absent · {nLeft} not marked yet
          </div>
        </div>
        <button type="button" className="btn on-pc" onClick={restPresent} disabled={shown.every((s) => markFor(s) !== 'none')}>
          Mark the rest present
        </button>
        <button
          type="button"
          className="btn textb"
          style={{ color: 'inherit' }}
          onClick={() => (dirty ? setMarks({}) : navigate({ name: 'students' }))}
        >
          {dirty ? 'Cancel' : 'Close'}
        </button>
        <button type="button" className="btn filled" onClick={() => void save()} disabled={!dirty || busy}>
          <CheckIcon />
          Save
        </button>
      </section>

      <section aria-label="Mark attendance" className="card in" style={{ animationDelay: '140ms' }}>
        {error && <div className="empty" role="alert">{error}</div>}
        {shown.map((s) => {
          const m = markFor(s)
          const saved = marks[s.enrollmentId] === undefined || marks[s.enrollmentId] === markOf(s)
          const tag = saved ? statusTag(s.state, s.arrives, { isToday: day!.date === day!.today, now: day!.now }) : null
          return (
            <div key={s.enrollmentId} className="arow" data-testid="att-row">
              <span style={{ flex: '2 1 240px', display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
                <Avatar name={s.studentName} />
                <span style={{ minWidth: 0 }}>
                  <span className="t-lg" style={{ display: 'block' }}>{s.studentName}</span>
                  <span className="small muted">{tag ? tag.text : m === 'none' ? 'Not marked yet' : 'Not saved yet'}</span>
                </span>
              </span>
              <span style={{ flex: '1 1 200px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <ProgramTag code={s.program} />
                <span className="small muted">{s.arrives && s.leaves ? formatTimeRange(s.arrives, s.leaves) : 'Not a usual day'}</span>
              </span>
              <span className="seg" role="group" aria-label={`Attendance for ${s.studentName}, ${PROGRAM_NAME[s.program]}`}>
                <button type="button" className="segb yes" aria-pressed={m === 'present'} onClick={() => set(s, 'present')}>
                  {m === 'present' && <CheckIcon />}
                  Present
                </button>
                <button type="button" className="segb no" aria-pressed={m === 'absent'} onClick={() => set(s, 'absent')}>
                  {m === 'absent' && <CheckIcon />}
                  Absent
                </button>
              </span>
            </div>
          )
        })}
        {day && shown.length === 0 && (
          <div className="empty">
            {sessions.length === 0 ? 'No one is expected on this day.' : 'No students match. Try another name or clear the filters.'}
          </div>
        )}
      </section>
    </>
  )
}
