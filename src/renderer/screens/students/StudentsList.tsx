import { useEffect, useState } from 'react'
import type { Theme } from '@shared/ipc-contract'
import { formatPhone } from '@shared/phone'
import { PROGRAM_CODES, PROGRAM_NAME } from '@shared/enrollments'
import { PAGE_SIZE, STATUS_LABEL, STUDENT_STATUSES, type StudentListRow } from '@shared/students'
import { Avatar } from '../../components/Avatar'
import { AddPersonIcon, CheckIcon, SearchIcon } from '../../components/icons'
import { ThemeSwitch } from '../../components/ThemeSwitch'
import { useLoad } from '../../lib/api'
import { formatDate } from '../../lib/format'
import type { ListState, Navigate } from '../../shell/routes'
import { ProgramTag } from './ProgramFields'

interface Props {
  theme: Theme
  onToggleTheme: () => void
  state: ListState
  setState: (s: ListState) => void
  navigate: Navigate
}

export function StudentsList({ theme, onToggleTheme, state, setState, navigate }: Props) {
  // Search as you type, but wait for a short pause before asking the database.
  const [typed, setTyped] = useState(state.search)
  useEffect(() => {
    if (typed === state.search) return
    const t = setTimeout(() => setState({ ...state, search: typed, page: 0 }), 200)
    return () => clearTimeout(t)
  }, [typed, state, setState])

  const { data, error } = useLoad(
    () => window.lh.students.list({ search: state.search, status: state.status, program: state.program, page: state.page }),
    [state.search, state.status, state.program, state.page]
  )

  const counts = data?.counts
  const total = data?.total ?? 0
  const first = state.page * PAGE_SIZE + 1
  const last = Math.min(total, (state.page + 1) * PAGE_SIZE)
  const statusWord = STATUS_LABEL[state.status].toLowerCase() + (state.program === 'all' ? '' : ` ${PROGRAM_NAME[state.program]}`)
  const noStudentsAtAll = counts && counts.active + counts.inactive + counts.graduated === 0

  return (
    <>
      <header className="topbar in">
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <h1 className="h-lg">Students</h1>
          <div className="muted">
            {counts
              ? STUDENT_STATUSES.map((s) => `${counts[s]} ${STATUS_LABEL[s].toLowerCase()}`).join(' · ')
              : ' '}
          </div>
        </div>
        <label className="search">
          <SearchIcon />
          <span className="sr">Search students</span>
          <input
            type="search"
            placeholder="Name, student ID or parent phone"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>
        <ThemeSwitch theme={theme} onToggle={onToggleTheme} />
      </header>

      <div className="in" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, animationDelay: '60ms' }}>
        <div className="seg" role="group" aria-label="Show students who are">
          {STUDENT_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              className="segb"
              aria-pressed={state.status === s}
              onClick={() => setState({ ...state, status: s, page: 0 })}
            >
              {STATUS_LABEL[s]}
              {counts ? ` · ${counts[s]}` : ''}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Program" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {(['all', ...PROGRAM_CODES] as const).map((c) => (
            <button
              key={c}
              type="button"
              className="chip"
              aria-pressed={state.program === c}
              onClick={() => setState({ ...state, program: c, page: 0 })}
            >
              {state.program === c && <CheckIcon />}
              {c === 'all' ? 'All programs' : PROGRAM_NAME[c]}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn filled" onClick={() => navigate({ name: 'admit' })}>
          <AddPersonIcon />
          New admission
        </button>
      </div>

      <section aria-label="Student list" className="card list-card in" style={{ animationDelay: '120ms' }}>
        <div className="lhead small muted" aria-hidden="true">
          <span className="c-student">Student</span>
          <span className="c-progs">Programs</span>
          <span className="c-contact">Main contact</span>
          <span className="c-joined">Joined</span>
        </div>
        {error && <div className="empty" role="alert">{error}</div>}
        {data?.rows.map((r, i) => <Row key={r.id} row={r} delay={i * 30} onOpen={() => navigate({ name: 'student', id: r.id })} />)}
        {data && data.rows.length === 0 && (
          <div className="empty">
            {noStudentsAtAll
              ? 'No students yet. Use "New admission" to add the first child.'
              : state.search || state.program !== 'all'
                ? 'No students match. Try another name or clear the filters.'
                : `No ${statusWord} students.`}
          </div>
        )}
      </section>

      {total > 0 && (
        <div className="list-foot small muted">
          <span>
            Showing {first}–{last} of {total} {statusWord} student{total === 1 ? '' : 's'}, A–Z
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn textb" disabled={state.page === 0} onClick={() => setState({ ...state, page: state.page - 1 })}>
              Previous
            </button>
            <button type="button" className="btn textb" disabled={last >= total} onClick={() => setState({ ...state, page: state.page + 1 })}>
              Next
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function Row({ row, delay, onOpen }: { row: StudentListRow; delay: number; onOpen: () => void }) {
  const c = row.mainContact
  return (
    <button type="button" className="lrow in" style={{ animationDelay: `${delay}ms` }} onClick={onOpen}>
      <span className="c-student">
        <Avatar name={row.fullName} />
        <span style={{ minWidth: 0 }}>
          <span className="t-lg ellip" style={{ display: 'block' }}>{row.fullName}</span>
          <span className="small muted">{row.code}</span>
        </span>
      </span>
      <span className="c-progs">
        {row.programs.length ? row.programs.map((p) => <ProgramTag key={p} code={p} />) : <span className="muted">—</span>}
      </span>
      <span className="c-contact">
        {c ? (
          <>
            <span className="ellip" style={{ display: 'block' }}>
              {c.name ? `${c.name} · ${c.relationship}` : c.relationship}
            </span>
            <span className="small muted">{formatPhone(c.phone)}</span>
          </>
        ) : (
          <span className="muted">—</span>
        )}
      </span>
      <span className="c-joined">{formatDate(row.joiningDate)}</span>
    </button>
  )
}
