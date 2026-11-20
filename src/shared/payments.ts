// Types shared by the payments module (main process ⇄ UI).
import { formatDate } from './dates'
import type { EnrollmentState, ProgramCode } from './enrollments'
import { PROGRAM_NAME } from './enrollments'
import { monthLabel, type Balance, type Period } from './periods'
import type { PAYMENT_METHODS, CHARGE_KINDS, PaymentTarget } from './schemas'

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]
export type ChargeKind = (typeof CHARGE_KINDS)[number]

export const METHOD_LABEL: Record<PaymentMethod, string> = { cash: 'Cash', upi: 'UPI', bank: 'Bank transfer' }
export const CHARGE_KIND_LABEL: Record<ChargeKind, string> = { admission: 'Admission fee', fine: 'Late fine', other: 'Other charge' }

/** "PAY-0007" */
export const paymentNo = (seq: number) => `PAY-${String(seq).padStart(4, '0')}`

/** "Nov 2026"; a first month charged by days: "15–30 Nov 2026"; longer periods: "15 Jun 2026 – 31 Aug 2026"; "One-time". */
export function periodLabel(p: Pick<Period, 'start' | 'end' | 'periodMonths'>): string {
  if (p.periodMonths === 0 || p.end === null) return 'One-time'
  if (p.periodMonths === 1) {
    if (p.start.slice(8) === '01') return monthLabel(p.start)
    return `${Number(p.start.slice(8))}–${formatDate(p.end)}`
  }
  return `${formatDate(p.start)} – ${formatDate(p.end)}`
}

export interface PeriodView extends Period, Balance {
  waiver: { id: string; reason: string } | null
}

export interface ProgramFees {
  enrollmentId: string
  program: ProgramCode
  state: EnrollmentState
  /** Newest first, up to today. */
  periods: PeriodView[]
  /** The next period not started yet, if the program continues. */
  next: Period | null
  /** The fee agreed now (the full monthly amount, even when the first month is charged by days). */
  fee: { agreedPaise: number; periodMonths: number; dueDay: number } | null
}

export interface ChargeView extends Balance {
  id: string
  kind: ChargeKind
  label: string
  dueDate: string
  reason: string
}

export interface PaymentView {
  id: string
  no: string
  kind: 'payment' | 'reversal'
  /** "YYYY-MM-DDTHH:MM" */
  paidAt: string
  amountPaise: number
  method: PaymentMethod
  reference: string
  recordedBy: string
  remarks: string
  /** Reversals: why. */
  reason: string
  /** "LKG · Oct 2026", "Admission fee"… */
  forText: string
  /** A payment that has been reversed. */
  reversed: boolean
  /** Reversals: the payment number they cancel. */
  reversesNo: string | null
  /** What was still owed for that period / charge right after this entry. Null for reversed entries. */
  leftAfterPaise: number | null
}

export interface StudentFees {
  today: string
  /** The laptop's time when loaded, "HH:MM" (default time for a new payment). */
  now: string
  programs: ProgramFees[]
  charges: ChargeView[]
  /** Newest first. */
  payments: PaymentView[]
  /** Owed now (due today or earlier). */
  owedPaise: number
  /** Paid (net of reversals) in the current academic year. */
  paidThisYearPaise: number
}

/** One thing owed by a child, for the follow-up lists. */
export interface OwedItem {
  studentId: string
  studentName: string
  studentCode: string
  /** "LKG · Oct 2026", "Late fine" */
  forText: string
  program: ProgramCode | null
  due: string
  amountPaise: number
  balancePaise: number
  partly: boolean
  daysDue: number
  /** For "Collect": what a payment would be for. */
  target: PaymentTarget
}

export interface RecentPayment {
  id: string
  no: string
  studentId: string
  studentName: string
  forText: string
  paidAt: string
  method: PaymentMethod
  amountPaise: number
  kind: 'payment' | 'reversal'
}

export interface FeesOverview {
  today: string
  /** Net of reversals, in the current calendar month. */
  collectedThisMonthPaise: number
  /** Everything falling due this month (programs + charges, not waived). */
  dueThisMonthPaise: number
  /** Still owed from periods/charges due before this month. */
  outstandingEarlierPaise: number
  outstandingStudents: number
  oldestDue: string | null
  /** Everyone who owes something due today or earlier, longest due first. */
  owed: OwedItem[]
  recent: RecentPayment[]
}

export interface MonthReport {
  /** "YYYY-MM" */
  month: string
  collectedPaise: number
  byProgram: { label: string; paise: number }[]
  byMethod: Record<PaymentMethod, number>
  /** Concessions on periods due this month. */
  concessions: { studentName: string; program: ProgramCode; concessionPaise: number; reason: string }[]
  concessionTotalPaise: number
  /** Still owed at the end of the month (or today, for the current month). */
  owed: OwedItem[]
}

export const forProgramText = (code: ProgramCode, p: Pick<Period, 'start' | 'end' | 'periodMonths'>) => `${PROGRAM_NAME[code]} · ${periodLabel(p)}`
