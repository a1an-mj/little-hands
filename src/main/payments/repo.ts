import type Database from 'better-sqlite3'
import { academicYearStart } from '@shared/academic-year'
import { addDays, formatDate } from '@shared/dates'
import { versionOn } from '@shared/effective'
import { PROGRAM_NAME, enrollmentState, type FeeVersion, type ProgramCode } from '@shared/enrollments'
import { formatRupees } from '@shared/money'
import {
  CHARGE_KIND_LABEL,
  forProgramText,
  paymentNo,
  type ChargeKind,
  type ChargeView,
  type FeesOverview,
  type MonthReport,
  type OwedItem,
  type PaymentMethod,
  type PaymentView,
  type PeriodView,
  type ProgramFees,
  type RecentPayment,
  type StudentFees
} from '@shared/payments'
import { balanceOf, monthPlus, nextPeriodAfter, periodsOf, type Period } from '@shared/periods'
import {
  PAYMENT_METHODS,
  chargeInputSchema,
  isoDateSchema,
  paymentInputSchema,
  reversalSchema,
  waiverSchema,
  type ChargeInput,
  type PaymentInput,
  type PaymentTarget,
  type ReversalInput,
  type WaiverInput
} from '@shared/schemas'
import type { Writer } from '../db/writer'
import { UserError } from '../errors'

type EnrollmentRow = {
  id: string
  student_id: string
  full_name: string
  student_code: string
  code: ProgramCode
  sort_order: number
  start_date: string
  end_date: string | null
}

type ChargeRow = {
  id: string
  student_id: string
  full_name: string
  student_code: string
  kind: ChargeKind
  label: string
  amount_paise: number
  due_date: string
  reason: string
}

type PaymentRow = {
  id: string
  payment_seq: number
  student_id: string
  enrollment_id: string | null
  period_start: string | null
  charge_id: string | null
  kind: 'payment' | 'reversal'
  amount_paise: number
  method: PaymentMethod
  reference: string
  paid_at: string
  recorded_by: string
  remarks: string
  reverses_payment_id: string | null
  reason: string
}

/** One period of one program, with what was paid against it. */
interface PeriodItem {
  kind: 'period'
  enrollment: EnrollmentRow
  period: Period
  /** Concession in force for the period (for the report). */
  concessionPaise: number
  concessionReason: string
  waiver: { id: string; reason: string } | null
  paidPaise: number
}

interface ChargeItem {
  kind: 'charge'
  charge: ChargeRow
  paidPaise: number
}

const periodKey = (enrollmentId: string, start: string) => `${enrollmentId}|${start}`

/**
 * Payments are append-only: a mistake is cancelled by a reversal row, never by editing.
 * What is owed is worked out from the fee agreements every time (src/shared/periods.ts).
 */
export class PaymentsRepo {
  private readonly db: Database.Database

  constructor(private readonly w: Writer) {
    this.db = w.db
  }

  // ---------- Reading ----------

  /** A child's fees: every period so far per program, extra charges, and the payment history. */
  forStudent(studentId: string): StudentFees {
    const today = this.w.today()
    this.requireStudent(studentId)
    // Includes each program's next period, which can be paid in advance.
    const { periods, charges, fees } = this.ledger(studentId, today, true)

    const programs: ProgramFees[] = []
    for (const e of this.enrollments(studentId)) {
      const own = periods.filter((p) => p.enrollment.id === e.id)
      const list: PeriodView[] = own
        .map((p) => ({
          ...p.period,
          ...balanceOf(p.period.amountPaise, p.paidPaise, p.period.due, today, p.waiver !== null),
          waiver: p.waiver
        }))
        .reverse()
      programs.push({
        enrollmentId: e.id,
        program: e.code,
        state: enrollmentState(e.start_date, e.end_date, today),
        periods: list,
        next: nextPeriodAfter(e.start_date, e.end_date, fees.get(e.id)!, today),
        fee: (() => {
          const f = fees.get(e.id)!
          const v = versionOn(f, today) ?? f[0]
          return v ? { agreedPaise: v.agreedPaise, periodMonths: v.periodMonths, dueDay: v.dueDay } : null
        })()
      })
    }

    const chargeViews: ChargeView[] = charges.map((c) => ({
      id: c.charge.id,
      kind: c.charge.kind,
      label: c.charge.label,
      dueDate: c.charge.due_date,
      reason: c.charge.reason,
      ...balanceOf(c.charge.amount_paise, c.paidPaise, c.charge.due_date, today)
    }))

    const owedPaise =
      periods.reduce((s, p) => s + (p.period.due <= today && !p.waiver ? Math.max(0, p.period.amountPaise - p.paidPaise) : 0), 0) +
      charges.reduce((s, c) => s + (c.charge.due_date <= today ? Math.max(0, c.charge.amount_paise - c.paidPaise) : 0), 0)

    const rows = this.paymentRows('student_id = ?', [studentId])
    const yearStart = academicYearStart(today)
    const paidThisYearPaise = rows.filter((r) => r.paid_at.slice(0, 10) >= yearStart).reduce((s, r) => s + r.amount_paise, 0)

    return {
      today,
      now: this.w.time(),
      programs,
      charges: chargeViews,
      payments: this.paymentViews(rows, periods, charges),
      owedPaise,
      paidThisYearPaise
    }
  }

  /** The dashboard and the Fees screen: this month's money and everyone who owes. */
  overview(): FeesOverview {
    const today = this.w.today()
    const monthStart = today.slice(0, 8) + '01'
    const monthEnd = addDays(monthPlus(monthStart, 1, 1), -1)
    const { periods, charges } = this.ledger(null, today)
    const owed = this.owedItems(periods, charges, today)

    let dueThisMonthPaise = 0
    for (const p of periods) if (!p.waiver && p.period.due >= monthStart && p.period.due <= monthEnd) dueThisMonthPaise += p.period.amountPaise
    for (const c of charges) if (c.charge.due_date >= monthStart && c.charge.due_date <= monthEnd) dueThisMonthPaise += c.charge.amount_paise

    const earlier = owed.filter((o) => o.due < monthStart)
    const collectedThisMonthPaise = this.db
      .prepare(`SELECT coalesce(sum(amount_paise), 0) FROM payments WHERE deleted_at IS NULL AND paid_at >= ? AND paid_at < ?`)
      .pluck()
      .get(monthStart, addDays(monthEnd, 1)) as number

    return {
      today,
      collectedThisMonthPaise,
      dueThisMonthPaise,
      outstandingEarlierPaise: earlier.reduce((s, o) => s + o.balancePaise, 0),
      outstandingStudents: new Set(earlier.map((o) => o.studentId)).size,
      oldestDue: earlier.length ? earlier.reduce((m, o) => (o.due < m ? o.due : m), earlier[0]!.due) : null,
      owed,
      recent: this.recent(8, periods, charges)
    }
  }

  /** The monthly report: collected (by program and method), concessions, and who still owes. */
  monthReport(month: string): MonthReport {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new UserError('Choose a month')
    const today = this.w.today()
    const start = `${month}-01`
    const end = addDays(monthPlus(start, 1, 1), -1)
    const asOf = end < today ? end : today
    const { periods, charges } = this.ledger(null, today)

    const rows = this.paymentRows('paid_at >= ? AND paid_at < ?', [start, addDays(end, 1)])
    const byProgramMap = new Map<string, number>()
    const byMethod = Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0])) as Record<PaymentMethod, number>
    const programOf = new Map(periods.map((p) => [p.enrollment.id, p.enrollment.code]))
    const chargeKind = new Map(charges.map((c) => [c.charge.id, c.charge.kind]))
    for (const r of rows) {
      const label = r.enrollment_id
        ? PROGRAM_NAME[programOf.get(r.enrollment_id) ?? this.programCode(r.enrollment_id)]
        : CHARGE_KIND_LABEL[chargeKind.get(r.charge_id!) ?? 'other']
      byProgramMap.set(label, (byProgramMap.get(label) ?? 0) + r.amount_paise)
      byMethod[r.method] += r.amount_paise
    }

    const concessions = periods
      .filter((p) => p.period.start >= start && p.period.start <= end && p.concessionPaise > 0 && !p.waiver)
      .map((p) => ({
        studentName: p.enrollment.full_name,
        program: p.enrollment.code,
        concessionPaise: p.concessionPaise,
        reason: p.concessionReason
      }))
      .sort((a, b) => a.studentName.localeCompare(b.studentName))

    return {
      month,
      collectedPaise: rows.reduce((s, r) => s + r.amount_paise, 0),
      byProgram: [...byProgramMap].map(([label, paise]) => ({ label, paise })).sort((a, b) => b.paise - a.paise),
      byMethod,
      concessions,
      concessionTotalPaise: concessions.reduce((s, c) => s + c.concessionPaise, 0),
      owed: this.owedItems(periods, charges, asOf)
    }
  }

  /** Names that recorded payments before, most recent first ("Recorded by" suggestions). */
  recorders(): string[] {
    return this.db
      .prepare(
        `SELECT recorded_by FROM payments WHERE deleted_at IS NULL
         GROUP BY recorded_by ORDER BY max(created_at) DESC LIMIT 20`
      )
      .pluck()
      .all() as string[]
  }

  /** Has anything been paid towards this program? (A program with payments can't be removed.) */
  hasPayments(enrollmentId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM payments WHERE enrollment_id = ? AND deleted_at IS NULL').get(enrollmentId)
  }

  // ---------- Writing ----------

  /**
   * Saves a payment. Parents pay the exact amount, so more than what's owed is refused, with one
   * exception (owner): at joining the parent pays a full month although the first month is charged
   * by days; the extra counts towards the next month. So an amount above a period's balance is saved
   * as two entries (this period, then the next one), up to what the next period still needs.
   */
  record(input: PaymentInput): { id: string; no: string; advance: { no: string; forText: string; amountPaise: number } | null } {
    const p = paymentInputSchema.parse(input)
    return this.w.transaction(() => {
      this.requireStudent(p.studentId)
      const today = this.w.today()
      if (p.paidAt.slice(0, 10) > today) throw new UserError("The payment date can't be in the future")
      const due = this.owedFor(p.studentId, p.target, today)
      if (due.waived) throw new UserError('This period is not charged (waived). Undo the waiver first.')
      if (due.balancePaise === 0) throw new UserError(`Nothing is owed for ${due.forText}.`)

      let advance: { target: PaymentTarget; amount: number; forText: string } | null = null
      if (p.amount > due.balancePaise) {
        const next = p.target.kind === 'period' ? this.periodAfter(p.target.enrollmentId, p.target.periodStart, today) : null
        const extra = p.amount - due.balancePaise
        if (!next || next.waived || extra > next.balancePaise) {
          const both = next && !next.waived ? ` and ${next.forText} together (${formatRupees(due.balancePaise + next.balancePaise)})` : ` (${formatRupees(due.balancePaise)})`
          throw new UserError(`That is more than what's owed for ${due.forText}${both}. Check the amount.`)
        }
        advance = { target: next.target, amount: extra, forText: next.forText }
      }

      const save = (target: PaymentTarget, amount: number, remarks: string) => {
        const seq = this.nextSeq()
        const id = this.w.append('payments', {
          payment_seq: seq,
          student_id: p.studentId,
          ...targetColumns(target),
          kind: 'payment',
          amount_paise: amount,
          method: p.method,
          reference: p.method === 'cash' ? '' : p.reference,
          paid_at: p.paidAt,
          recorded_by: p.recordedBy,
          remarks,
          reverses_payment_id: null,
          reason: ''
        })
        return { id, no: paymentNo(seq) }
      }
      const first = save(p.target, advance ? due.balancePaise : p.amount, p.remarks)
      const second = advance ? save(advance.target, advance.amount, `Advance, paid with ${first.no}`) : null
      return {
        ...first,
        advance: second && advance ? { no: second.no, forText: advance.forText, amountPaise: advance.amount } : null
      }
    })
  }

  /** The period right after `periodStart` (for an advance), if it may be paid now, with what it still needs. */
  private periodAfter(enrollmentId: string, periodStart: string, today: string) {
    const e = this.enrollment(enrollmentId)
    const f = this.feesFor([e.id]).get(e.id)!
    const list = periodsOf(e.start_date, e.end_date, f, today)
    const upcoming = nextPeriodAfter(e.start_date, e.end_date, f, today)
    if (upcoming) list.push(upcoming)
    const next = list[list.findIndex((x) => x.start === periodStart) + 1]
    if (!next || list.findIndex((x) => x.start === periodStart) < 0) return null
    const paid = this.paidTowards('enrollment_id = ? AND period_start = ?', [enrollmentId, next.start])
    return {
      target: { kind: 'period' as const, enrollmentId, periodStart: next.start },
      forText: forProgramText(e.code, next),
      balancePaise: Math.max(0, next.amountPaise - paid),
      waived: this.waiverId(enrollmentId, next.start) !== undefined
    }
  }

  /** Cancels a payment with a reversal entry (negative amount, with a reason). The original stays. */
  reverse(paymentId: string, input: ReversalInput): { id: string; no: string } {
    const r = reversalSchema.parse(input)
    return this.w.transaction(() => {
      const p = this.db.prepare('SELECT * FROM payments WHERE id = ? AND deleted_at IS NULL').get(paymentId) as PaymentRow | undefined
      if (!p) throw new UserError('This payment could not be found.')
      if (p.kind !== 'payment') throw new UserError('A reversal itself cannot be reversed. Record the payment again instead.')
      if (this.db.prepare('SELECT 1 FROM payments WHERE reverses_payment_id = ?').get(paymentId)) {
        throw new UserError(`${paymentNo(p.payment_seq)} has already been reversed.`)
      }
      const seq = this.nextSeq()
      const id = this.w.append('payments', {
        payment_seq: seq,
        student_id: p.student_id,
        enrollment_id: p.enrollment_id,
        period_start: p.period_start,
        charge_id: p.charge_id,
        kind: 'reversal',
        amount_paise: -p.amount_paise,
        method: p.method,
        reference: '',
        paid_at: `${this.w.today()}T${this.w.time()}`,
        recorded_by: r.recordedBy,
        remarks: '',
        reverses_payment_id: p.id,
        reason: r.reason
      })
      return { id, no: paymentNo(seq) }
    })
  }

  /** An admission fee, a late fine, or another charge. */
  addCharge(studentId: string, input: ChargeInput): string {
    const c = chargeInputSchema.parse(input)
    return this.w.transaction(() => {
      this.requireStudent(studentId)
      return this.w.insert('charges', {
        student_id: studentId,
        kind: c.kind,
        label: c.label,
        amount_paise: c.amount,
        due_date: c.dueDate,
        reason: c.reason
      })
    })
  }

  /** Cancels a charge added by mistake. Anything paid towards it must be reversed first. */
  cancelCharge(chargeId: string): void {
    this.w.transaction(() => {
      const c = this.db.prepare('SELECT id FROM charges WHERE id = ? AND deleted_at IS NULL').get(chargeId)
      if (!c) throw new UserError('This charge could not be found.')
      if (this.paidTowards('charge_id = ?', [chargeId]) > 0) {
        throw new UserError('Something was paid towards this charge. Reverse that payment first.')
      }
      this.w.softDelete('charges', chargeId)
    })
  }

  /** "Don't charge this period" (e.g. Daycare while the child is away). */
  waive(enrollmentId: string, periodStart: string, input: WaiverInput): void {
    isoDateSchema.parse(periodStart)
    const { reason } = waiverSchema.parse(input)
    this.w.transaction(() => {
      const e = this.enrollment(enrollmentId)
      if (!this.periodOf(e, periodStart, this.w.today())) throw new UserError('That period could not be found.')
      if (this.paidTowards('enrollment_id = ? AND period_start = ?', [enrollmentId, periodStart]) > 0) {
        throw new UserError('Something was paid for this period. Reverse that payment first.')
      }
      const existing = this.waiverId(enrollmentId, periodStart)
      if (existing) this.w.update('fee_waivers', existing, { reason })
      else this.w.insert('fee_waivers', { enrollment_id: enrollmentId, period_start: periodStart, reason })
    })
  }

  /** Charges a waived period again. */
  unwaive(enrollmentId: string, periodStart: string): void {
    isoDateSchema.parse(periodStart)
    this.w.transaction(() => {
      const id = this.waiverId(enrollmentId, periodStart)
      if (id) this.w.softDelete('fee_waivers', id)
    })
  }

  // ---------- Internals ----------

  /** Every period up to `today` (plus each program's next one, for paying in advance) and every charge, with what was paid. */
  private ledger(studentId: string | null, today: string, withNext = false) {
    const enrollments = this.enrollments(studentId)
    const fees = this.feesFor(enrollments.map((e) => e.id))
    const paidByPeriod = new Map<string, number>()
    const paidByCharge = new Map<string, number>()
    for (const r of this.db
      .prepare(
        `SELECT enrollment_id, period_start, charge_id, sum(amount_paise) AS paid FROM payments
         WHERE deleted_at IS NULL ${studentId ? 'AND student_id = @studentId' : ''}
         GROUP BY enrollment_id, period_start, charge_id`
      )
      .all(studentId ? { studentId } : {}) as { enrollment_id: string | null; period_start: string | null; charge_id: string | null; paid: number }[]) {
      if (r.enrollment_id) paidByPeriod.set(periodKey(r.enrollment_id, r.period_start!), r.paid)
      else paidByCharge.set(r.charge_id!, r.paid)
    }
    const waivers = new Map<string, { id: string; reason: string }>()
    for (const r of this.db
      .prepare('SELECT id, enrollment_id, period_start, reason FROM fee_waivers WHERE deleted_at IS NULL')
      .all() as { id: string; enrollment_id: string; period_start: string; reason: string }[]) {
      waivers.set(periodKey(r.enrollment_id, r.period_start), { id: r.id, reason: r.reason })
    }

    const periods: PeriodItem[] = []
    for (const e of enrollments) {
      const f = fees.get(e.id)
      if (!f || f.length === 0) continue
      const list = periodsOf(e.start_date, e.end_date, f, today)
      if (withNext) {
        const next = nextPeriodAfter(e.start_date, e.end_date, f, today)
        if (next) list.push(next)
      }
      for (const period of list) {
        const v = versionOn(f, period.start) ?? f[0]!
        const key = periodKey(e.id, period.start)
        periods.push({
          kind: 'period',
          enrollment: e,
          period,
          concessionPaise: v.concessionPaise,
          concessionReason: v.concessionReason,
          waiver: waivers.get(key) ?? null,
          paidPaise: paidByPeriod.get(key) ?? 0
        })
      }
    }

    const charges: ChargeItem[] = (
      this.db
        .prepare(
          `SELECT c.id, c.student_id, s.full_name, s.student_code, c.kind, c.label, c.amount_paise, c.due_date, c.reason
           FROM charges c JOIN students s ON s.id = c.student_id
           WHERE c.deleted_at IS NULL AND s.deleted_at IS NULL ${studentId ? 'AND c.student_id = @studentId' : ''}
           ORDER BY c.due_date DESC, c.created_at DESC`
        )
        .all(studentId ? { studentId } : {}) as ChargeRow[]
    ).map((charge) => ({ kind: 'charge' as const, charge, paidPaise: paidByCharge.get(charge.id) ?? 0 }))

    return { periods, charges, fees }
  }

  private owedItems(periods: PeriodItem[], charges: ChargeItem[], asOf: string): OwedItem[] {
    const out: OwedItem[] = []
    for (const p of periods) {
      if (p.waiver || p.period.due > asOf) continue
      const b = balanceOf(p.period.amountPaise, p.paidPaise, p.period.due, asOf)
      if (b.balancePaise === 0) continue
      out.push({
        studentId: p.enrollment.student_id,
        studentName: p.enrollment.full_name,
        studentCode: p.enrollment.student_code,
        forText: forProgramText(p.enrollment.code, p.period),
        program: p.enrollment.code,
        due: p.period.due,
        amountPaise: p.period.amountPaise,
        balancePaise: b.balancePaise,
        partly: b.status === 'partly',
        daysDue: b.daysDue ?? 0,
        target: { kind: 'period', enrollmentId: p.enrollment.id, periodStart: p.period.start }
      })
    }
    for (const c of charges) {
      if (c.charge.due_date > asOf) continue
      const b = balanceOf(c.charge.amount_paise, c.paidPaise, c.charge.due_date, asOf)
      if (b.balancePaise === 0) continue
      out.push({
        studentId: c.charge.student_id,
        studentName: c.charge.full_name,
        studentCode: c.charge.student_code,
        forText: c.charge.label,
        program: null,
        due: c.charge.due_date,
        amountPaise: c.charge.amount_paise,
        balancePaise: b.balancePaise,
        partly: b.status === 'partly',
        daysDue: b.daysDue ?? 0,
        target: { kind: 'charge', chargeId: c.charge.id }
      })
    }
    return out.sort((a, b) => b.daysDue - a.daysDue || a.studentName.localeCompare(b.studentName) || a.forText.localeCompare(b.forText))
  }

  /** What is still owed for one target, for checking a new payment. Allows paying the next period in advance. */
  private owedFor(studentId: string, target: PaymentTarget, today: string) {
    if (target.kind === 'charge') {
      const c = this.db
        .prepare('SELECT label, amount_paise, student_id FROM charges WHERE id = ? AND deleted_at IS NULL')
        .get(target.chargeId) as { label: string; amount_paise: number; student_id: string } | undefined
      if (!c || c.student_id !== studentId) throw new UserError('This charge could not be found.')
      const paid = this.paidTowards('charge_id = ?', [target.chargeId])
      return { forText: c.label, balancePaise: Math.max(0, c.amount_paise - paid), waived: false }
    }
    const e = this.enrollment(target.enrollmentId)
    if (e.student_id !== studentId) throw new UserError('This program belongs to another child.')
    const period = this.periodOf(e, target.periodStart, today)
    if (!period) throw new UserError('That period could not be found. It may not have started yet.')
    const paid = this.paidTowards('enrollment_id = ? AND period_start = ?', [target.enrollmentId, target.periodStart])
    return {
      forText: forProgramText(e.code, period),
      balancePaise: Math.max(0, period.amountPaise - paid),
      waived: this.waiverId(target.enrollmentId, target.periodStart) !== undefined
    }
  }

  /** A period of this program up to today, or the next one (paid in advance). */
  private periodOf(e: EnrollmentRow, start: string, today: string): Period | undefined {
    const f = this.feesFor([e.id]).get(e.id)
    if (!f?.length) return undefined
    const found = periodsOf(e.start_date, e.end_date, f, today).find((p) => p.start === start)
    if (found) return found
    const next = nextPeriodAfter(e.start_date, e.end_date, f, today)
    return next?.start === start ? next : undefined
  }

  private paymentViews(rows: PaymentRow[], periods: PeriodItem[], charges: ChargeItem[]): PaymentView[] {
    const periodByKey = new Map(periods.map((p) => [periodKey(p.enrollment.id, p.period.start), p]))
    const chargeById = new Map(charges.map((c) => [c.charge.id, c.charge]))
    const reversed = new Set(rows.filter((r) => r.reverses_payment_id).map((r) => r.reverses_payment_id!))
    const seqById = new Map(rows.map((r) => [r.id, r.payment_seq]))

    // What was left right after each (non-reversed) payment, in the order they were received.
    const left = new Map<string, number>()
    const running = new Map<string, number>()
    for (const r of [...rows].sort((a, b) => a.paid_at.localeCompare(b.paid_at) || a.payment_seq - b.payment_seq)) {
      if (r.kind !== 'payment' || reversed.has(r.id)) continue
      const key = r.enrollment_id ? periodKey(r.enrollment_id, r.period_start!) : r.charge_id!
      const sum = (running.get(key) ?? 0) + r.amount_paise
      running.set(key, sum)
      const total = r.enrollment_id ? periodByKey.get(key)?.period.amountPaise : chargeById.get(r.charge_id!)?.amount_paise
      if (total !== undefined) left.set(r.id, Math.max(0, total - sum))
    }

    return rows.map((r) => {
      let forText: string
      if (r.enrollment_id) {
        const p = periodByKey.get(periodKey(r.enrollment_id, r.period_start!))
        forText = p ? forProgramText(p.enrollment.code, p.period) : `${PROGRAM_NAME[this.programCode(r.enrollment_id)]} · from ${formatDate(r.period_start!)}`
      } else {
        forText = chargeById.get(r.charge_id!)?.label ?? 'Cancelled charge'
      }
      return {
        id: r.id,
        no: paymentNo(r.payment_seq),
        kind: r.kind,
        paidAt: r.paid_at,
        amountPaise: r.amount_paise,
        method: r.method,
        reference: r.reference,
        recordedBy: r.recorded_by,
        remarks: r.remarks,
        reason: r.reason,
        forText,
        reversed: reversed.has(r.id),
        reversesNo: r.reverses_payment_id ? paymentNo(seqById.get(r.reverses_payment_id) ?? this.seqOf(r.reverses_payment_id)) : null,
        leftAfterPaise: left.get(r.id) ?? null
      }
    })
  }

  private recent(limit: number, periods: PeriodItem[], charges: ChargeItem[]): RecentPayment[] {
    const rows = this.db
      .prepare(
        `SELECT p.*, s.full_name FROM payments p JOIN students s ON s.id = p.student_id
         WHERE p.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY p.paid_at DESC, p.payment_seq DESC LIMIT ?`
      )
      .all(limit) as (PaymentRow & { full_name: string })[]
    const views = this.paymentViews(rows, periods, charges)
    return rows.map((r, i) => ({
      id: r.id,
      no: views[i]!.no,
      studentId: r.student_id,
      studentName: r.full_name,
      forText: r.kind === 'reversal' ? `Reversal of ${views[i]!.reversesNo}` : views[i]!.forText,
      paidAt: r.paid_at,
      method: r.method,
      amountPaise: r.amount_paise,
      kind: r.kind
    }))
  }

  private paymentRows(where: string, params: unknown[]): PaymentRow[] {
    return this.db
      .prepare(`SELECT * FROM payments WHERE deleted_at IS NULL AND ${where} ORDER BY paid_at DESC, payment_seq DESC`)
      .all(...params) as PaymentRow[]
  }

  private enrollments(studentId: string | null): EnrollmentRow[] {
    return this.db
      .prepare(
        `SELECT e.id, e.student_id, s.full_name, s.student_code, p.code, p.sort_order, e.start_date, e.end_date
         FROM enrollments e JOIN students s ON s.id = e.student_id JOIN programs p ON p.id = e.program_id
         WHERE e.deleted_at IS NULL AND s.deleted_at IS NULL ${studentId ? 'AND e.student_id = @studentId' : ''}
         ORDER BY (e.end_date IS NOT NULL AND e.end_date < @today), p.sort_order, e.start_date DESC`
      )
      .all(studentId ? { studentId, today: this.w.today() } : { today: this.w.today() }) as EnrollmentRow[]
  }

  private feesFor(enrollmentIds: string[]): Map<string, FeeVersion[]> {
    const out = new Map<string, FeeVersion[]>(enrollmentIds.map((id) => [id, []]))
    if (enrollmentIds.length === 0) return out
    for (const r of this.db
      .prepare(
        `SELECT enrollment_id, id, effective_from AS effectiveFrom, period_months AS periodMonths, due_day AS dueDay,
                standard_paise AS standardPaise, concession_paise AS concessionPaise, agreed_paise AS agreedPaise,
                concession_reason AS concessionReason, remarks
         FROM fee_agreements WHERE deleted_at IS NULL AND enrollment_id IN (SELECT value FROM json_each(?))
         ORDER BY effective_from`
      )
      .all(JSON.stringify(enrollmentIds)) as (FeeVersion & { enrollment_id: string })[]) {
      const { enrollment_id, ...v } = r
      out.get(enrollment_id)!.push(v)
    }
    return out
  }

  private enrollment(id: string): EnrollmentRow {
    const e = this.db
      .prepare(
        `SELECT e.id, e.student_id, s.full_name, s.student_code, p.code, p.sort_order, e.start_date, e.end_date
         FROM enrollments e JOIN students s ON s.id = e.student_id JOIN programs p ON p.id = e.program_id
         WHERE e.id = ? AND e.deleted_at IS NULL AND s.deleted_at IS NULL`
      )
      .get(id) as EnrollmentRow | undefined
    if (!e) throw new UserError('This program could not be found. It may have been removed.')
    return e
  }

  private requireStudent(studentId: string) {
    if (!this.db.prepare('SELECT 1 FROM students WHERE id = ? AND deleted_at IS NULL').get(studentId)) {
      throw new UserError('This student could not be found. They may have been removed.')
    }
  }

  private paidTowards(where: string, params: unknown[]): number {
    return this.db
      .prepare(`SELECT coalesce(sum(amount_paise), 0) FROM payments WHERE deleted_at IS NULL AND ${where}`)
      .pluck()
      .get(...params) as number
  }

  private waiverId(enrollmentId: string, periodStart: string): string | undefined {
    return this.db
      .prepare('SELECT id FROM fee_waivers WHERE enrollment_id = ? AND period_start = ? AND deleted_at IS NULL')
      .pluck()
      .get(enrollmentId, periodStart) as string | undefined
  }

  private nextSeq(): number {
    return ((this.db.prepare('SELECT max(payment_seq) FROM payments').pluck().get() as number | null) ?? 0) + 1
  }

  private seqOf(paymentId: string): number {
    return this.db.prepare('SELECT payment_seq FROM payments WHERE id = ?').pluck().get(paymentId) as number
  }

  private programCode(enrollmentId: string): ProgramCode {
    return this.db
      .prepare('SELECT p.code FROM enrollments e JOIN programs p ON p.id = e.program_id WHERE e.id = ?')
      .pluck()
      .get(enrollmentId) as ProgramCode
  }
}

function targetColumns(t: PaymentTarget) {
  return t.kind === 'period'
    ? { enrollment_id: t.enrollmentId, period_start: t.periodStart, charge_id: null }
    : { enrollment_id: null, period_start: null, charge_id: t.chargeId }
}
