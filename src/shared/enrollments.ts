// Types shared by the programs / enrollments module (main process ⇄ UI).

export const PROGRAM_CODES = ['pg', 'lk', 'uk', 'tu'] as const
export type ProgramCode = (typeof PROGRAM_CODES)[number]

export const PROGRAM_NAME: Record<ProgramCode, string> = { pg: 'Playgroup', lk: 'LKG', uk: 'UKG', tu: 'Tuition' }
export const isKindergarten = (code: ProgramCode) => code !== 'tu'

/**
 * How often a child pays, chosen per child at admission. `months` is what the app calculates with
 * (0 = one-time). The owner will confirm the final list: add or remove entries here, nothing else
 * needs to change (the database accepts 0–24 months).
 */
export const FEE_PERIODS = [
  { months: 1, label: 'Monthly', per: '/ month' },
  { months: 2, label: 'Every 2 months', per: 'every 2 months' },
  { months: 3, label: 'Every 3 months', per: 'every 3 months' },
  { months: 6, label: 'Every 6 months', per: 'every 6 months' },
  { months: 12, label: 'Yearly', per: '/ year' },
  { months: 0, label: 'One-time', per: 'one-time' }
] as const

export const isKnownPeriod = (months: number) => FEE_PERIODS.some((p) => p.months === months)

/** "/ month", "every 3 months", "one-time"… (also works for a length no longer in the list). */
export function perText(months: number): string {
  const p = FEE_PERIODS.find((x) => x.months === months)
  if (p) return p.per
  return months === 0 ? 'one-time' : `every ${months} months`
}

/** "₹1,500 / month", "₹4,500 every 3 months". */
export const feeWithPeriod = (amount: string, months: number) => `${amount} ${perText(months)}`

/** 1 → "1st", 22 → "22nd", 31 → "31st". */
export function ordinal(n: number): string {
  const tens = n % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${suffix}`
}

/** "Due on the 10th" / "Due on the 31st (last day in shorter months)". */
export function dueDayText(day: number, periodMonths: number): string {
  if (periodMonths === 0) return `Due on the ${ordinal(day)}`
  return `Due on the ${ordinal(day)}${day > 28 ? ' (last day in shorter months)' : ''}`
}

export interface ScheduleVersion {
  id: string
  effectiveFrom: string
  days: number
  arrives: string
  leaves: string
}

export interface FeeVersion {
  id: string
  effectiveFrom: string
  /** 1 = monthly, 3 = every 3 months, 0 = one-time. */
  periodMonths: number
  /** Day of the month the fee is due (1–31). */
  dueDay: number
  standardPaise: number
  concessionPaise: number
  agreedPaise: number
  concessionReason: string
  remarks: string
}

export type EnrollmentState = 'upcoming' | 'current' | 'ended'

export function enrollmentState(startDate: string, endDate: string | null, today: string): EnrollmentState {
  if (endDate !== null && endDate < today) return 'ended'
  return startDate > today ? 'upcoming' : 'current'
}

export interface EnrollmentView {
  id: string
  program: ProgramCode
  startDate: string
  endDate: string | null
  endReason: string
  state: EnrollmentState
  /** Oldest first. Never empty. */
  schedules: ScheduleVersion[]
  /** Oldest first. Never empty. */
  fees: FeeVersion[]
}

export interface ProgramDefaults {
  code: ProgramCode
  name: string
  days: number
  arrives: string
  leaves: string
  /** The standard fee most recently agreed for this program, to pre-fill the form. */
  lastStandardPaise: number | null
}

/** Total of the agreed monthly fees (fees paid every few months or once are left out). */
export function monthlyTotalPaise(fees: readonly { periodMonths: number; agreedPaise: number }[]): number {
  return fees.reduce((sum, f) => sum + (f.periodMonths === 1 ? f.agreedPaise : 0), 0)
}
