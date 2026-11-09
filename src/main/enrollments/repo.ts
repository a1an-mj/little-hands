import type Database from 'better-sqlite3'
import { formatDate } from '@shared/dates'
import {
  PROGRAM_NAME,
  enrollmentState,
  type EnrollmentView,
  type FeeFrequency,
  type FeeVersion,
  type ProgramCode,
  type ProgramDefaults,
  type ScheduleVersion
} from '@shared/enrollments'
import {
  endEnrollmentSchema,
  enrollmentEditSchema,
  enrollmentInputSchema,
  type EndEnrollmentInput,
  type Enrollment,
  type EnrollmentEditInput,
  type EnrollmentInput,
  type Fee
} from '@shared/schemas'
import { UserError } from '../errors'
import type { Writer } from '../db/writer'

type EnrollmentRow = {
  id: string
  student_id: string
  code: ProgramCode
  sort_order: number
  start_date: string
  end_date: string | null
  end_reason: string
}

type ScheduleFields = Omit<ScheduleVersion, 'id' | 'effectiveFrom'>

const feeColumns = (f: Fee) => ({
  frequency: f.frequency,
  custom_label: f.frequency === 'custom' ? f.customLabel : '',
  standard_paise: f.standard,
  concession_paise: f.concession,
  concession_reason: f.concession > 0 ? f.concessionReason : '',
  remarks: f.remarks
})

const scheduleColumns = (s: ScheduleFields) => ({ days: s.days, arrives: s.arrives, leaves: s.leaves })

const sameSchedule = (a: ScheduleFields, b: ScheduleFields) => a.days === b.days && a.arrives === b.arrives && a.leaves === b.leaves

function sameFee(v: FeeVersion, f: Fee): boolean {
  const c = feeColumns(f)
  return (
    v.frequency === c.frequency &&
    v.customLabel === c.custom_label &&
    v.standardPaise === c.standard_paise &&
    v.concessionPaise === c.concession_paise &&
    v.concessionReason === c.concession_reason &&
    v.remarks === c.remarks
  )
}

/**
 * Programs a child attends, with their expected timings and fee agreements.
 * Timings and fees are versioned by date; nothing about a past day is ever overwritten
 * except when the owner explicitly fixes a mistake (which the change history records).
 */
export class EnrollmentsRepo {
  private readonly db: Database.Database

  constructor(private readonly w: Writer) {
    this.db = w.db
  }

  // ---------- Reading ----------

  defaults(): ProgramDefaults[] {
    const rows = this.db
      .prepare(
        `SELECT p.code, p.name, p.default_days, p.default_arrives, p.default_leaves,
                (SELECT f.standard_paise FROM fee_agreements f JOIN enrollments e ON e.id = f.enrollment_id
                 JOIN students s ON s.id = e.student_id
                 WHERE e.program_id = p.id AND f.deleted_at IS NULL AND e.deleted_at IS NULL AND s.deleted_at IS NULL
                 ORDER BY f.created_at DESC LIMIT 1) AS last_std
         FROM programs p WHERE p.deleted_at IS NULL ORDER BY p.sort_order`
      )
      .all() as {
      code: ProgramCode
      name: string
      default_days: number
      default_arrives: string
      default_leaves: string
      last_std: number | null
    }[]
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      days: r.default_days,
      arrives: r.default_arrives,
      leaves: r.default_leaves,
      lastStandardPaise: r.last_std
    }))
  }

  forStudent(studentId: string): EnrollmentView[] {
    const today = this.w.today()
    const rows = this.db
      .prepare(
        `SELECT e.id, e.student_id, p.code, p.sort_order, e.start_date, e.end_date, e.end_reason
         FROM enrollments e JOIN programs p ON p.id = e.program_id
         WHERE e.student_id = ? AND e.deleted_at IS NULL`
      )
      .all(studentId) as EnrollmentRow[]
    const views = rows.map((r) => this.view(r, today))
    const rank = (v: EnrollmentView) => (v.state === 'ended' ? 1 : 0)
    const order = new Map(rows.map((r) => [r.id, r.sort_order]))
    return views.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (rank(a) === 1 ? (b.endDate ?? '').localeCompare(a.endDate ?? '') : order.get(a.id)! - order.get(b.id)!)
    )
  }

  /** Programs each student is in now or about to start (for the students list). */
  openPrograms(studentIds: string[]): Map<string, ProgramCode[]> {
    const out = new Map<string, ProgramCode[]>(studentIds.map((id) => [id, []]))
    if (studentIds.length === 0) return out
    const rows = this.db
      .prepare(
        `SELECT e.student_id, p.code FROM enrollments e JOIN programs p ON p.id = e.program_id
         WHERE e.deleted_at IS NULL AND (e.end_date IS NULL OR e.end_date >= ?)
           AND e.student_id IN (SELECT value FROM json_each(?))
         ORDER BY p.sort_order`
      )
      .all(this.w.today(), JSON.stringify(studentIds)) as { student_id: string; code: ProgramCode }[]
    for (const r of rows) {
      const list = out.get(r.student_id)!
      if (!list.includes(r.code)) list.push(r.code)
    }
    return out
  }

  private view(r: EnrollmentRow, today: string): EnrollmentView {
    return {
      id: r.id,
      program: r.code,
      startDate: r.start_date,
      endDate: r.end_date,
      endReason: r.end_reason,
      state: enrollmentState(r.start_date, r.end_date, today),
      schedules: this.schedules(r.id),
      fees: this.fees(r.id)
    }
  }

  private schedules(enrollmentId: string): ScheduleVersion[] {
    return this.db
      .prepare(
        `SELECT id, effective_from AS effectiveFrom, days, arrives, leaves FROM schedules
         WHERE enrollment_id = ? AND deleted_at IS NULL ORDER BY effective_from`
      )
      .all(enrollmentId) as ScheduleVersion[]
  }

  private fees(enrollmentId: string): FeeVersion[] {
    return this.db
      .prepare(
        `SELECT id, effective_from AS effectiveFrom, frequency, custom_label AS customLabel,
                standard_paise AS standardPaise, concession_paise AS concessionPaise, agreed_paise AS agreedPaise,
                concession_reason AS concessionReason, remarks
         FROM fee_agreements WHERE enrollment_id = ? AND deleted_at IS NULL ORDER BY effective_from`
      )
      .all(enrollmentId) as (FeeVersion & { frequency: FeeFrequency })[]
  }

  // ---------- Adding ----------

  add(studentId: string, input: EnrollmentInput): string {
    const e = enrollmentInputSchema.parse(input)
    return this.w.transaction(() => this.insert(studentId, e))
  }

  /** Inserts a parsed enrollment. Call inside a transaction. */
  insert(studentId: string, e: Enrollment): string {
    const student = this.db
      .prepare('SELECT full_name, joining_date FROM students WHERE id = ? AND deleted_at IS NULL')
      .get(studentId) as { full_name: string; joining_date: string } | undefined
    if (!student) throw new UserError('This student could not be found. They may have been removed.')

    const programId = this.db.prepare('SELECT id FROM programs WHERE code = ?').pluck().get(e.program) as string
    const clash = this.db
      .prepare(
        `SELECT start_date, end_date FROM enrollments
         WHERE student_id = ? AND program_id = ? AND deleted_at IS NULL AND (end_date IS NULL OR end_date >= ?)`
      )
      .get(studentId, programId, e.startDate) as { start_date: string; end_date: string | null } | undefined
    if (clash) {
      const until = clash.end_date ? ` until ${formatDate(clash.end_date)}` : ''
      throw new UserError(`${student.full_name} is already in ${PROGRAM_NAME[e.program]}${until}.`)
    }

    const id = this.w.insert('enrollments', {
      student_id: studentId,
      program_id: programId,
      start_date: e.startDate,
      end_date: null,
      end_reason: ''
    })
    this.w.insert('schedules', { enrollment_id: id, effective_from: e.startDate, ...scheduleColumns(e.schedule) })
    this.w.insert('fee_agreements', { enrollment_id: id, effective_from: e.startDate, ...feeColumns(e.fee) })
    return id
  }

  // ---------- Editing ----------

  edit(enrollmentId: string, input: EnrollmentEditInput): void {
    const e = enrollmentEditSchema.parse(input)
    this.w.transaction(() => {
      const row = this.require(enrollmentId)
      const today = this.w.today()
      if (enrollmentState(row.start_date, row.end_date, today) === 'ended') {
        throw new UserError('This program has ended. Choose "Continue" first if the child is coming back.')
      }

      if (e.startDate !== row.start_date) this.moveStart(row, e.startDate)
      const start = e.startDate

      const schedules = this.schedules(enrollmentId)
      const fees = this.fees(enrollmentId)
      const lastSchedule = schedules.at(-1)!
      const lastFee = fees.at(-1)!
      const scheduleChanged = !sameSchedule(lastSchedule, e.schedule)
      const feeChanged = !sameFee(lastFee, e.fee)

      if (e.mode === 'fix') {
        if (scheduleChanged) this.w.update('schedules', lastSchedule.id, scheduleColumns(e.schedule))
        if (feeChanged) this.w.update('fee_agreements', lastFee.id, feeColumns(e.fee))
        return
      }

      const from = e.from
      if (from < start) throw new UserError(`The change can't start before the program started (${formatDate(start)}).`)
      if (row.end_date && from > row.end_date) {
        throw new UserError(`The change can't start after the program ends (${formatDate(row.end_date)}).`)
      }
      if (scheduleChanged) this.applyChange('schedules', enrollmentId, lastSchedule, from, scheduleColumns(e.schedule), 'timings')
      if (feeChanged) this.applyChange('fee_agreements', enrollmentId, lastFee, from, feeColumns(e.fee), 'fee')
    })
  }

  /** A change from `from`: same date as the latest version → corrected in place; later → a new version. */
  private applyChange(
    table: 'schedules' | 'fee_agreements',
    enrollmentId: string,
    last: { id: string; effectiveFrom: string },
    from: string,
    columns: Record<string, unknown>,
    what: string
  ) {
    if (from < last.effectiveFrom) {
      throw new UserError(
        `The ${what} already ${what === 'fee' ? 'changes' : 'change'} on ${formatDate(last.effectiveFrom)}. Choose that date or later, or fix that change instead.`
      )
    }
    if (from === last.effectiveFrom) this.w.update(table, last.id, columns)
    else this.w.insert(table, { enrollment_id: enrollmentId, effective_from: from, ...columns })
  }

  /** Changes the start date; the first timings and fee move with it. */
  private moveStart(row: EnrollmentRow, start: string) {
    if (row.end_date && start > row.end_date) {
      throw new UserError(`The start date can't be after the end date (${formatDate(row.end_date)}).`)
    }
    const joining = this.db.prepare('SELECT joining_date FROM students WHERE id = ?').pluck().get(row.student_id) as string
    if (start < joining) throw new UserError(`The start date can't be before the joining date (${formatDate(joining)}).`)
    for (const table of ['schedules', 'fee_agreements'] as const) {
      const versions = table === 'schedules' ? this.schedules(row.id) : this.fees(row.id)
      const second = versions[1]
      if (second && start >= second.effectiveFrom) {
        throw new UserError(
          `The start date must be before the change on ${formatDate(second.effectiveFrom)}. Move or fix that change first.`
        )
      }
      this.w.update(table, versions[0]!.id, { effective_from: start })
    }
    // Another stay in the same program must not overlap the new dates.
    const overlap = this.db
      .prepare(
        `SELECT 1 FROM enrollments WHERE student_id = ? AND program_id = (SELECT program_id FROM enrollments WHERE id = ?)
           AND id <> ? AND deleted_at IS NULL
           AND start_date <= coalesce(?, '9999-12-31') AND coalesce(end_date, '9999-12-31') >= ?`
      )
      .get(row.student_id, row.id, row.id, row.end_date, start)
    if (overlap) throw new UserError(`That start date overlaps an earlier time in ${PROGRAM_NAME[row.code]}.`)
    this.w.update('enrollments', row.id, { start_date: start })
  }

  end(enrollmentId: string, input: EndEnrollmentInput): void {
    const e = endEnrollmentSchema.parse(input)
    this.w.transaction(() => {
      const row = this.require(enrollmentId)
      if (e.endDate < row.start_date) {
        throw new UserError(`The last day can't be before the program started (${formatDate(row.start_date)}).`)
      }
      this.w.update('enrollments', enrollmentId, { end_date: e.endDate, end_reason: e.reason })
    })
  }

  /** Undoes "End": the child continues in the program. */
  resume(enrollmentId: string): void {
    this.w.transaction(() => {
      const row = this.require(enrollmentId)
      if (row.end_date === null) return
      const other = this.db
        .prepare(
          `SELECT 1 FROM enrollments WHERE student_id = ? AND program_id = (SELECT program_id FROM enrollments WHERE id = ?)
             AND id <> ? AND deleted_at IS NULL AND start_date > ?`
        )
        .get(row.student_id, row.id, row.id, row.end_date)
      if (other) {
        throw new UserError(`The child was added to ${PROGRAM_NAME[row.code]} again later. Edit that one instead.`)
      }
      this.w.update('enrollments', enrollmentId, { end_date: null, end_reason: '' })
    })
  }

  /** "Added by mistake": hides the program with its timings and fees. Nothing is erased. */
  remove(enrollmentId: string): void {
    this.w.transaction(() => {
      this.require(enrollmentId)
      // From step 4: refuse if any payment was recorded against this program.
      this.softDeleteWithVersions(enrollmentId)
    })
  }

  private softDeleteWithVersions(enrollmentId: string) {
    for (const s of this.schedules(enrollmentId)) this.w.softDelete('schedules', s.id)
    for (const f of this.fees(enrollmentId)) this.w.softDelete('fee_agreements', f.id)
    this.w.softDelete('enrollments', enrollmentId)
  }

  // ---------- Used by the Students module (inside its transactions) ----------

  /**
   * The child has left or graduated: programs still running end on `lastDay`;
   * programs that hadn't started yet are dropped.
   */
  endAllForStudent(studentId: string, lastDay: string, reason: string): void {
    const rows = this.db
      .prepare(
        `SELECT id, start_date, end_date FROM enrollments
         WHERE student_id = ? AND deleted_at IS NULL AND (end_date IS NULL OR end_date > ?)`
      )
      .all(studentId, lastDay) as { id: string; start_date: string; end_date: string | null }[]
    for (const r of rows) {
      if (r.start_date > lastDay) this.softDeleteWithVersions(r.id)
      else this.w.update('enrollments', r.id, { end_date: lastDay, end_reason: reason })
    }
  }

  removeAllForStudent(studentId: string): void {
    const ids = this.db
      .prepare('SELECT id FROM enrollments WHERE student_id = ? AND deleted_at IS NULL')
      .pluck()
      .all(studentId) as string[]
    for (const id of ids) this.softDeleteWithVersions(id)
  }

  private require(enrollmentId: string): EnrollmentRow {
    const row = this.db
      .prepare(
        `SELECT e.id, e.student_id, p.code, p.sort_order, e.start_date, e.end_date, e.end_reason
         FROM enrollments e JOIN programs p ON p.id = e.program_id
         JOIN students s ON s.id = e.student_id
         WHERE e.id = ? AND e.deleted_at IS NULL AND s.deleted_at IS NULL`
      )
      .get(enrollmentId) as EnrollmentRow | undefined
    if (!row) throw new UserError('This program could not be found. It may have been removed.')
    return row
  }
}
