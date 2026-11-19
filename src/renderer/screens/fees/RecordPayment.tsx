import { useEffect, useMemo, useState } from 'react'
import { PROGRAM_NAME, feeWithPeriod } from '@shared/enrollments'
import type { Theme } from '@shared/ipc-contract'
import { formatRupees, parseRupees, rupeesInput } from '@shared/money'
import { METHOD_LABEL, periodLabel, type PaymentMethod, type PeriodView, type StudentFees } from '@shared/payments'
import { dueText } from '@shared/periods'
import { PAYMENT_METHODS, paymentInputSchema, type PaymentInput, type PaymentTarget } from '@shared/schemas'
import { formatDate } from '@shared/dates'
import { Avatar } from '../../components/Avatar'
import { CheckIcon, SearchIcon } from '../../components/icons'
import { useSnackbar } from '../../components/Snackbar'
import { TextField } from '../../components/TextField'
import { ThemeSwitch } from '../../components/ThemeSwitch'
import { call, messageOf, useLoad } from '../../lib/api'
import type { Navigate } from '../../shell/routes'
import { ProgramTag } from '../students/ProgramFields'
import { useSubmit } from '../students/ProfileDialogs'

interface Props {
  theme: Theme
  onToggleTheme: () => void
  navigate: Navigate
  studentId?: string
  target?: PaymentTarget
}

/** One thing that can be paid for: a program's period, or a charge. */
interface Option {
  key: string
  target: PaymentTarget
  /** "LKG · Oct 2026", "Admission fee" */
  title: string
  note: string
  amountPaise: number
  paidPaise: number
  balancePaise: number
  /** Not due yet (paying in advance). */
  upcoming: boolean
}

const targetKey = (t: PaymentTarget) => (t.kind === 'period' ? `${t.enrollmentId}|${t.periodStart}` : t.chargeId)

/** "Due for 3 days", "₹500 left", "Due 20 Nov" */
function noteFor(p: { status: string; daysDue: number | null; balancePaise: number; start?: string; dueDate?: string }): string {
  if (p.status === 'partly') return `${formatRupees(p.balancePaise)} left`
  if (p.status === 'upcoming') return `Due ${formatDate(p.start ?? p.dueDate!)}`
  return dueText(p.daysDue ?? 0)
}

/** Everything still to pay for a child: owed periods (oldest first), the next period, and open charges. */
function optionsOf(fees: StudentFees): { programs: { enrollmentId: string; label: string; sub: string; periods: Option[] }[]; charges: Option[] } {
  const programs = fees.programs
    .map((pr) => {
      const open = pr.periods.filter((p) => p.status === 'due' || p.status === 'partly' || p.status === 'upcoming').reverse()
      const current = pr.periods.find((p) => p.start <= fees.today)
      return {
        enrollmentId: pr.enrollmentId,
        label: PROGRAM_NAME[pr.program],
        sub: current ? feeWithPeriod(formatRupees(current.amountPaise), current.periodMonths) : '',
        periods: open.map(
          (p: PeriodView): Option => ({
            key: `${pr.enrollmentId}|${p.start}`,
            target: { kind: 'period', enrollmentId: pr.enrollmentId, periodStart: p.start },
            title: `${PROGRAM_NAME[pr.program]} · ${periodLabel(p)}`,
            note: noteFor(p),
            amountPaise: p.amountPaise,
            paidPaise: p.paidPaise,
            balancePaise: p.balancePaise,
            upcoming: p.status === 'upcoming'
          })
        )
      }
    })
    .filter((p) => p.periods.length > 0)
  const charges = fees.charges
    .filter((c) => c.balancePaise > 0)
    .map(
      (c): Option => ({
        key: c.id,
        target: { kind: 'charge', chargeId: c.id },
        title: c.label,
        note: noteFor({ ...c, dueDate: c.dueDate }),
        amountPaise: c.amountPaise,
        paidPaise: c.paidPaise,
        balancePaise: c.balancePaise,
        upcoming: c.status === 'upcoming'
      })
    )
  return { programs, charges }
}

/** Record a payment (design: Payment.html). Each payment is a new entry; nothing earlier is overwritten. */
export function RecordPayment({ theme, onToggleTheme, navigate, studentId: initialStudent, target: initialTarget }: Props) {
  const [studentId, setStudentId] = useState<string | undefined>(initialStudent)
  return (
    <>
      <header className="topbar in">
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <h1 className="h-lg">Record a payment</h1>
          <div className="muted">Each payment is saved as a new entry. Nothing earlier is overwritten.</div>
        </div>
        <ThemeSwitch theme={theme} onToggle={onToggleTheme} />
      </header>
      {studentId ? (
        <PaymentForm key={studentId} studentId={studentId} initialTarget={studentId === initialStudent ? initialTarget : undefined} onChangeStudent={() => setStudentId(undefined)} navigate={navigate} />
      ) : (
        <StudentPicker onPick={setStudentId} />
      )}
    </>
  )
}

function StudentPicker({ onPick }: { onPick: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSearch(q), 200)
    return () => clearTimeout(t)
  }, [q])
  const { data } = useLoad(() => window.lh.students.list({ search, status: 'active', page: 0 }), [search])
  return (
    <section className="card in" aria-labelledby="who-h" style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      <h2 id="who-h" className="h-sm" style={{ margin: 0 }}>Who is paying?</h2>
      <label className="search" style={{ maxWidth: 'none' }}>
        <SearchIcon />
        <span className="sr">Search students</span>
        <input type="search" placeholder="Name, student ID or parent phone" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </label>
      <div role="list" aria-label="Students">
        {data?.rows.map((r) => (
          <button key={r.id} type="button" role="listitem" className="lrow" onClick={() => onPick(r.id)}>
            <span className="c-student">
              <Avatar name={r.fullName} />
              <span>
                <span className="t-lg" style={{ display: 'block' }}>{r.fullName}</span>
                <span className="small muted">{r.code}</span>
              </span>
            </span>
            <span className="c-progs">
              {r.programs.map((p) => (
                <ProgramTag key={p} code={p} />
              ))}
            </span>
          </button>
        ))}
        {data && data.rows.length === 0 && <div className="empty">No students match.</div>}
      </div>
    </section>
  )
}

function PaymentForm(props: { studentId: string; initialTarget?: PaymentTarget; onChangeStudent: () => void; navigate: Navigate }) {
  const { studentId, navigate } = props
  const snack = useSnackbar()
  const { data: profile } = useLoad(() => window.lh.students.profile(studentId), [studentId])
  const { data: fees, reload } = useLoad(() => window.lh.payments.forStudent(studentId), [studentId])
  const { data: recorders } = useLoad(() => window.lh.payments.recorders(), [])
  const opts = useMemo(() => (fees ? optionsOf(fees) : null), [fees])
  const all = useMemo(() => (opts ? [...opts.programs.flatMap((p) => p.periods), ...opts.charges] : []), [opts])

  const [pick, setPick] = useState<string | null>(props.initialTarget ? targetKey(props.initialTarget) : null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod | null>(null)
  const [paidAt, setPaidAt] = useState('')
  const [reference, setReference] = useState('')
  const [recordedBy, setRecordedBy] = useState('')
  const [remarks, setRemarks] = useState('')
  const { busy, errors, setErrors, submit } = useSubmit()

  // Defaults once the fees have loaded: the oldest thing owed, its full balance, and now.
  const chosen = all.find((o) => o.key === pick) ?? null
  useEffect(() => {
    if (!fees) return
    if (!chosen) {
      const first = all.find((o) => !o.upcoming) ?? all[0]
      if (first) {
        setPick(first.key)
        setAmount(rupeesInput(first.balancePaise))
      }
    } else if (!amount) setAmount(rupeesInput(chosen.balancePaise))
    if (!paidAt) setPaidAt(`${fees.today}T${fees.now}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fees])
  useEffect(() => {
    if (!recordedBy && recorders?.length) setRecordedBy(recorders[0]!)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorders])

  const choose = (o: Option) => {
    setPick(o.key)
    setAmount(rupeesInput(o.balancePaise))
    setErrors({})
  }

  const amountPaise = parseRupees(amount) ?? 0
  const balanceAfter = chosen ? chosen.balancePaise - amountPaise : 0
  const enrollmentOf = (o: Option | null) => (o?.target.kind === 'period' ? o.target.enrollmentId : null)
  const selectedProgram = opts?.programs.find((p) => p.enrollmentId === enrollmentOf(chosen))
  const chargeChosen = chosen?.target.kind === 'charge'
  const earlier = fees?.payments.filter((p) => p.kind === 'payment' && !p.reversed && p.forText === chosen?.title) ?? []

  const input: PaymentInput | null = chosen
    ? { studentId, target: chosen.target, amount, method: method as PaymentMethod, reference, paidAt, recordedBy, remarks }
    : null

  async function save() {
    if (!input) return
    await submit(paymentInputSchema, input, async () => {
      const r = await call(window.lh.payments.record(input))
      snack(`Payment ${r.no} saved · ${formatRupees(amountPaise)}`, {
        label: 'View',
        run: () => navigate({ name: 'student', id: studentId, tab: 'fees' })
      })
      setPick(null)
      setAmount('')
      setReference('')
      setRemarks('')
      await reload()
    })
  }

  if (!fees || !profile) return <div className="muted">Loading…</div>

  const contact = profile.guardians.find((g) => g.isFeeContact)
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
      <form
        className="card in"
        noValidate
        style={{ flex: '3 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 28, animationDelay: '60ms' }}
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div>
          <h2 className="h-sm">Student</h2>
          <div className="who">
            <Avatar name={profile.fullName} photo={profile.photo} />
            <div style={{ flex: '1 1 auto', minWidth: 0 }}>
              <div className="t-lg">{profile.fullName}</div>
              <div className="small muted">
                {[profile.code, contact ? `${contact.relationship}: ${contact.name ?? ''}`.trim() : null].filter(Boolean).join(' · ')}
              </div>
            </div>
            <button type="button" className="btn textb" onClick={props.onChangeStudent}>
              Change
            </button>
          </div>
        </div>

        {all.length === 0 ? (
          <p className="muted" style={{ margin: 0 }} data-testid="nothing-owed">
            Nothing is owed by {profile.fullName.split(' ')[0]} at the moment.
          </p>
        ) : (
          <>
            <div role="group" aria-labelledby="fee-l">
              <h2 id="fee-l" className="h-sm">Which fee?</h2>
              <div className="opts">
                {opts!.programs.map((p) => (
                  <button
                    key={p.enrollmentId}
                    type="button"
                    className="opt"
                    aria-pressed={selectedProgram?.enrollmentId === p.enrollmentId}
                    onClick={() => choose(p.periods[0]!)}
                  >
                    <span className="radio">{selectedProgram?.enrollmentId === p.enrollmentId && <i className="pop" />}</span>
                    <span style={{ flex: 1 }}>
                      <span className="t-lg" style={{ display: 'block' }}>{p.label}</span>
                      <span className="small muted">{p.sub}</span>
                    </span>
                  </button>
                ))}
                {opts!.charges.map((c) => (
                  <button key={c.key} type="button" className="opt" aria-pressed={pick === c.key} onClick={() => choose(c)}>
                    <span className="radio">{pick === c.key && <i className="pop" />}</span>
                    <span style={{ flex: 1 }}>
                      <span className="t-lg" style={{ display: 'block' }}>{c.title}</span>
                      <span className="small muted">
                        {formatRupees(c.balancePaise)} · {c.note}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {selectedProgram && (
              <div role="group" aria-labelledby="per-l">
                <h2 id="per-l" className="h-sm">For which period?</h2>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {selectedProgram.periods.map((p) => (
                    <button key={p.key} type="button" className="chip" aria-pressed={pick === p.key} onClick={() => choose(p)}>
                      {pick === p.key && <CheckIcon />}
                      {p.title.slice(selectedProgram.label.length + 3)} · {p.note}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h2 className="h-sm">Amount received</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ flex: '1 1 200px', maxWidth: 260 }}>
                  <TextField label="Amount (₹)" inputMode="decimal" value={amount} onChange={setAmount} error={errors.amount} />
                </div>
                {chosen && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 6 }}>
                    <button type="button" className="chip" aria-pressed={amountPaise === chosen.balancePaise} onClick={() => setAmount(rupeesInput(chosen.balancePaise))}>
                      Full balance {formatRupees(chosen.balancePaise)}
                    </button>
                    {chosen.balancePaise >= 200 && (
                      <button
                        type="button"
                        className="chip"
                        aria-pressed={amountPaise === Math.round(chosen.balancePaise / 200) * 100}
                        onClick={() => setAmount(rupeesInput(Math.round(chosen.balancePaise / 200) * 100))}
                      >
                        Half {formatRupees(Math.round(chosen.balancePaise / 200) * 100)}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div role="group" aria-labelledby="how-l">
              <h2 id="how-l" className="h-sm">How was it paid?</h2>
              <div className="opts three" data-error={errors.method ? 'true' : undefined}>
                {PAYMENT_METHODS.map((m) => (
                  <button key={m} type="button" className="opt" aria-pressed={method === m} onClick={() => setMethod(m)}>
                    <span className="radio">{method === m && <i className="pop" />}</span>
                    <span className="t-lg">{METHOD_LABEL[m]}</span>
                  </button>
                ))}
              </div>
              {errors.method && (
                <div className="field-error" role="alert" style={{ marginTop: 6 }}>
                  {errors.method}
                </div>
              )}
            </div>

            <div className="grid">
              <TextField label="Date & time" type="datetime-local" value={paidAt} onChange={setPaidAt} error={errors.paidAt} max={`${fees.today}T23:59`} help="Defaults to now" />
              {method && method !== 'cash' && (
                <TextField
                  label={method === 'upi' ? 'UPI reference (UTR)' : 'Bank reference'}
                  value={reference}
                  onChange={setReference}
                  error={errors.reference}
                  help="Optional"
                />
              )}
              <TextField
                label="Received by"
                value={recordedBy}
                onChange={setRecordedBy}
                error={errors.recordedBy}
                suggestions={recorders}
                placeholder="e.g. Anu teacher"
                help="Who took the money"
              />
            </div>
            <TextField label="Remarks (optional)" value={remarks} onChange={setRemarks} error={errors.remarks} />

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <button type="submit" className="btn filled lg" disabled={busy || !chosen}>
                <CheckIcon />
                Save payment
              </button>
              <button type="button" className="btn textb" onClick={() => navigate({ name: 'student', id: studentId, tab: 'fees' })}>
                Cancel
              </button>
            </div>
          </>
        )}
      </form>

      {chosen && (
        <aside className="card in sumcard" aria-labelledby="sum-h" style={{ animationDelay: '120ms' }}>
          <h2 id="sum-h" className="t-lg" style={{ margin: 0 }}>
            {chosen.title}
          </h2>
          <div className="sumline">
            <span>{chargeChosen ? 'Charge' : 'Agreed fee'}</span>
            <span>{formatRupees(chosen.amountPaise)}</span>
          </div>
          <div className="sumline">
            <span>Paid earlier</span>
            <span>{formatRupees(chosen.paidPaise)}</span>
          </div>
          <div className="sumline">
            <span>This payment</span>
            <span>+ {formatRupees(amountPaise)}</span>
          </div>
          <div className="sumline total">
            <span>Balance after</span>
            <span className="big" data-testid="balance-after">{formatRupees(Math.max(0, balanceAfter))}</span>
          </div>
          <div>
            {balanceAfter === 0 && amountPaise > 0 && <span className="tag ok">{chargeChosen ? 'Will be fully paid' : 'Period will be fully paid'}</span>}
            {balanceAfter > 0 && amountPaise > 0 && <span className="tag part">Still partly paid</span>}
            {balanceAfter < 0 && <span className="tag due">More than what's due – check the amount</span>}
          </div>
          <div>
            <div className="small muted" style={{ marginBottom: 6 }}>Already paid for this</div>
            {earlier.length === 0 && <div className="small muted">Nothing yet.</div>}
            {earlier.map((p) => (
              <div key={p.id} className="sumline small">
                <span>
                  {formatDate(p.paidAt.slice(0, 10))} · {METHOD_LABEL[p.method]} · {p.no}
                </span>
                <span>{formatRupees(p.amountPaise)}</span>
              </div>
            ))}
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Saved payments can't be edited or deleted. A wrong entry is fixed with a reversal from the payment history, so the full record stays.
          </p>
        </aside>
      )}
    </div>
  )
}

