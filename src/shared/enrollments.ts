// Types shared by the programs / enrollments module (main process ⇄ UI).

export const PROGRAM_CODES = ['pg', 'lk', 'uk', 'tu'] as const
export type ProgramCode = (typeof PROGRAM_CODES)[number]

export const PROGRAM_NAME: Record<ProgramCode, string> = { pg: 'Playgroup', lk: 'LKG', uk: 'UKG', tu: 'Tuition' }
export const isKindergarten = (code: ProgramCode) => code !== 'tu'

export const FEE_FREQUENCIES = ['monthly', 'term', 'custom'] as const
export type FeeFrequency = (typeof FEE_FREQUENCIES)[number]
export const FREQUENCY_LABEL: Record<FeeFrequency, string> = { monthly: 'Monthly', term: 'Per term', custom: 'Custom' }

/** "month", "term", or the owner's own words for a custom arrangement. */
export function perLabel(frequency: FeeFrequency, customLabel: string): string {
  if (frequency === 'monthly') return 'month'
  if (frequency === 'term') return 'term'
  return customLabel.trim() || 'period'
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
  frequency: FeeFrequency
  customLabel: string
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

/** Total of the agreed monthly fees (term-wise and custom fees are not monthly, so they are left out). */
export function monthlyTotalPaise(fees: readonly { frequency: FeeFrequency; agreedPaise: number }[]): number {
  return fees.reduce((sum, f) => sum + (f.frequency === 'monthly' ? f.agreedPaise : 0), 0)
}
