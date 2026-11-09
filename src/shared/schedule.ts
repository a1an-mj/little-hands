// Expected timings: which weekdays, and when the child arrives and leaves.
import { weekdayOf } from './dates'

export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
/** The form offers Monday to Saturday (the kindergarten doesn't open on Sundays). */
export const SCHOOL_DAYS = 6

/** Days are stored as one bit per weekday: Monday = 1, Tuesday = 2 … Sunday = 64. */
export const dayBit = (day: number) => 1 << day
export const hasDay = (mask: number, day: number) => (mask & dayBit(day)) !== 0
export const toggleDay = (mask: number, day: number) => mask ^ dayBit(day)

/** 31 → "Mon–Fri"; 21 → "Mon, Wed, Fri"; 23 → "Mon–Wed, Fri". */
export function formatDays(mask: number): string {
  const days = DAY_LABELS.map((_, i) => i).filter((i) => hasDay(mask, i))
  const parts: string[] = []
  let i = 0
  while (i < days.length) {
    let j = i
    while (j + 1 < days.length && days[j + 1] === days[j]! + 1) j++
    const run = j - i + 1
    if (run >= 3) parts.push(`${DAY_LABELS[days[i]!]}–${DAY_LABELS[days[j]!]}`)
    else for (let k = i; k <= j; k++) parts.push(DAY_LABELS[days[k]!]!)
    i = j + 1
  }
  return parts.join(', ')
}

/** Does this schedule expect the child on that date? */
export const expectedOn = (mask: number, iso: string) => hasDay(mask, weekdayOf(iso))

function parts(hhmm: string) {
  const h = Number(hhmm.slice(0, 2))
  return { h12: h % 12 === 0 ? 12 : h % 12, m: hhmm.slice(3, 5), ap: h < 12 ? 'AM' : 'PM' }
}

/** "08:45" → "8:45 AM"; "16:00" → "4:00 PM". */
export function formatTime(hhmm: string): string {
  const t = parts(hhmm)
  return `${t.h12}:${t.m} ${t.ap}`
}

/** "8:45 AM – 12:30 PM", or "4:00 – 5:30 PM" when both are in the same half of the day. */
export function formatTimeRange(arrives: string, leaves: string): string {
  const a = parts(arrives)
  const l = parts(leaves)
  return a.ap === l.ap ? `${a.h12}:${a.m} – ${formatTime(leaves)}` : `${formatTime(arrives)} – ${formatTime(leaves)}`
}
