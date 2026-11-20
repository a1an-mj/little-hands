import { useState } from 'react'
import { formatDate } from '@shared/dates'
import { PROGRAM_NAME, feeWithPeriod, ordinal } from '@shared/enrollments'
import { formatRupees } from '@shared/money'
import {
  CHARGE_KIND_LABEL,
  METHOD_LABEL,
  periodLabel,
  type ChargeKind,
  type ChargeView,
  type PaymentView,
  type PeriodView,
  type ProgramFees
} from '@shared/payments'
import { dueText } from '@shared/periods'
import { CHARGE_KINDS, chargeInputSchema, reversalSchema, waiverSchema, type ChargeInput, type PaymentTarget } from '@shared/schemas'
import { formatTime } from '@shared/schedule'
import { Dialog } from '../../components/Dialog'
import { TextField } from '../../components/TextField'
import { call, messageOf, useLoad } from '../../lib/api'
import { useSubmit } from './ProfileDialogs'

/** How a period or charge stands, as a coloured tag. */
export function statusOf(b: { status: string; daysDue: number | null; balancePaise: number }): { text: string; cls: string } {
  switch (b.status) {
    case 'paid':
      return { text: 'Paid', cls: 'tag ok' }
    case 'waived':
      return { text: 'Not charged', cls: 'tag nt' }
    case 'upcoming':
      return { text: 'Not due yet', cls: 'tag nt' }
    case 'partly':
      return { text: `${formatRupees(b.balancePaise)} left · ${dueText(b.daysDue ?? 0).toLowerCase()}`, cls: 'tag part' }
    default:
      return { text: dueText(b.daysDue ?? 0), cls: 'tag due' }
  }
}

const PERIODS_SHOWN = 6

type Open =
  | { kind: 'reverse'; payment: PaymentView }
  | { kind: 'charge' }
  | { kind: 'waive'; program: ProgramFees; period: PeriodView }
  | null

/** Profile → "Fees & payments": what's owed per program and charge, and the full payment history. */
export function FeesTab({ studentId, onPay }: { studentId: string; onPay: (target?: PaymentTarget) => void }) {
  const { data: f, error, reload } = useLoad(() => window.lh.payments.forStudent(studentId), [studentId])
  const [open, setOpen] = useState<Open>(null)
  const [showAll, setShowAll] = useState(false)
  const { snack } = useSubmit()

  if (error) return <div className="card empty" role="alert">{error}</div>
  if (!f) return null

  const done = async (msg: string) => {
    setOpen(null)
    snack(msg)
    await reload()
  }
  async function unwaive(p: ProgramFees, period: PeriodView) {
    try {
      await call(window.lh.payments.unwaive(p.enrollmentId, period.start))
      await done(`${PROGRAM_NAME[p.program]} · ${periodLabel(period)} is charged again`)
    } catch (e) {
      snack(messageOf(e))
    }
  }
  async function cancelCharge(c: ChargeView) {
    try {
      await call(window.lh.payments.cancelCharge(c.id))
      await done(`${c.label} cancelled`)
    } catch (e) {
      snack(messageOf(e))
    }
  }

  return (
    <>
      <section aria-label="Fee summary" className="card in fee-sum" data-testid="fee-summary" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 24 }}>
        <div style={{ flex: '1 1 200px' }}>
          <div className="small muted">Owed now</div>
          <div className="big" data-testid="owed-now">{formatRupees(f.owedPaise)}</div>
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <div className="small muted">Paid this school year</div>
          <div className="t-lg">{formatRupees(f.paidThisYearPaise)}</div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <button type="button" className="btn tonal" onClick={() => setOpen({ kind: 'charge' })}>
            Add charge
          </button>
          <button type="button" className="btn filled" onClick={() => onPay()}>
            Record payment
          </button>
        </div>
      </section>

      <div className="fees-cols">
        {f.programs.map((p) => {
          const list = showAll ? p.periods : p.periods.slice(0, PERIODS_SHOWN)
          return (
            <section key={p.enrollmentId} className="card in" aria-labelledby={`fees-${p.enrollmentId}`} data-testid={`fees-${p.program}`}>
              <h2 id={`fees-${p.enrollmentId}`} className="h-md" style={{ marginBottom: 4 }}>
                {PROGRAM_NAME[p.program]}
              </h2>
              <div className="small muted" style={{ marginBottom: 8 }}>
                {p.fee ? `${feeWithPeriod(formatRupees(p.fee.agreedPaise), p.fee.periodMonths)} · due by the ${ordinal(p.fee.dueDay)}` : 'No fee yet'}
                {p.state === 'ended' ? ' · ended' : ''}
              </div>
              {p.periods.length === 0 && <p className="muted">Starts {p.next ? formatDate(p.next.start) : 'later'}.</p>}
              <table className="ftable">
                <tbody>
                  {list.map((x) => {
                    const t = statusOf(x)
                    return (
                      <tr key={x.start} data-testid="period">
                        <td>
                          <div className="t-lg">{periodLabel(x)}</div>
                          <div className="small muted">
                            {x.partial ? 'Days left in the month · ' : ''}due {formatDate(x.due)}
                            {x.waiver ? ` · ${x.waiver.reason}` : ''}
                          </div>
                        </td>
                        <td className="rt">{formatRupees(x.amountPaise)}</td>
                        <td>
                          <span className={t.cls}>{t.text}</span>
                        </td>
                        <td className="rt">
                          {(x.status === 'due' || x.status === 'partly' || x.status === 'upcoming') && (
                            <button type="button" className="btn textb" aria-label={`Pay ${PROGRAM_NAME[p.program]} · ${periodLabel(x)}`} onClick={() => onPay({ kind: 'period', enrollmentId: p.enrollmentId, periodStart: x.start })}>
                              Pay
                            </button>
                          )}
                          {x.status === 'due' && (
                            <button type="button" className="btn textb" aria-label={`Don't charge ${PROGRAM_NAME[p.program]} · ${periodLabel(x)}`} onClick={() => setOpen({ kind: 'waive', program: p, period: x })}>
                              Don't charge
                            </button>
                          )}
                          {x.status === 'waived' && (
                            <button type="button" className="btn textb" aria-label={`Charge ${PROGRAM_NAME[p.program]} · ${periodLabel(x)} again`} onClick={() => void unwaive(p, x)}>
                              Charge again
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {p.periods.length > PERIODS_SHOWN && (
                <button type="button" className="btn textb" style={{ marginTop: 8 }} onClick={() => setShowAll(!showAll)}>
                  {showAll ? 'Show fewer' : `Show all ${p.periods.length}`}
                </button>
              )}
            </section>
          )
        })}

        {f.charges.length > 0 && (
          <section className="card in" aria-labelledby="charges-h" data-testid="charges">
            <h2 id="charges-h" className="h-md" style={{ marginBottom: 8 }}>Other charges</h2>
            <table className="ftable">
              <tbody>
                {f.charges.map((c) => {
                  const t = statusOf(c)
                  return (
                    <tr key={c.id}>
                      <td>
                        <div className="t-lg">{c.label}</div>
                        <div className="small muted">
                          {CHARGE_KIND_LABEL[c.kind]} · due {formatDate(c.dueDate)}
                          {c.reason ? ` · ${c.reason}` : ''}
                        </div>
                      </td>
                      <td className="rt">{formatRupees(c.amountPaise)}</td>
                      <td>
                        <span className={t.cls}>{t.text}</span>
                      </td>
                      <td className="rt">
                        {c.balancePaise > 0 && (
                          <button type="button" className="btn textb" aria-label={`Pay ${c.label}`} onClick={() => onPay({ kind: 'charge', chargeId: c.id })}>
                            Pay
                          </button>
                        )}
                        {c.paidPaise === 0 && (
                          <button type="button" className="btn textb" aria-label={`Cancel ${c.label}`} onClick={() => void cancelCharge(c)}>
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        )}
      </div>

      <section className="card in" aria-labelledby="hist-h" data-testid="payment-history">
        <div style={{ marginBottom: 8 }}>
          <h2 id="hist-h" className="h-md">Payment history</h2>
          <div className="small muted">Newest first · saved entries are never edited or deleted</div>
        </div>
        {f.payments.length === 0 && <p className="muted" style={{ margin: 0 }}>No payments yet.</p>}
        {f.payments.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="ftable">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Payment</th>
                  <th>For</th>
                  <th>Method</th>
                  <th className="rt">Amount</th>
                  <th className="rt">Left</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {f.payments.map((p) => (
                  <tr key={p.id} className={p.reversed ? 'reversed' : undefined} data-testid="payment">
                    <td>
                      <div>{formatDate(p.paidAt.slice(0, 10))}</div>
                      <div className="small muted">{formatTime(p.paidAt.slice(11))}</div>
                    </td>
                    <td>
                      <div className="t-lg">{p.no}</div>
                      <div className="small muted">{p.recordedBy}</div>
                    </td>
                    <td>
                      {p.kind === 'reversal' ? (
                        <>
                          <div>Reversal of {p.reversesNo}</div>
                          <div className="small muted">{p.reason}</div>
                        </>
                      ) : (
                        <>
                          <div>{p.forText}</div>
                          {p.reversed && <span className="tag nt">Reversed</span>}
                          {p.remarks && <div className="small muted">{p.remarks}</div>}
                        </>
                      )}
                    </td>
                    <td>
                      {p.kind === 'reversal' ? '—' : METHOD_LABEL[p.method]}
                      {p.reference && <div className="small muted">{p.reference}</div>}
                    </td>
                    <td className="rt amt t-lg">{formatRupees(p.amountPaise)}</td>
                    <td className="rt">{p.leftAfterPaise === null ? '—' : formatRupees(p.leftAfterPaise)}</td>
                    <td className="rt">
                      {p.kind === 'payment' && !p.reversed && (
                        <button type="button" className="btn textb" aria-label={`Reverse ${p.no}`} onClick={() => setOpen({ kind: 'reverse', payment: p })}>
                          Reverse
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {open?.kind === 'reverse' && <ReverseDialog payment={open.payment} onClose={() => setOpen(null)} onDone={done} />}
      {open?.kind === 'charge' && <ChargeDialog studentId={studentId} today={f.today} onClose={() => setOpen(null)} onDone={done} />}
      {open?.kind === 'waive' && <WaiveDialog program={open.program} period={open.period} onClose={() => setOpen(null)} onDone={done} />}
    </>
  )
}

function ReverseDialog({ payment: p, onClose, onDone }: { payment: PaymentView; onClose: () => void; onDone: (m: string) => void }) {
  const { data: recorders } = useLoad(() => window.lh.payments.recorders(), [])
  const [v, setV] = useState({ reason: '', recordedBy: '' })
  const { busy, errors, submit } = useSubmit()
  const recordedBy = v.recordedBy || recorders?.[0] || ''
  return (
    <Dialog title={`Reverse ${p.no}?`} onClose={onClose}>
      <form
        noValidate
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        onSubmit={(e) => {
          e.preventDefault()
          const input = { reason: v.reason, recordedBy }
          void submit(reversalSchema, input, async () => {
            const r = await call(window.lh.payments.reverse(p.id, input))
            onDone(`${p.no} reversed (${r.no})`)
          })
        }}
      >
        <p className="muted" style={{ margin: 0 }}>
          {formatRupees(p.amountPaise)} for {p.forText} on {formatDate(p.paidAt.slice(0, 10))}. A reversal entry of −{formatRupees(p.amountPaise)} is
          added; the original stays in the history, marked "Reversed". Then record the correct payment.
        </p>
        <TextField label="Reason" value={v.reason} onChange={(x) => setV({ ...v, reason: x })} error={errors.reason} placeholder="e.g. Typed ₹15,000 instead of ₹1,500" autoFocus />
        <TextField label="Done by" value={recordedBy} onChange={(x) => setV({ ...v, recordedBy: x })} error={errors.recordedBy} suggestions={recorders} />
        <div className="dlg-actions">
          <button type="button" className="btn textb" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn danger-filled" disabled={busy}>
            Reverse payment
          </button>
        </div>
      </form>
    </Dialog>
  )
}

const KIND_DEFAULT_LABEL: Record<ChargeKind, string> = { admission: 'Admission fee', fine: 'Late fine', other: '' }

function ChargeDialog({ studentId, today, onClose, onDone }: { studentId: string; today: string; onClose: () => void; onDone: (m: string) => void }) {
  const [v, setV] = useState<Required<ChargeInput>>({ kind: 'fine', label: 'Late fine', amount: '', dueDate: today, reason: '' })
  const { busy, errors, submit } = useSubmit()
  return (
    <Dialog title="Add a charge" onClose={onClose}>
      <form
        noValidate
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        onSubmit={(e) => {
          e.preventDefault()
          void submit(chargeInputSchema, v, async () => {
            await call(window.lh.payments.addCharge(studentId, v))
            onDone(`${v.label} added`)
          })
        }}
      >
        <div role="radiogroup" aria-label="Kind of charge" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {CHARGE_KINDS.map((k) => (
            <label key={k} className="choice">
              <input
                type="radio"
                name="kind"
                checked={v.kind === k}
                onChange={() => setV({ ...v, kind: k, label: v.label === KIND_DEFAULT_LABEL[v.kind] ? KIND_DEFAULT_LABEL[k] : v.label })}
              />
              <span className="t-lg">{CHARGE_KIND_LABEL[k]}</span>
            </label>
          ))}
        </div>
        <div className="grid">
          <TextField label="What it's for" value={v.label} onChange={(x) => setV({ ...v, label: x })} error={errors.label} placeholder="e.g. Annual day costume" />
          <TextField label="Amount (₹)" inputMode="decimal" value={v.amount} onChange={(x) => setV({ ...v, amount: x })} error={errors.amount} />
          <TextField label="Due on" type="date" value={v.dueDate} onChange={(x) => setV({ ...v, dueDate: x })} error={errors.dueDate} />
        </div>
        <TextField label="Reason (optional)" value={v.reason} onChange={(x) => setV({ ...v, reason: x })} error={errors.reason} placeholder="e.g. October fee paid 10 days late" />
        <div className="dlg-actions">
          <button type="button" className="btn textb" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn filled" disabled={busy}>
            Add charge
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function WaiveDialog({ program: p, period, onClose, onDone }: { program: ProgramFees; period: PeriodView; onClose: () => void; onDone: (m: string) => void }) {
  const [reason, setReason] = useState('')
  const { busy, errors, submit } = useSubmit()
  const what = `${PROGRAM_NAME[p.program]} · ${periodLabel(period)}`
  return (
    <Dialog title={`Don't charge ${what}?`} onClose={onClose}>
      <form
        noValidate
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        onSubmit={(e) => {
          e.preventDefault()
          void submit(waiverSchema, { reason }, async () => {
            await call(window.lh.payments.waive(p.enrollmentId, period.start, { reason }))
            onDone(`${what} not charged`)
          })
        }}
      >
        <p className="muted" style={{ margin: 0 }}>
          For example Daycare while the child is away. It can be charged again later.
        </p>
        <TextField label="Reason" value={reason} onChange={setReason} error={errors.reason} placeholder="e.g. Away for the whole month" autoFocus />
        <div className="dlg-actions">
          <button type="button" className="btn textb" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn filled" disabled={busy}>
            Don't charge
          </button>
        </div>
      </form>
    </Dialog>
  )
}

