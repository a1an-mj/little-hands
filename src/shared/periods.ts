// What a parent owes, worked out from a program's fee agreements (never stored).
//
// Owner's rules (paper admission form, 20 Nov 2026):
// - Fees follow calendar months and are due by the 5th (the agreement's due day, 5 by default).
// - Joining mid-month: the first month is charged only for the days left, by days in that month
//   (₹2,000/month, joins 15 Nov → 16/30 × ₹2,000 = ₹1,066.67), due on the joining day.
//   From the next month on, the full fee, due by the 5th.
// - Paying every N months: blocks of N calendar months from the joining month (joins in June,
//   every 3 months → June–Aug, Sept–Nov…), each due on the 5th of its first month. A first block
//   that starts mid-month is charged for the days left in its first month plus the other months.
// - The amount is the agreed fee in force on the period's first day.
// - When the child leaves, no new periods start after the last day, and nothing is refunded.
// - A one-time fee is a single period, due on the start date.
import { addDays } from './dates'
import { versionOn } from './effective'
import type { FeeVersion } from './enrollments'

export interface Period {
  /** First day ("YYYY-MM-DD"). Identifies the period (payments refer to it). */
  start: string
  /** Last day, or null for a one-time fee. */
  end: string | null
  /** When it has to be paid by. */
  due: string
  amountPaise: number
  periodMonths: number
  /** A first period that starts mid-month and is charged for the days left. */
  partial: boolean
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** The `day` of the month that is `months` after `iso`'s month (day 31 → last day of shorter months). */
export function monthPlus(iso: string, months: number, day: number): string {
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7)) - 1 + months
  const year = y + Math.floor(m / 12)
  const month = (((m % 12) + 12) % 12) + 1
  const d = Math.min(day, daysInMonth(year, month))
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** The share of a fee for the days left in the first month: 16 of 30 days of ₹2,000 → ₹1,066.67 (to the paisa). */
export function partialAmount(agreedPaise: number, periodMonths: number, start: string): number {
  const dim = daysInMonth(Number(start.slice(0, 4)), Number(start.slice(5, 7)))
  const daysLeft = dim - Number(start.slice(8, 10)) + 1
  return Math.round((agreedPaise * (daysLeft / dim + (periodMonths - 1))) / periodMonths)
}

/**
 * Periods of a program from its start date up to `until` (a period starting that day is included),
 * stopping after the program's last day. `fees` sorted oldest first, never empty.
 */
export function periodsOf(startDate: string, endDate: string | null, fees: readonly FeeVersion[], until: string): Period[] {
  const out: Period[] = []
  const last = endDate !== null && endDate < until ? endDate : until
  let cur = startDate
  // A safety limit: 600 periods is 50 years of monthly fees.
  for (let i = 0; i < 600 && cur <= last; i++) {
    const v = versionOn(fees, cur) ?? fees[0]!
    if (v.periodMonths === 0) {
      out.push({ start: cur, end: null, due: cur, amountPaise: v.agreedPaise, periodMonths: 0, partial: false })
      break
    }
    const n = v.periodMonths
    const next = monthPlus(cur, n, 1) // the 1st of the month after the block
    const midMonth = Number(cur.slice(8, 10)) !== 1
    out.push({
      start: cur,
      end: addDays(next, -1),
      // The first period is paid on joining; every later one by the due day (the 5th) of its first month.
      due: i === 0 ? cur : monthPlus(cur, 0, v.dueDay),
      amountPaise: midMonth ? partialAmount(v.agreedPaise, n, cur) : v.agreedPaise,
      periodMonths: n,
      partial: midMonth
    })
    cur = next
  }
  return out
}

/** The first period starting after `until` (for "next due on…"), or null if the program ends first. */
export function nextPeriodAfter(startDate: string, endDate: string | null, fees: readonly FeeVersion[], until: string): Period | null {
  return periodsOf(startDate, endDate, fees, monthPlus(until, 25, 31)).find((p) => p.start > until) ?? null
}

export type DueStatus = 'paid' | 'partly' | 'due' | 'waived' | 'upcoming'

export interface Balance {
  amountPaise: number
  paidPaise: number
  /** What is still owed (0 when paid or waived). */
  balancePaise: number
  status: DueStatus
  /** Days since the due date (0 = due today); null unless something is owed and due. */
  daysDue: number | null
}

const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000

/** Whole days from `from` to `to`. */
export const daysBetween = (from: string, to: string) => Math.round(dayNumber(to) - dayNumber(from))

/** Where a period (or a charge) stands, given what was paid (payments minus reversals) and whether it is waived. */
export function balanceOf(amountPaise: number, paidPaise: number, due: string, today: string, waived = false): Balance {
  if (waived) return { amountPaise, paidPaise, balancePaise: 0, status: 'waived', daysDue: null }
  const balancePaise = Math.max(0, amountPaise - paidPaise)
  if (balancePaise === 0) return { amountPaise, paidPaise, balancePaise, status: 'paid', daysDue: null }
  if (due > today) return { amountPaise, paidPaise, balancePaise, status: 'upcoming', daysDue: null }
  return { amountPaise, paidPaise, balancePaise, status: paidPaise > 0 ? 'partly' : 'due', daysDue: daysBetween(due, today) }
}

/** "Due today", "Due for 1 day", "Due for 12 days" (owner: shown from the due day). */
export function dueText(daysDue: number): string {
  if (daysDue <= 0) return 'Due today'
  return `Due for ${daysDue} day${daysDue === 1 ? '' : 's'}`
}

/** "Oct 2026" for a monthly period; "20 Oct – 19 Jan" style labels are built by the UI for longer ones. */
export function monthLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso + 'T00:00:00Z'))
}
