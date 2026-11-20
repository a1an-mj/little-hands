// Calendar and to-do list: shared types and helpers.
import { addDays } from './dates'

export const EVENT_KINDS = ['event', 'holiday', 'meeting'] as const
export type EventKind = (typeof EVENT_KINDS)[number]
export const EVENT_KIND_LABEL: Record<EventKind, string> = { event: 'Event', holiday: 'Holiday', meeting: 'Meeting' }

/** One thing on a calendar day. Events can be edited; the rest come from elsewhere in the app. */
export type CalendarItem =
  | { kind: EventKind; id: string; date: string; title: string; time: string | null; notes: string }
  | { kind: 'closed'; date: string; title: string }
  | { kind: 'birthday'; date: string; title: string; studentId: string }
  | { kind: 'todo'; date: string; title: string; id: string; done: boolean; studentId: string | null }

export interface MonthView {
  /** "YYYY-MM" */
  month: string
  today: string
  items: CalendarItem[]
}

export interface TodoView {
  id: string
  title: string
  notes: string
  dueDate: string | null
  studentId: string | null
  studentName: string | null
  doneAt: string | null
}

export interface TodoList {
  today: string
  open: TodoView[]
  /** The most recently ticked, newest first. */
  done: TodoView[]
}

export type TodoGroup = 'overdue' | 'today' | 'upcoming' | 'nodate'
export const TODO_GROUP_LABEL: Record<TodoGroup, string> = { overdue: 'Overdue', today: 'Today', upcoming: 'Upcoming', nodate: 'No date' }

export function todoGroup(t: Pick<TodoView, 'dueDate'>, today: string): TodoGroup {
  if (!t.dueDate) return 'nodate'
  return t.dueDate < today ? 'overdue' : t.dueDate === today ? 'today' : 'upcoming'
}

/** "Due today", "Due tomorrow", "2 days late"… */
export function dueText(due: string, today: string): string {
  if (due === today) return 'Due today'
  if (due === addDays(today, 1)) return 'Due tomorrow'
  if (due < today) {
    const days = Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000)
    return days === 1 ? '1 day late' : `${days} days late`
  }
  return ''
}

/** The 6 × 7 grid of dates for a month view, starting on Monday. */
export function monthGrid(month: string): string[] {
  const first = `${month}-01`
  const weekday = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7 // Monday = 0
  const start = addDays(first, -weekday)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

/** "2026-11" ± n months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

/** The day a birthday falls on in a given year (29 Feb → 28 Feb when it isn't a leap year). */
export function birthdayIn(dob: string, year: number): string {
  const md = dob.slice(5)
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  return `${year}-${md === '02-29' && !leap ? '02-28' : md}`
}
