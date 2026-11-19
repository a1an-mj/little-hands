import { useState } from 'react'
import { formatDate } from '@shared/dates'
import type { Theme } from '@shared/ipc-contract'
import { formatRupees } from '@shared/money'
import { METHOD_LABEL, type OwedItem } from '@shared/payments'
import { dueText } from '@shared/periods'
import { PAYMENT_METHODS } from '@shared/schemas'
import { PROGRAM_NAME } from '@shared/enrollments'
import { Avatar } from '../../components/Avatar'
import { FeesIcon, SearchIcon } from '../../components/icons'
import { TextField } from '../../components/TextField'
import { ThemeSwitch } from '../../components/ThemeSwitch'
import { useLoad } from '../../lib/api'
import type { Navigate } from '../../shell/routes'

interface Props {
  theme: Theme
  onToggleTheme: () => void
  navigate: Navigate
}

const monthName = (ym: string) =>
  new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-01T00:00:00Z`))

/** Fees: everyone who owes (longest due first) and the monthly report. */
export function FeesScreen({ theme, onToggleTheme, navigate }: Props) {
  const { data: o, error } = useLoad(() => window.lh.payments.overview(), [])
  const [month, setMonth] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const shownMonth = month ?? o?.today.slice(0, 7) ?? null
  // Waits for the overview to know this month (the laptop's clock lives in the main process).
  const { data: r } = useLoad(() => (shownMonth ? window.lh.payments.monthReport(shownMonth) : new Promise<never>(() => {})), [shownMonth])

  const ql = q.trim().toLowerCase()
  const owed = (o?.owed ?? []).filter((x) => !ql || `${x.studentName} ${x.studentCode} ${x.forText}`.toLowerCase().includes(ql))
  const owedTotal = owed.reduce((s, x) => s + x.balancePaise, 0)

  return (
    <>
      <header className="topbar in">
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <h1 className="h-lg">Fees</h1>
          <div className="muted">Who owes, and what came in each month</div>
        </div>
        <label className="search">
          <SearchIcon />
          <span className="sr">Search who owes</span>
          <input type="search" placeholder="Name, student ID or fee" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <ThemeSwitch theme={theme} onToggle={onToggleTheme} />
      </header>

      <div className="in" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <button type="button" className="btn filled" onClick={() => navigate({ name: 'pay' })}>
          <FeesIcon />
          Record payment
        </button>
      </div>

      {error && <div className="card empty" role="alert">{error}</div>}

      <div className="dash-row">
        <section className="card in" aria-labelledby="owe-h" style={{ flex: '3 1 520px', minWidth: 0 }} data-testid="who-owes">
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
            <h2 id="owe-h" className="h-md">Fees to follow up</h2>
            <span className="muted">
              {owed.length} · {formatRupees(owedTotal)}
            </span>
          </div>
          {o && owed.length === 0 && <p className="muted">{ql ? 'No one matches.' : 'Nobody owes anything today.'}</p>}
          <ul className="plain">
            {owed.map((x) => (
              <OwedRow key={`${x.studentId}|${x.forText}`} x={x} onOpen={() => navigate({ name: 'student', id: x.studentId, tab: 'fees' })} onCollect={() => navigate({ name: 'pay', studentId: x.studentId, target: x.target })} />
            ))}
          </ul>
        </section>

        <section className="card in" aria-labelledby="rep-h" style={{ flex: '2 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }} data-testid="month-report">
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <h2 id="rep-h" className="h-md">Monthly report</h2>
            <div style={{ width: 200 }}>
              <TextField label="Month" type="month" value={shownMonth ?? ''} max={o?.today.slice(0, 7)} onChange={(v) => v && setMonth(v)} />
            </div>
          </div>
          {r && (
            <>
              <div>
                <div className="small muted">Collected in {monthName(r.month)}</div>
                <div className="big" data-testid="collected">{formatRupees(r.collectedPaise)}</div>
              </div>
              <div>
                <h3 className="h-sm">By program</h3>
                {r.byProgram.length === 0 && <div className="muted small">Nothing collected.</div>}
                {r.byProgram.map((b) => (
                  <div key={b.label} className="sumline row" style={{ padding: '8px 0' }}>
                    <span>{b.label}</span>
                    <span className="t-lg">{formatRupees(b.paise)}</span>
                  </div>
                ))}
              </div>
              <div>
                <h3 className="h-sm">By payment method</h3>
                {PAYMENT_METHODS.map((m) => (
                  <div key={m} className="sumline row" style={{ padding: '8px 0' }}>
                    <span>{METHOD_LABEL[m]}</span>
                    <span className="t-lg">{formatRupees(r.byMethod[m])}</span>
                  </div>
                ))}
              </div>
              <div>
                <h3 className="h-sm">Concessions given · {formatRupees(r.concessionTotalPaise)}</h3>
                {r.concessions.length === 0 && <div className="muted small">None this month.</div>}
                {r.concessions.map((c, i) => (
                  <div key={i} className="sumline row" style={{ padding: '8px 0' }}>
                    <span>
                      {c.studentName} <span className="small muted">· {PROGRAM_NAME[c.program]}{c.reason ? ` · ${c.reason}` : ''}</span>
                    </span>
                    <span>{formatRupees(c.concessionPaise)}</span>
                  </div>
                ))}
              </div>
              <div className="sumline total">
                <span>Still owed (fees due by the end of the month)</span>
                <span className="t-lg">{formatRupees(r.owed.reduce((s, x) => s + x.balancePaise, 0))}</span>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  )
}

/** One thing owed. `onCollect` adds a "Collect" button (the dashboard's narrow list leaves it out). */
export function OwedRow({ x, onOpen, onCollect }: { x: OwedItem; onOpen: () => void; onCollect?: () => void }) {
  return (
    <li className="row owe-row" data-testid="owed">
      {onCollect && <Avatar name={x.studentName} />}
      <div style={{ flex: '1 1 160px', minWidth: 0 }}>
        <button type="button" className="linkish t-lg" onClick={onOpen}>
          {x.studentName}
        </button>
        <div className="small muted">
          {x.forText}
          {x.partly ? ` · ${formatRupees(x.amountPaise - x.balancePaise)} of ${formatRupees(x.amountPaise)} paid` : ''} · due {formatDate(x.due)}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="t-lg">{formatRupees(x.balancePaise)}</div>
        <span className={x.partly ? 'tag part' : 'tag due'}>{x.partly ? `Partly paid · ${dueText(x.daysDue).toLowerCase()}` : dueText(x.daysDue)}</span>
      </div>
      {onCollect && (
        <button type="button" className="btn textb" aria-label={`Collect ${x.forText} from ${x.studentName}`} onClick={onCollect}>
          Collect
        </button>
      )}
    </li>
  )
}
