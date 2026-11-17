import type Database from 'better-sqlite3'
import {
  HISTORY_DAYS,
  liveEvents,
  replay,
  type AttendanceEvent,
  type DashboardSummary,
  type DayView,
  type HistoryDay,
  type ProgramHistory,
  type SessionState,
  type SessionView
} from '@shared/attendance'
import { addDays, formatDate } from '@shared/dates'
import { PROGRAM_CODES, PROGRAM_NAME, isKindergarten, type ProgramCode } from '@shared/enrollments'
import { expectedOn } from '@shared/schedule'
import {
  attendanceDaySchema,
  attendanceManySchema,
  attendanceTapSchema,
  isoDateSchema,
  type AttendanceDayInput,
  type AttendanceTap
} from '@shared/schemas'
import type { Writer } from '../db/writer'
import { UserError } from '../errors'

type EventRow = {
  id: string
  enrollment_id: string
  date: string
  kind: AttendanceEvent['kind']
  at: string | null
  note: string
  voids_event_id: string | null
}

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

type Schedule = { effective_from: string; days: number; arrives: string; leaves: string }

const toEvent = (r: EventRow): AttendanceEvent => ({
  id: r.id,
  kind: r.kind,
  at: r.at,
  note: r.note,
  voidsEventId: r.voids_event_id
})

/** How far back the profile looks for school days to show. */
const HISTORY_LOOKBACK_DAYS = 60

/**
 * Attendance is append-only: every tap adds an event, mistakes are cancelled with a 'void' event.
 * Which children are expected on a day comes from their programs' schedules.
 */
export class AttendanceRepo {
  private readonly db: Database.Database

  constructor(private readonly w: Writer) {
    this.db = w.db
  }

  // ---------- Reading ----------

  /** Everyone expected on `date` (plus anyone recorded that day), with what has been marked. */
  day(date: string = this.w.today()): DayView {
    isoDateSchema.parse(date)
    const enrollments = this.db
      .prepare(
        `SELECT e.id, e.student_id, s.full_name, s.student_code, p.code, p.sort_order, e.start_date, e.end_date
         FROM enrollments e JOIN students s ON s.id = e.student_id JOIN programs p ON p.id = e.program_id
         WHERE e.deleted_at IS NULL AND s.deleted_at IS NULL
           AND ((e.start_date <= @date AND (e.end_date IS NULL OR e.end_date >= @date))
                OR EXISTS (SELECT 1 FROM attendance_events a
                           WHERE a.enrollment_id = e.id AND a.date = @date AND a.deleted_at IS NULL))`
      )
      .all({ date }) as EnrollmentRow[]
    const events = this.eventsOn(date)
    const sessions: SessionView[] = []
    for (const e of enrollments) {
      const sched = this.scheduleOn(e.id, date)
      const expected = !!sched && expectedOn(sched.days, date) && e.start_date <= date && (e.end_date === null || e.end_date >= date)
      const evs = events.get(e.id) ?? []
      if (!expected && evs.length === 0) continue
      sessions.push({
        enrollmentId: e.id,
        studentId: e.student_id,
        studentName: e.full_name,
        studentCode: e.student_code,
        program: e.code,
        arrives: expected ? sched!.arrives : null,
        leaves: expected ? sched!.leaves : null,
        state: replay(evs)
      })
    }
    const order = new Map(enrollments.map((e) => [e.id, e.sort_order]))
    sessions.sort(
      (a, b) =>
        (a.arrives ?? '99').localeCompare(b.arrives ?? '99') ||
        a.studentName.localeCompare(b.studentName, 'en', { sensitivity: 'base' }) ||
        order.get(a.enrollmentId)! - order.get(b.enrollmentId)!
    )
    return { date, today: this.w.today(), now: this.w.time(), sessions }
  }

  /** The last school days for each of a child's programs, newest first. */
  history(studentId: string): { today: string; now: string; programs: ProgramHistory[] } {
    const today = this.w.today()
    const enrollments = this.db
      .prepare(
        `SELECT e.id, e.student_id, '' AS full_name, '' AS student_code, p.code, p.sort_order, e.start_date, e.end_date
         FROM enrollments e JOIN programs p ON p.id = e.program_id
         WHERE e.student_id = ? AND e.deleted_at IS NULL AND e.start_date <= ?
         ORDER BY (e.end_date IS NOT NULL AND e.end_date < ?), p.sort_order, e.start_date DESC`
      )
      .all(studentId, today, today) as EnrollmentRow[]
    const programs: ProgramHistory[] = []
    for (const e of enrollments) {
      const schedules = this.db
        .prepare(
          `SELECT effective_from, days, arrives, leaves FROM schedules
           WHERE enrollment_id = ? AND deleted_at IS NULL ORDER BY effective_from`
        )
        .all(e.id) as Schedule[]
      const byDate = new Map<string, AttendanceEvent[]>()
      for (const r of this.db
        .prepare(
          `SELECT * FROM attendance_events WHERE enrollment_id = ? AND deleted_at IS NULL
           ORDER BY created_at, rowid`
        )
        .all(e.id) as EventRow[]) {
        byDate.set(r.date, [...(byDate.get(r.date) ?? []), toEvent(r)])
      }
      const last = e.end_date !== null && e.end_date < today ? e.end_date : today
      const days: HistoryDay[] = []
      for (let i = 0; i < HISTORY_LOOKBACK_DAYS && days.length < HISTORY_DAYS; i++) {
        const date = addDays(last, -i)
        if (date < e.start_date) break
        let sched: Schedule | undefined
        for (const s of schedules) if (s.effective_from <= date) sched = s
        const expected = !!sched && expectedOn(sched.days, date)
        const evs = byDate.get(date)
        if (!expected && !evs) continue
        days.push({
          date,
          arrives: expected ? sched!.arrives : null,
          leaves: expected ? sched!.leaves : null,
          state: replay(evs ?? [])
        })
      }
      programs.push({ enrollmentId: e.id, program: e.code, days })
    }
    return { today, now: this.w.time(), programs }
  }

  summary(): DashboardSummary {
    const today = this.w.today()
    const activeStudents = this.db
      .prepare(`SELECT count(*) FROM students WHERE deleted_at IS NULL AND status = 'active'`)
      .pluck()
      .get() as number
    const open = this.db
      .prepare(
        `SELECT DISTINCT e.student_id, p.code FROM enrollments e
         JOIN programs p ON p.id = e.program_id JOIN students s ON s.id = e.student_id
         WHERE e.deleted_at IS NULL AND s.deleted_at IS NULL AND s.status = 'active'
           AND (e.end_date IS NULL OR e.end_date >= ?)`
      )
      .all(today) as { student_id: string; code: ProgramCode }[]
    const byProgram = Object.fromEntries(PROGRAM_CODES.map((c) => [c, 0])) as Record<ProgramCode, number>
    const perChild = new Map<string, ProgramCode[]>()
    for (const r of open) {
      byProgram[r.code]++
      perChild.set(r.student_id, [...(perChild.get(r.student_id) ?? []), r.code])
    }
    const kgAndTuition = [...perChild.values()].filter((l) => l.includes('tu') && l.some(isKindergarten)).length

    const recent = this.db
      .prepare(
        `SELECT s.id, s.full_name, s.joining_date,
                EXISTS (SELECT 1 FROM student_photos ph WHERE ph.student_id = s.id AND ph.deleted_at IS NULL) AS has_photo
         FROM students s WHERE s.deleted_at IS NULL AND s.status = 'active'
         ORDER BY s.joining_date DESC, s.created_at DESC LIMIT 3`
      )
      .all() as { id: string; full_name: string; joining_date: string; has_photo: number }[]
    const order = (c: ProgramCode) => PROGRAM_CODES.indexOf(c)
    return {
      activeStudents,
      kgAndTuition,
      byProgram,
      recentAdmissions: recent.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        joiningDate: r.joining_date,
        programs: [...new Set(perChild.get(r.id) ?? [])].sort((a, b) => order(a) - order(b)),
        hasPhoto: r.has_photo === 1
      }))
    }
  }

  // ---------- Marking ----------

  /** A button on the dashboard, for today, at the laptop's current time. Returns the event (for Undo) and the time. */
  tap(enrollmentId: string, input: AttendanceTap): { eventId: string; at: string } {
    const tap = attendanceTapSchema.parse(input)
    return this.w.transaction(() => {
      const date = this.w.today()
      const e = this.enrollment(enrollmentId)
      this.checkDate(e, date)
      const state = this.stateOf(enrollmentId, date)
      const at = this.w.time()
      if (tap.kind === 'arrived') return { eventId: this.add(enrollmentId, date, 'arrived', at), at }
      if (tap.kind === 'absent') return { eventId: this.add(enrollmentId, date, 'absent', null, tap.note), at }
      if (state.status !== 'in') throw new UserError('Mark the arrival first')
      if (state.arrived && at < state.arrived) throw new UserError('The leaving time is before the arrival time')
      return { eventId: this.add(enrollmentId, date, 'left', at), at }
    })
  }

  /** Cancels one event ("Undo"). */
  undo(eventId: string): void {
    this.w.transaction(() => {
      const ev = this.db
        .prepare('SELECT * FROM attendance_events WHERE id = ? AND deleted_at IS NULL')
        .get(eventId) as EventRow | undefined
      if (!ev || ev.kind === 'void') throw new UserError('Nothing to undo')
      const already = this.db
        .prepare(`SELECT 1 FROM attendance_events WHERE voids_event_id = ? AND deleted_at IS NULL`)
        .get(eventId)
      if (already) return
      this.voidEvent(ev)
    })
  }

  /** Sets what a day says (attendance screen, or a correction on the profile). Only changes are recorded. */
  setDay(enrollmentId: string, date: string, input: AttendanceDayInput): void {
    this.w.transaction(() => this.applyDay(enrollmentId, date, input))
  }

  /** The attendance screen's "Save": several children at once. */
  setMany(date: string, items: { enrollmentId: string; day: AttendanceDayInput }[]): void {
    const list = attendanceManySchema.parse(items)
    this.w.transaction(() => {
      for (const it of list) this.applyDay(it.enrollmentId, date, it.day)
    })
  }

  // ---------- Internals ----------

  private applyDay(enrollmentId: string, date: string, input: AttendanceDayInput) {
    isoDateSchema.parse(date)
    const d = attendanceDaySchema.parse(input)
    const e = this.enrollment(enrollmentId)
    this.checkDate(e, date)
    const events = this.eventsFor(enrollmentId, date)
    const cur = replay(events)
    const want: SessionState =
      d.status === 'none'
        ? { ...cur, status: 'none', arrived: null, left: null, note: '' }
        : d.status === 'absent'
          ? { ...cur, status: 'absent', arrived: null, left: null, note: d.note }
          : { ...cur, status: d.left ? 'out' : 'in', arrived: d.arrived || null, left: d.left || null, note: '' }
    if (cur.status === want.status && cur.arrived === want.arrived && cur.left === want.left && cur.note === want.note) return
    for (const ev of liveEvents(events)) this.voidEvent({ id: ev.id, enrollment_id: enrollmentId, date } as EventRow)
    if (want.status === 'absent') this.add(enrollmentId, date, 'absent', null, want.note)
    if (want.status === 'in' || want.status === 'out') this.add(enrollmentId, date, 'arrived', want.arrived)
    if (want.status === 'out') this.add(enrollmentId, date, 'left', want.left)
  }

  private add(enrollmentId: string, date: string, kind: 'arrived' | 'left' | 'absent', at: string | null, note = ''): string {
    return this.w.append('attendance_events', { enrollment_id: enrollmentId, date, kind, at, note, voids_event_id: null })
  }

  private voidEvent(ev: Pick<EventRow, 'id' | 'enrollment_id' | 'date'>) {
    this.w.append('attendance_events', {
      enrollment_id: ev.enrollment_id,
      date: ev.date,
      kind: 'void',
      at: null,
      note: '',
      voids_event_id: ev.id
    })
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

  private checkDate(e: EnrollmentRow, date: string) {
    const name = PROGRAM_NAME[e.code]
    if (date > this.w.today()) throw new UserError("Attendance can't be marked for a future day")
    if (date < e.start_date) throw new UserError(`${e.full_name} started ${name} on ${formatDate(e.start_date)}`)
    if (e.end_date !== null && date > e.end_date) throw new UserError(`${e.full_name}'s ${name} ended on ${formatDate(e.end_date)}`)
  }

  private stateOf(enrollmentId: string, date: string): SessionState {
    return replay(this.eventsFor(enrollmentId, date))
  }

  private eventsFor(enrollmentId: string, date: string): AttendanceEvent[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM attendance_events WHERE enrollment_id = ? AND date = ? AND deleted_at IS NULL
           ORDER BY created_at, rowid`
        )
        .all(enrollmentId, date) as EventRow[]
    ).map(toEvent)
  }

  private eventsOn(date: string): Map<string, AttendanceEvent[]> {
    const out = new Map<string, AttendanceEvent[]>()
    for (const r of this.db
      .prepare('SELECT * FROM attendance_events WHERE date = ? AND deleted_at IS NULL ORDER BY created_at, rowid')
      .all(date) as EventRow[]) {
      out.set(r.enrollment_id, [...(out.get(r.enrollment_id) ?? []), toEvent(r)])
    }
    return out
  }

  private scheduleOn(enrollmentId: string, date: string): Schedule | undefined {
    return this.db
      .prepare(
        `SELECT effective_from, days, arrives, leaves FROM schedules
         WHERE enrollment_id = ? AND deleted_at IS NULL AND effective_from <= ?
         ORDER BY effective_from DESC LIMIT 1`
      )
      .get(enrollmentId, date) as Schedule | undefined
  }
}
