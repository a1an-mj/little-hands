// What a parent owes, worked out from a program's fee agreements (never stored).
//
// Owner's rules (Nov 2026):
// - Fees are paid in advance. The first period starts on the program's start date and is due that day.
// - After that a new period is due every N months on the due day (31 = last day in shorter months).
//   Joining on 20 June, monthly → due 20 June, 20 July, 20 August… No part-month fees.
// - The amount is the agreed fee in force on the period's first day.
// - When the child leaves, no new periods start after the last day, and nothing is refunded.
// - A one-time fee is a single period.
import { addDays } from './dates'
import { versionOn } from './effective'
import type { FeeVersion } from './enrollments'

export interface Period {
  /** First day, also the due date ("YYYY-MM-DD"). Identifies the period. */
  start: string
  /** Last day (the day before the next period), or null for a one-time fee. */
  end: string | null
  amountPaise: number
  periodMonths: number
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

/**
 * Periods of a program from its start date up to `until` (inclusive: a period starting that day is
 * included), stopping after the program's last day. `fees` sorted oldest first, never empty.
 */
export function periodsOf(startDate: string, endDate: string | null, fees: readonly FeeVersion[], until: string): Period[] {
  const out: Period[] = []
  const last = endDate !== null && endDate < until ? endDate : until
  let cur = startDate
  // A safety limit: 600 periods is 50 years of monthly fees.
  for (let i = 0; i < 600 && cur <= last; i++) {
    const v = versionOn(fees, cur) ?? fees[0]!
    if (v.periodMonths === 0) {
      out.push({ start: cur, end: null, amountPaise: v.agreedPaise, periodMonths: 0 })
      break
    }
    // The next due date: the due day, N months on. If the due day is earlier in the month than the
    // start (e.g. started on the 20th, due on the 10th), that is still the next month, never sooner.
    let next = monthPlus(cur, v.periodMonths, v.dueDay)
    if (next <= cur) next = monthPlus(cur, v.periodMonths + 1, v.dueDay)
    out.push({ start: cur, end: addDays(next, -1), amountPaise: v.agreedPaise, periodMonths: v.periodMonths })
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
