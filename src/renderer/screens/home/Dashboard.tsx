import { useEffect, useState } from 'react'
import { dayCounts, type SessionView } from '@shared/attendance'
import { ATTENDED_CODES, PROGRAM_NAME } from '@shared/enrollments'
import type { Theme } from '@shared/ipc-contract'
import { formatTime } from '@shared/schedule'
import { formatRupees } from '@shared/money'
import { METHOD_LABEL } from '@shared/payments'
import { Avatar } from '../../components/Avatar'
import { AddPersonIcon, CheckIcon, FeesIcon, SearchIcon } from '../../components/icons'
import { useSnackbar } from '../../components/Snackbar'
import { ThemeSwitch } from '../../components/ThemeSwitch'
import { call, messageOf, useLoad } from '../../lib/api'
import { formatDate } from '../../lib/format'
import type { Navigate } from '../../shell/routes'
import { ProgramTag } from '../students/ProgramFields'
import { CloseDayDialog, ClosedBanner, statusTag } from '../attendance/parts'
import { OwedRow } from '../fees/FeesScreen'

interface Props {
  theme: Theme
  onToggleTheme: () => void
  navigate: Navigate
  /** Opens the students list with this search. */
  onSearch: (text: string) => void
}

type Filter = 'all' | 'not' | 'in'

function greeting(d: Date): string {
  const h = d.getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

const PROGRAM_BAR: Record<string, string> = {
  pg: 'var(--pgs)',
  nu: 'var(--nus)',
  lk: 'var(--lks)',
  uk: 'var(--uks)',
  dc: 'var(--dcs)',
  tu: 'var(--tus)'
}

const monthOf = (iso: string) => new Intl.DateTimeFormat('en-IN', { month: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))

/** Home: today's arrivals first, then the school at a glance (design: Main.html). Fees arrive in step 4. */
export function Dashboard({ theme, onToggleTheme, navigate, onSearch }: Props) {
  const snack = useSnackbar()
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [closing, setClosing] = useState(false)
  const { data: day, error, reload } = useLoad(() => window.lh.attendance.day(), [])
  const { data: summary } = useLoad(() => window.lh.attendance.summary(), [])
  const { data: fees } = useLoad(() => window.lh.payments.overview(), [])

  // Keep the "late" notes up to date while the dashboard is open.
  useEffect(() => {
    const t = setInterval(() => void reload(), 60_000)
    return () => clearInterval(t)
  }, [reload])

  async function tap(s: SessionView, kind: 'arrived' | 'left' | 'absent') {
    const first = s.studentName.split(' ')[0]
    try {
      const { eventId, at } = await call(window.lh.attendance.tap(s.enrollmentId, { kind }))
      void reload()
      const now = formatTime(at)
      const msg =
        kind === 'arrived' ? `${first} marked arrived at ${now}` : kind === 'left' ? `${first} marked as left at ${now}` : `${first} marked absent today`
      snack(msg, {
        label: 'Undo',
        run: () =>
          void call(window.lh.attendance.undo(eventId))
            .then(() => reload())
            .catch((e) => snack(messageOf(e)))
      })
    } catch (e) {
      snack(messageOf(e))
    }
  }

  // The main process's clock, so the date, greeting and late notes all agree.
  async function reopen() {
    try {
      await call(window.lh.attendance.reopenDay(day!.date))
      snack('School is open today')
      await reload()
    } catch (e) {
      snack(messageOf(e))
    }
  }

  const now = day ? new Date(`${day.today}T${day.now}:00`) : new Date()
  const monthName = monthOf(day?.today ?? new Date().toISOString().slice(0, 10))
  const sessions = day?.sessions ?? []
  const waiting = sessions.filter((s) => s.state.status === 'none')
  const arrivedList = sessions.filter((s) => s.state.status === 'in' || s.state.status === 'out')
  const shown = filter === 'not' ? waiting : filter === 'in' ? arrivedList : sessions
  const counts = dayCounts(sessions)
  const pct = counts.expected ? Math.round((counts.arrived / counts.expected) * 100) : 0
  const maxProgram = summary ? Math.max(1, ...ATTENDED_CODES.map((c) => summary.byProgram[c])) : 1

  return (
    <>
      <header className="topbar in">
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <div className="muted">{now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
          <h1 className="h-lg">{greeting(now)}</h1>
        </div>
        <form
          className="search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            onSearch(search.trim())
          }}
        >
          <SearchIcon />
          <label className="sr" htmlFor="home-search">Search students</label>
          <input id="home-search" type="search" placeholder="Search name or student ID" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
        <ThemeSwitch theme={theme} onToggle={onToggleTheme} />
      </header>

      <div className="in" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <button type="button" className="btn filled" onClick={() => navigate({ name: 'fees' })}>
          <FeesIcon />
          Record payment
        </button>
        <button type="button" className="btn tonal" onClick={() => navigate({ name: 'admit' })}>
          <AddPersonIcon />
          New admission
        </button>
      </div>

      <section aria-label="Today at a glance" className="glance">
        <div className="card in stat" style={{ animationDelay: '60ms', background: 'var(--pc)', color: 'var(--opc)' }} data-testid="arrived-today">
          <div style={{ fontWeight: 500 }}>Arrived today</div>
          {day?.closed ? (
            <>
              <div className="t-lg">School closed</div>
              <div className="small">{day.closed.reason || 'Nobody is expected today'}</div>
            </>
          ) : (
            <>
              <div>
                <span className="num">{counts.arrived}</span> <span className="t-lg">of {counts.expected}</span>
              </div>
              <div className="bar" style={{ background: 'color-mix(in srgb, var(--opc) 14%, transparent)' }}>
                <i style={{ width: `${pct}%`, background: 'var(--opc)' }} />
              </div>
              <div className="small">
                {counts.notYet} yet to arrive · {counts.absent} absent
              </div>
            </>
          )}
        </div>
        <div className="card in stat" style={{ animationDelay: '120ms' }}>
          <div className="muted" style={{ fontWeight: 500 }}>Active students</div>
          <div className="num">{summary?.activeStudents ?? '—'}</div>
          <div className="small muted">
            {summary ? `${summary.kgAndTuition} attend kindergarten + Tuition` : ' '}
          </div>
        </div>
        <div className="card in stat" style={{ animationDelay: '180ms' }} data-testid="collected-month">
          <div className="muted" style={{ fontWeight: 500 }}>Collected in {monthName}</div>
          <div className="num">{fees ? formatRupees(fees.collectedThisMonthPaise) : '—'}</div>
          <div className="bar">
            <i style={{ width: `${fees && fees.dueThisMonthPaise ? Math.min(100, Math.round((fees.collectedThisMonthPaise / fees.dueThisMonthPaise) * 100)) : 0}%` }} />
          </div>
          <div className="small muted">{fees ? `of ${formatRupees(fees.dueThisMonthPaise)} due this month` : ' '}</div>
        </div>
        <div className="card in stat stat-owe" style={{ animationDelay: '240ms' }} data-testid="outstanding-earlier">
          <div style={{ fontWeight: 500 }}>Outstanding from earlier</div>
          <div className="num">{fees ? formatRupees(fees.outstandingEarlierPaise) : '—'}</div>
          <div className="small">
            {fees && fees.outstandingStudents > 0
              ? `${fees.outstandingStudents} ${fees.outstandingStudents === 1 ? 'student' : 'students'} · oldest from ${monthOf(fees.oldestDue!)}`
              : 'Nothing from earlier months'}
          </div>
        </div>
      </section>

      <div className="dash-row">
        <section aria-labelledby="arr-h" className="card in" style={{ flex: '2 1 600px', minWidth: 0, animationDelay: '240ms' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
            <h2 id="arr-h" className="h-md">Today's arrivals</h2>
            {!day?.closed && (
              <div className="seg" role="group" aria-label="Filter arrivals">
                {(
                  [
                    ['all', 'All'],
                    ['not', `Not yet · ${waiting.length}`],
                    ['in', `Arrived · ${arrivedList.length}`]
                  ] as [Filter, string][]
                ).map(([f, label]) => (
                  <button key={f} type="button" className="segb" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                    {filter === f && <CheckIcon />}
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {error && <div className="empty" role="alert">{error}</div>}
          {day?.closed && <ClosedBanner closed={day.closed} onReopen={() => void reopen()} />}
          {!day?.closed && (
            <ul className="plain" aria-label="Arrivals">
              {shown.map((s) => (
                <ArrivalRow key={s.enrollmentId} s={s} onTap={(k) => void tap(s, k)} onOpen={() => navigate({ name: 'student', id: s.studentId })} />
              ))}
            </ul>
          )}
          {day && !day.closed && shown.length === 0 && (
            <p className="muted" style={{ margin: 0, padding: '24px 0', textAlign: 'center' }}>
              {sessions.length === 0
                ? 'No one is expected today.'
                : filter === 'in'
                  ? 'No one has arrived yet.'
                  : 'Everyone expected today has been marked.'}
            </p>
          )}
          <div className="row" style={{ paddingTop: 12, display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
            <button type="button" className="btn textb" onClick={() => navigate({ name: 'attendance' })}>
              Open attendance for everyone
            </button>
            {day && !day.closed && (
              <button type="button" className="btn textb" onClick={() => setClosing(true)}>
                School closed today
              </button>
            )}
          </div>
          {closing && day && (
            <CloseDayDialog
              dateText="today"
              onClose={() => setClosing(false)}
              onConfirm={async (reason) => {
                try {
                  await call(window.lh.attendance.closeDay(day.date, { reason }))
                  setClosing(false)
                  snack('Marked as closed today')
                  await reload()
                } catch (e) {
                  snack(messageOf(e))
                }
              }}
            />
          )}
        </section>

        <section className="card in" style={{ flex: '1 1 320px', minWidth: 0, animationDelay: '300ms' }} aria-labelledby="fee-h" data-testid="follow-up">
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
            <h2 id="fee-h" className="h-md">Fees to follow up</h2>
            <span className="muted">{fees ? formatRupees(fees.owed.reduce((s, x) => s + x.balancePaise, 0)) : ''}</span>
          </div>
          {fees && fees.owed.length === 0 && <p className="muted">Nobody owes anything today.</p>}
          <ul className="plain">
            {fees?.owed.slice(0, 5).map((x) => (
              <OwedRow
                key={`${x.studentId}|${x.forText}`}
                x={x}
                onOpen={() => navigate({ name: 'student', id: x.studentId, tab: 'fees' })}
              />
            ))}
          </ul>
          <div className="row" style={{ paddingTop: 12, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" className="btn textb" onClick={() => navigate({ name: 'pay' })}>
              Collect a payment
            </button>
            {fees && fees.owed.length > 5 && (
              <button type="button" className="btn textb" onClick={() => navigate({ name: 'fees' })}>
                See all {fees.owed.length}
              </button>
            )}
          </div>
        </section>
      </div>

      <section aria-labelledby="pay-h" className="card in" style={{ animationDelay: '330ms' }} data-testid="recent-payments">
        <h2 id="pay-h" className="h-md" style={{ marginBottom: 12 }}>Recent payments</h2>
        {fees && fees.recent.length === 0 && <p className="muted" style={{ margin: 0 }}>No payments yet.</p>}
        <ul className="plain">
          {fees?.recent.map((p) => (
            <li key={p.id} className="row owe-row">
              <div className="small muted" style={{ flex: '0 0 96px' }}>
                {p.paidAt.slice(0, 10) === day?.today ? 'Today' : formatDate(p.paidAt.slice(0, 10))}
                <br />
                {formatTime(p.paidAt.slice(11))}
              </div>
              <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                <button type="button" className="linkish t-lg" onClick={() => navigate({ name: 'student', id: p.studentId, tab: 'fees' })}>
                  {p.studentName}
                </button>
                <div className="small muted">
                  {p.no} · {p.forText}
                </div>
              </div>
              {p.kind === 'payment' && <span className="tag nt">{METHOD_LABEL[p.method]}</span>}
              <div className="t-lg" style={{ flex: '0 0 100px', textAlign: 'right' }}>
                {formatRupees(p.amountPaise)}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <div className="dash-row">
        <section aria-labelledby="cls-h" className="card in" style={{ flex: '2 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16, animationDelay: '360ms' }}>
          <h2 id="cls-h" className="h-md">Students by program</h2>
          {ATTENDED_CODES.map((c) => (
            <div key={c} data-testid={`by-program-${c}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span>{PROGRAM_NAME[c]}</span>
                <span className="t-lg">{summary?.byProgram[c] ?? '—'}</span>
              </div>
              <div className="bar">
                <i style={{ width: `${summary ? Math.round((summary.byProgram[c] / maxProgram) * 100) : 0}%`, background: PROGRAM_BAR[c] }} />
              </div>
            </div>
          ))}
          {summary && summary.kgAndTuition > 0 && (
            <p className="small muted" style={{ margin: 0 }}>
              Tuition includes {summary.kgAndTuition} kindergarten {summary.kgAndTuition === 1 ? 'child' : 'children'}, so programs add up to more than {summary.activeStudents}.
            </p>
          )}
        </section>

        <section aria-labelledby="adm-h" className="card in" style={{ flex: '2 1 300px', minWidth: 0, animationDelay: '420ms' }}>
          <h2 id="adm-h" className="h-md" style={{ marginBottom: 12 }}>Recent admissions</h2>
          {summary && summary.recentAdmissions.length === 0 && <p className="muted">No students yet.</p>}
          <ul className="plain">
            {summary?.recentAdmissions.map((r) => (
              <li key={r.id} className="row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
                <Avatar name={r.fullName} />
                <button type="button" className="linkish" style={{ flex: '1 1 auto' }} onClick={() => navigate({ name: 'student', id: r.id })}>
                  <span className="t-lg" style={{ display: 'block' }}>{r.fullName}</span>
                  <span className="small muted">
                    {[r.programs.map((p) => PROGRAM_NAME[p]).join(' + '), formatDate(r.joiningDate)].filter(Boolean).join(' · ')}
                  </span>
                </button>
                {!r.hasPhoto && (
                  <button type="button" className="btn textb" onClick={() => navigate({ name: 'student', id: r.id })}>
                    Add photo
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  )
}

function ArrivalRow({ s, onTap, onOpen }: { s: SessionView; onTap: (k: 'arrived' | 'left' | 'absent') => void; onOpen: () => void }) {
  const who = `${s.studentName}, ${PROGRAM_NAME[s.program]}`
  const tag = statusTag(s.state, { isToday: true })
  return (
    <li className="row arrival" data-testid="arrival">
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: '2 1 200px', minWidth: 0 }}>
        <Avatar name={s.studentName} />
        <div style={{ minWidth: 0 }}>
          <button type="button" className="linkish t-lg" onClick={onOpen}>
            {s.studentName}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <ProgramTag code={s.program} />
            {!s.expected && <span className="small muted">Not a usual day</span>}
          </div>
        </div>
      </div>
      <div style={{ flex: '1 1 140px' }}>
        <span className={`${tag.cls} pop`}>{tag.text}</span>
      </div>
      <div className="arrival-actions">
        {s.state.status === 'none' && (
          <button type="button" className="btn filled pop" aria-label={`Arrived: ${who}`} onClick={() => onTap('arrived')}>
            <CheckIcon />
            Arrived
          </button>
        )}
        {s.state.status === 'none' && (
          <button type="button" className="btn outlined pop" aria-label={`Absent: ${who}`} onClick={() => onTap('absent')}>
            Absent
          </button>
        )}
        {s.state.status === 'in' && (
          <button type="button" className="btn tonal pop" aria-label={`Mark left: ${who}`} onClick={() => onTap('left')}>
            Mark left
          </button>
        )}
      </div>
    </li>
  )
}
