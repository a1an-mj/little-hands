import Database from 'better-sqlite3'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrationsFromFiles, runMigrations } from '../../src/main/db/migrate'
import { Writer } from '../../src/main/db/writer'
import { StudentsRepo, UserError } from '../../src/main/students/repo'
import type { EnrollmentsRepo } from '../../src/main/enrollments/repo'
import { admissionSchema, type AdmissionInput, type EnrollmentEditInput } from '@shared/schemas'
import { lkgEnrollment, newFamilyAdmission } from './fixtures'

const dir = join(__dirname, '../../src/main/db/migrations')
const migrations = migrationsFromFiles(
  Object.fromEntries(readdirSync(dir).map((f) => [`./migrations/${f}`, readFileSync(join(dir, f), 'utf8')]))
)

let db: Database.Database
let students: StudentsRepo
let repo: EnrollmentsRepo
/** The laptop's "today" for these tests. */
let today: Date

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db, migrations)
  today = new Date(2026, 10, 2, 10, 0) // Monday 2 Nov 2026, 10:00 local time
  students = new StudentsRepo(new Writer(db, 'device-1', () => today))
  repo = students.enrollments
})

const admit = (overrides: Partial<AdmissionInput> = {}) => students.admit(admissionSchema.parse(newFamilyAdmission(overrides)), null)
const enrollments = (studentId: string) => students.profile(studentId)!.enrollments
const tuition = lkgEnrollment({
  program: 'tu',
  schedule: { days: 21 },
  fee: { periodMonths: 1, dueDay: '3', standard: '1000', concession: '200', concessionReason: 'Sibling', remarks: '' }
})
const edit = (id: string, patch: Partial<EnrollmentEditInput>): EnrollmentEditInput => {
  const e = repo.forStudent(db.prepare('SELECT student_id FROM enrollments WHERE id = ?').pluck().get(id) as string).find((x) => x.id === id)!
  const s = e.schedules.at(-1)!
  const f = e.fees.at(-1)!
  return {
    startDate: e.startDate,
    schedule: { days: s.days },
    fee: {
      periodMonths: f.periodMonths,
      dueDay: String(f.dueDay),
      standard: String(f.standardPaise / 100),
      concession: String(f.concessionPaise / 100),
      concessionReason: f.concessionReason,
      remarks: f.remarks
    },
    mode: 'change',
    from: '2026-11-02',
    ...patch
  }
}

describe('programs', () => {
  it('has the programs and extras with fixed IDs and default days', () => {
    const d = repo.defaults()
    expect(d.map((p) => p.name)).toEqual(['Playgroup', 'Nursery', 'LKG', 'UKG', 'Daycare', 'Tuition', 'Karate', 'Dance', 'Transport'])
    expect(d.find((p) => p.code === 'tr')).toMatchObject({ days: 0 }) // extras: no days
    expect(d.find((p) => p.code === 'nu')).toMatchObject({ days: 31 })
    expect(d.find((p) => p.code === 'tu')).toMatchObject({ days: 21, lastStandardPaise: null })
    expect(db.prepare("SELECT id FROM programs WHERE code = 'lk'").pluck().get()).toBe('5a0e6b1c-3f4d-4c2a-9b7e-1d2c3a4b5c02')
  })

  it('pre-fills the fee with the one most recently agreed for that program', () => {
    admit()
    today = new Date(2026, 10, 3)
    admit({ fullName: 'Dev', programs: [lkgEnrollment({ fee: { ...lkgEnrollment().fee, standard: '1600' } })] })
    expect(repo.defaults().find((p) => p.code === 'lk')!.lastStandardPaise).toBe(160000)
  })
})

describe('admission with programs', () => {
  it('saves each program with its own days and fee', () => {
    const id = admit({ programs: [lkgEnrollment(), tuition] })
    const [lkg, tu] = enrollments(id)
    expect(lkg).toMatchObject({ program: 'lk', startDate: '2026-06-03', endDate: null, state: 'current' })
    expect(lkg!.schedules).toEqual([expect.objectContaining({ effectiveFrom: '2026-06-03', days: 31 })])
    // No times are stored any more.
    expect(db.prepare('SELECT arrives, leaves FROM schedules').get()).toEqual({ arrives: null, leaves: null })
    expect(lkg!.fees[0]).toMatchObject({ periodMonths: 1, dueDay: 3, standardPaise: 150000, concessionPaise: 0, agreedPaise: 150000 })
    expect(tu!.fees[0]).toMatchObject({ standardPaise: 100000, concessionPaise: 20000, agreedPaise: 80000, concessionReason: 'Sibling' })
    expect(students.list({ search: '', status: 'active', page: 0 }).rows[0]!.programs).toEqual(['lk', 'tu'])
  })

  it('needs at least one program', () => {
    expect(admissionSchema.safeParse(newFamilyAdmission({ programs: [] })).success).toBe(false)
  })

  it("won't start a program before the child joins", () => {
    const r = admissionSchema.safeParse(newFamilyAdmission({ programs: [lkgEnrollment({ startDate: '2026-06-01' })] }))
    expect(r.success ? null : r.error.issues[0]).toMatchObject({ path: ['programs', 0, 'startDate'] })
  })

  it('saves nothing when a program is refused', () => {
    expect(() => admit({ programs: [lkgEnrollment(), lkgEnrollment()] })).toThrow()
    expect(db.prepare('SELECT count(*) FROM students').pluck().get()).toBe(0)
  })

  it('the database itself refuses bad fees and days', () => {
    const id = admit()
    const eid = enrollments(id)[0]!.id
    const sync = `'2026-01-01', '2026-01-01', 'x'`
    const fee = (std: number, conc: number, reason = '') => () =>
      db.prepare(
        `INSERT INTO fee_agreements (id, enrollment_id, effective_from, period_months, due_day, standard_paise, concession_paise, concession_reason, created_at, updated_at, device_id)
         VALUES (lower(hex(randomblob(16))), ?, '2027-01-01', 1, 10, ?, ?, ?, ${sync})`
      ).run(eid, std, conc, reason)
    const schedule = (days: number) => () =>
      db.prepare(
        `INSERT INTO schedules (id, enrollment_id, effective_from, days, created_at, updated_at, device_id)
         VALUES (lower(hex(randomblob(16))), ?, '2027-01-01', ?, ${sync})`
      ).run(eid, days)
    expect(fee(100, 200, 'x')).toThrow(/CHECK/) // concession more than the fee
    expect(fee(200, 100)).toThrow(/CHECK/) // concession without a reason
    expect(fee(-1, 0)).toThrow(/CHECK/)
    expect(() =>
      db.prepare(
        `INSERT INTO fee_agreements (id, enrollment_id, effective_from, period_months, due_day, standard_paise, created_at, updated_at, device_id)
         VALUES ('z', ?, '2028-01-01', 1, 32, 100, ${sync})`
      ).run(eid)
    ).toThrow(/CHECK/) // no 32nd day
    expect(schedule(0)).toThrow(/CHECK/)
    expect(schedule(128)).toThrow(/CHECK/)
    fee(200, 100, 'Sibling')()
    expect(db.prepare("SELECT agreed_paise FROM fee_agreements WHERE effective_from = '2027-01-01'").pluck().get()).toBe(100)
  })
})

describe('adding a program later', () => {
  it('adds Tuition alongside LKG', () => {
    const id = admit()
    repo.add(id, { ...tuition, startDate: '2026-11-02' })
    expect(enrollments(id).map((e) => e.program)).toEqual(['lk', 'tu'])
  })

  it("won't put a child in the same program twice at once", () => {
    const id = admit()
    expect(() => repo.add(id, lkgEnrollment({ startDate: '2026-11-02' }))).toThrow(new UserError('Aadhya Menon is already in LKG.'))
  })

  it('allows the same program again after the earlier one ended', () => {
    const id = admit()
    const lkg = enrollments(id)[0]!.id
    repo.end(lkg, { endDate: '2026-08-31', reason: 'Went abroad' })
    expect(() => repo.add(id, lkgEnrollment({ startDate: '2026-08-15' }))).toThrow(/already in LKG until 31 Aug 2026/)
    repo.add(id, lkgEnrollment({ startDate: '2026-10-01' }))
    expect(enrollments(id).map((e) => [e.program, e.state])).toEqual([['lk', 'current'], ['lk', 'ended']])
  })
})

describe('changing days and fees', () => {
  it('a change from a date keeps the old version', () => {
    const id = admit()
    const lkg = enrollments(id)[0]!.id
    repo.edit(lkg, edit(lkg, { from: '2026-12-01', fee: { ...edit(lkg, {}).fee, standard: '1800' } }))
    const e = enrollments(id)[0]!
    expect(e.fees.map((f) => [f.effectiveFrom, f.standardPaise])).toEqual([['2026-06-03', 150000], ['2026-12-01', 180000]])
    expect(e.schedules).toHaveLength(1) // days didn't change, so no new version
  })

  it('a fix corrects the current version in place, and the history records it', () => {
    const id = admit()
    const lkg = enrollments(id)[0]!.id
    repo.edit(lkg, edit(lkg, { mode: 'fix', schedule: { days: 21 } }))
    const e = enrollments(id)[0]!
    expect(e.schedules).toEqual([expect.objectContaining({ effectiveFrom: '2026-06-03', days: 21 })])
    const last = db.prepare("SELECT action, changes FROM audit_log WHERE table_name = 'schedules' ORDER BY rowid DESC LIMIT 1").get() as { action: string; changes: string }
    expect(last.action).toBe('update')
    expect(JSON.parse(last.changes)).toEqual({ days: [31, 21] })
  })

  it('a change on the same date as the latest version replaces it', () => {
    const id = admit()
    const lkg = enrollments(id)[0]!.id
    repo.edit(lkg, edit(lkg, { from: '2026-12-01', fee: { ...edit(lkg, {}).fee, standard: '1800' } }))
    repo.edit(lkg, edit(lkg, { from: '2026-12-01', fee: { ...edit(lkg, {}).fee, standard: '1700' } }))
    expect(enrollments(id)[0]!.fees.map((f) => f.standardPaise)).toEqual([150000, 170000])
  })

  it("won't slip a change in before a later one, or before the program started", () => {
    const id = admit()
    const lkg = enrollments(id)[0]!.id
    repo.edit(lkg, edit(lkg, { from: '2026-12-01', fee: { ...edit(lkg, {}).fee, standard: '1800' } }))
    expect(() => repo.edit(lkg, edit(lkg, { from: '2026-11-15', fee: { ...edit(lkg, {}).fee, standard: '1900' } }))).toThrow(
      'The fee already changes on 1 Dec 2026. Choose that date or later, or fix that change instead.'
    )
    expect(() => repo.edit(lkg, edit(lkg, { from: '2026-01-01', schedule: { days: 1 } }))).toThrow(
      /before the program started \(3 Jun 2026\)/
    )
  })

  it('moving the start date moves the first days and fee with it', () => {
    const id = admit()
    const lkg = enrollments(id)[0]!.id
    repo.edit(lkg, edit(lkg, { startDate: '2026-06-10', mode: 'fix' }))
    const e = enrollments(id)[0]!
    expect([e.startDate, e.schedules[0]!.effectiveFrom, e.fees[0]!.effectiveFrom]).toEqual(['2026-06-10', '2026-06-10', '2026-06-10'])
    expect(() => repo.edit(lkg, edit(lkg, { startDate: '2026-06-01', mode: 'fix' }))).toThrow(/before the joining date/)
  })

  it('switching to every 3 months, due on the 5th, with a concession', () => {
    const id = admit()
    const lkg = enrollments(id)[0]!.id
    repo.edit(lkg, edit(lkg, { mode: 'fix', fee: { periodMonths: 3, dueDay: '5', standard: '4,500', concession: '500', concessionReason: 'Staff family', remarks: 'Paid by cheque' } }))
    expect(enrollments(id)[0]!.fees[0]).toMatchObject({ periodMonths: 3, dueDay: 5, agreedPaise: 400000, remarks: 'Paid by cheque' })
  })

  it('changing only the due day from a date adds a new fee version', () => {
    const id = admit()
    const lkg = enrollments(id)[0]!.id
    repo.edit(lkg, edit(lkg, { from: '2026-12-01', fee: { ...edit(lkg, {}).fee, dueDay: '10' } }))
    expect(enrollments(id)[0]!.fees.map((f) => [f.effectiveFrom, f.dueDay])).toEqual([['2026-06-03', 3], ['2026-12-01', 10]])
  })
})

describe('ending a program', () => {
  it('ends, can be continued again, and can be removed if added by mistake', () => {
    const id = admit({ programs: [lkgEnrollment(), tuition] })
    const tu = enrollments(id)[1]!.id
    repo.end(tu, { endDate: '2026-10-31', reason: 'Exams over' })
    expect(enrollments(id)[1]).toMatchObject({ program: 'tu', state: 'ended', endDate: '2026-10-31', endReason: 'Exams over' })
    expect(students.list({ search: '', status: 'active', page: 0 }).rows[0]!.programs).toEqual(['lk'])
    expect(() => repo.edit(tu, edit(tu, {}))).toThrow(/has ended/)

    repo.resume(tu)
    expect(enrollments(id)[1]).toMatchObject({ state: 'current', endDate: null, endReason: '' })

    repo.remove(tu)
    expect(enrollments(id).map((e) => e.program)).toEqual(['lk'])
    expect(db.prepare('SELECT count(*) FROM fee_agreements WHERE deleted_at IS NULL').pluck().get()).toBe(1)
  })

  it("can't end before it started", () => {
    const id = admit()
    expect(() => repo.end(enrollments(id)[0]!.id, { endDate: '2026-06-01', reason: '' })).toThrow(/before the program started/)
  })

  it('graduating ends running programs today and drops ones not started yet', () => {
    const id = admit()
    repo.add(id, { ...tuition, startDate: '2026-12-01' })
    expect(enrollments(id).map((e) => e.state)).toEqual(['current', 'upcoming'])
    students.updateDetails(id, { fullName: 'Aadhya Menon', joiningDate: '2026-06-03', status: 'graduated', homeAddress: '' })
    expect(enrollments(id)).toEqual([expect.objectContaining({ program: 'lk', endDate: '2026-11-02', endReason: 'Marked graduated' })])
  })

  it("won't move the joining date after the first program starts", () => {
    const id = admit()
    expect(() =>
      students.updateDetails(id, { fullName: 'Aadhya Menon', joiningDate: '2026-07-01', status: 'active', homeAddress: '' })
    ).toThrow(/after the first program starts \(3 Jun 2026\)/)
  })
})

describe('students list by program', () => {
  it('filters to children currently in a program', () => {
    admit({ fullName: 'Aadhya', programs: [lkgEnrollment(), tuition] })
    admit({ fullName: 'Arjun', programs: [lkgEnrollment({ program: 'uk' })] })
    const names = (program: 'all' | 'lk' | 'uk' | 'tu' | 'pg') =>
      students.list({ search: '', status: 'active', program, page: 0 }).rows.map((r) => r.fullName)
    expect(names('all')).toEqual(['Aadhya', 'Arjun'])
    expect(names('tu')).toEqual(['Aadhya'])
    expect(names('uk')).toEqual(['Arjun'])
    expect(names('pg')).toEqual([])
    expect(students.list({ search: '', status: 'active', program: 'tu', page: 0 }).total).toBe(1)
  })

  it('removing a student hides their programs too', () => {
    const id = admit()
    students.remove(id)
    expect(db.prepare('SELECT count(*) FROM enrollments WHERE deleted_at IS NULL').pluck().get()).toBe(0)
    expect(repo.defaults().find((p) => p.code === 'lk')!.lastStandardPaise).toBeNull()
  })
})

describe('migration 004: fee periods and due day', () => {
  it('converts fees saved before: monthly stays monthly, term and custom become every 3 months', () => {
    const old = new Database(':memory:')
    old.pragma('foreign_keys = ON')
    runMigrations(old, migrations.slice(0, 3))
    const w = new Writer(old, 'device-1', () => today)
    const s = w.insert('students', { student_code: 'LH-2026-001', code_year: 2026, code_seq: 1, full_name: 'A', joining_date: '2026-06-03', status: 'active', home_address: '' })
    const e = w.insert('enrollments', { student_id: s, program_id: '5a0e6b1c-3f4d-4c2a-9b7e-1d2c3a4b5c02', start_date: '2026-06-03', end_date: null, end_reason: '' })
    w.insert('schedules', { enrollment_id: e, effective_from: '2026-06-03', days: 31, arrives: '08:45', leaves: '12:30' })
    const fee = (from: string, frequency: string, label = '', remarks = '') =>
      old
        .prepare(
          `INSERT INTO fee_agreements (id, enrollment_id, effective_from, frequency, custom_label, standard_paise, remarks, created_at, updated_at, device_id)
           VALUES (?, ?, ?, ?, ?, 150000, ?, 'x', 'x', 'x')`
        )
        .run(from, e, from, frequency, label, remarks)
    fee('2026-06-03', 'monthly')
    fee('2026-09-15', 'term')
    fee('2026-12-01', 'custom', 'Every 2 months', 'Cash only')

    runMigrations(old, migrations)
    const rows = old.prepare('SELECT effective_from, period_months, due_day, agreed_paise, remarks FROM fee_agreements ORDER BY effective_from').all()
    // Migration 006 rebuilt the programs table: the enrollment still points at LKG.
    expect(old.prepare('SELECT p.code FROM enrollments e JOIN programs p ON p.id = e.program_id').pluck().get()).toBe('lk')
    expect(old.pragma('foreign_key_check')).toEqual([])
    // Migration 007: days kept, old times kept in the history, new rows need no times.
    expect(old.prepare('SELECT days, arrives FROM schedules').get()).toEqual({ days: 31, arrives: '08:45' })
    expect(rows).toEqual([
      { effective_from: '2026-06-03', period_months: 1, due_day: 3, agreed_paise: 150000, remarks: '' },
      { effective_from: '2026-09-15', period_months: 3, due_day: 15, agreed_paise: 150000, remarks: '' },
      { effective_from: '2026-12-01', period_months: 3, due_day: 1, agreed_paise: 150000, remarks: 'Cash only (Was: Every 2 months)' }
    ])
  })
})
