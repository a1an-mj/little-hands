// Attendance: one "session" is one program on one day (LKG on Mon 2 Nov). Its status is worked
// out by replaying that session's events in the order they were saved, skipping cancelled ones.
import type { ProgramCode } from './enrollments'
import { formatTime } from './schedule'

export type AttendanceKind = 'arrived' | 'left' | 'absent' | 'void'

export interface AttendanceEvent {
  id: string
  kind: AttendanceKind
  /** "HH:MM", or null ("present" marked without a time; always null for absent/void). */
  at: string | null
  note: string
  voidsEventId: string | null
}

export type SessionStatus = 'none' | 'in' | 'out' | 'absent'

export interface SessionState {
  status: SessionStatus
  /** Arrival time; null if not arrived or marked present without a time. */
  arrived: string | null
  left: string | null
  /** Reason for an absence, e.g. "fever". */
  note: string
  /** The last event still in force: what "Undo" cancels. */
  lastEventId: string | null
}

export const EMPTY_SESSION: SessionState = { status: 'none', arrived: null, left: null, note: '', lastEventId: null }

/** Replays events (oldest first). A void cancels the event it points at. */
export function replay(events: readonly AttendanceEvent[]): SessionState {
  const voided = new Set(events.filter((e) => e.kind === 'void').map((e) => e.voidsEventId))
  let s: SessionState = EMPTY_SESSION
  for (const e of events) {
    if (e.kind === 'void' || voided.has(e.id)) continue
    if (e.kind === 'arrived') s = { status: 'in', arrived: e.at, left: null, note: '', lastEventId: e.id }
    else if (e.kind === 'left') s = { ...s, status: 'out', left: e.at, lastEventId: e.id }
    else s = { status: 'absent', arrived: null, left: null, note: e.note, lastEventId: e.id }
  }
  return s
}

/** The events still in force (what has to be cancelled to clear the day). */
export function liveEvents(events: readonly AttendanceEvent[]): AttendanceEvent[] {
  const voided = new Set(events.filter((e) => e.kind === 'void').map((e) => e.voidsEventId))
  return events.filter((e) => e.kind !== 'void' && !voided.has(e.id))
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** How many minutes after the expected time (0 if on time or early). */
export const minutesLate = (expected: string, actual: string) => Math.max(0, minutes(actual) - minutes(expected))

/** 5 → "5 min", 90 → "1 hr 30 min", 120 → "2 hr". */
export function durationText(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`
}

/** Not marked yet, and the expected time is this far away or more: shown as "Later today". */
export const LATER_TODAY_MIN = 60

export type WaitingNote = { kind: 'later' } | { kind: 'soon' } | { kind: 'late'; mins: number }

/** For a session not marked yet today: still to come, or late (by how much). */
export function waitingNote(expectedArrives: string, now: string): WaitingNote {
  const diff = minutes(expectedArrives) - minutes(now)
  if (diff >= LATER_TODAY_MIN) return { kind: 'later' }
  if (diff >= 0) return { kind: 'soon' }
  return { kind: 'late', mins: -diff }
}

/** "In 8:41 AM · out 12:35 PM", "Present · out —"… */
export function inOutText(s: SessionState): string {
  if (s.status === 'none' || s.status === 'absent') return '—'
  const inText = s.arrived ? `In ${formatTime(s.arrived)}` : 'Present'
  return `${inText} · out ${s.left ? formatTime(s.left) : '—'}`
}

/** One expected (or recorded) program session on a day, as the dashboard and attendance screen show it. */
export interface SessionView {
  enrollmentId: string
  studentId: string
  studentName: string
  studentCode: string
  program: ProgramCode
  /** Expected timings that day; null if the child wasn't expected (came on an extra day). */
  arrives: string | null
  leaves: string | null
  state: SessionState
}

export interface DayView {
  date: string
  /** The laptop's date and time when this was loaded: "today" and "now" for the late notes. */
  today: string
  now: string
  /** Sorted by expected arrival, then name. */
  sessions: SessionView[]
}

export interface DayCounts {
  /** Children expected (a child in LKG + Tuition counts once). */
  expected: number
  arrived: number
  absent: number
  notYet: number
}

/** Counts per child: arrived if any session arrived; absent if every session is absent. */
export function dayCounts(sessions: readonly SessionView[]): DayCounts {
  const byChild = new Map<string, SessionStatus[]>()
  for (const s of sessions) byChild.set(s.studentId, [...(byChild.get(s.studentId) ?? []), s.state.status])
  let arrived = 0
  let absent = 0
  for (const list of byChild.values()) {
    if (list.some((x) => x === 'in' || x === 'out')) arrived++
    else if (list.every((x) => x === 'absent')) absent++
  }
  return { expected: byChild.size, arrived, absent, notYet: byChild.size - arrived - absent }
}

/** One day in a child's history for one program. */
export interface HistoryDay {
  date: string
  /** Expected arrival that day (null if it wasn't a scheduled day but something was recorded). */
  arrives: string | null
  leaves: string | null
  state: SessionState
}

export interface ProgramHistory {
  enrollmentId: string
  program: ProgramCode
  /** Newest first. */
  days: HistoryDay[]
}

/** How many past school days the profile shows per program. */
export const HISTORY_DAYS = 10

export interface DashboardSummary {
  activeStudents: number
  /** Active children in a kindergarten class and Tuition at the same time. */
  kgAndTuition: number
  /** Active children per program today (a child in two programs counts in both). */
  byProgram: Record<ProgramCode, number>
  recentAdmissions: { id: string; fullName: string; joiningDate: string; programs: ProgramCode[]; hasPhoto: boolean }[]
}
