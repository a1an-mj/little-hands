import Database from 'better-sqlite3'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  dayCounts,
  inOutText,
  replay,
  type AttendanceEvent,
  type SessionView
} from '@shared/attendance'
import { admissionSchema, type AdmissionInput } from '@shared/schemas'
import { AttendanceRepo } from '../../src/main/attendance/repo'
import { migrationsFromFiles, runMigrations } from '../../src/main/db/migrate'
import { Writer } from '../../src/main/db/writer'
import { StudentsRepo, UserError } from '../../src/main/students/repo'
import { lkgEnrollment, newFamilyAdmission } from './fixtures'

const ev = (id: string, kind: AttendanceEvent['kind'], at: string | null = null, extra: Partial<AttendanceEvent> = {}): AttendanceEvent => ({
  id,
  kind,
  at,
  note: '',
  voidsEventId: null,
  ...extra
})

describe('replaying a day', () => {
  it('no events: not marked', () => {
    expect(replay([]).status).toBe('none')
  })

  it('arrived, then left', () => {
    const s = replay([ev('a', 'arrived', '08:41'), ev('b', 'left', '12:35')])
    expect(s).toEqual({ status: 'out', arrived: '08:41', left: '12:35', note: '', lastEventId: 'b' })
    expect(inOutText(s)).toBe('In 8:41 AM · out 12:35 PM')
  })

  it('absent replaces an arrival, and an arrival replaces absent', () => {
    expect(replay([ev('a', 'arrived', '08:41'), ev('b', 'absent', null, { note: 'fever' })])).toMatchObject({ status: 'absent', arrived: null, note: 'fever' })
    expect(replay([ev('a', 'absent'), ev('b', 'arrived', '09:30')])).toMatchObject({ status: 'in', arrived: '09:30', note: '' })
  })

  it('a void cancels the event it points at; earlier events come back', () => {
    const events = [ev('a', 'arrived', '08:41'), ev('b', 'left', '12:35'), ev('v', 'void', null, { voidsEventId: 'b' })]
    expect(replay(events)).toEqual({ status: 'in', arrived: '08:41', left: null, note: '', lastEventId: 'a' })
    const all = [...events, ev('v2', 'void', null, { voidsEventId: 'a' })]
    expect(replay(all).status).toBe('none')
  })

  it('present without a time', () => {
    const s = replay([ev('a', 'arrived', null)])
    expect(s.status).toBe('in')
    expect(inOutText(s)).toBe('Present · out —')
  })
})

describe('day counts (per child)', () => {
  const s = (studentId: string, status: 'none' | 'in' | 'out' | 'absent'): SessionView => ({
    enrollmentId: studentId + status,
    studentId,
    studentName: studentId,
    studentCode: '',
    program: 'lk',
    expected: true,
    state: { status, arrived: null, left: null, note: '', lastEventId: null }
  })

  it('a child in LKG + Tuition counts once', () => {
    expect(dayCounts([s('a', 'out'), s('a', 'none'), s('b', 'absent'), s('c', 'none'), s('d', 'absent'), s('d', 'none')])).toEqual({
      expected: 4,
      arrived: 1,
      absent: 1,
      notYet: 2
    })
  })
})

// ---------- Repository ----------

const dir = join(__dirname, '../../src/main/db/migrations')
const migrations = migrationsFromFiles(
  Object.fromEntries(readdirSync(dir).map((f) => [`./migrations/${f}`, readFileSync(join(dir, f), 'utf8')]))
)

let db: Database.Database
let students: StudentsRepo
let repo: AttendanceRepo
let now: Date

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db, migrations)
  now = new Date(2026, 10, 2, 8, 41) // Monday 2 Nov 2026, 8:41 AM
  const w = new Writer(db, 'device-1', () => now)
  students = new StudentsRepo(w)
  repo = new AttendanceRepo(w)
})

const tuition = lkgEnrollment({ program: 'tu', schedule: { days: 21 } })
const admit = (overrides: Partial<AdmissionInput> = {}) => students.admit(admissionSchema.parse(newFamilyAdmission(overrides)), null)
const sessionsOf = (date: string) => repo.day(date).sessions
const enrollmentOf = (studentId: string, code: string) => students.profile(studentId)!.enrollments.find((e) => e.program === code)!.id
const at = (h: number, m: number) => {
  now = new Date(2026, 10, 2, h, m)
}

describe('who is expected', () => {
  it('uses each program’s days: LKG Mon–Fri, Tuition Mon/Wed/Fri', () => {
    const id = admit({ programs: [lkgEnrollment(), tuition] })
    expect(sessionsOf('2026-11-02').map((s) => [s.program, s.expected])).toEqual([
      ['lk', true],
      ['tu', true]
    ])
    expect(sessionsOf('2026-11-03').map((s) => s.program)).toEqual(['lk']) // Tuesday
    expect(sessionsOf('2026-11-01')).toEqual([]) // Sunday
    expect(sessionsOf('2026-11-02')[0]!.studentId).toBe(id)
  })

  it('sorted by name, then program', () => {
    admit({ fullName: 'Zara', programs: [lkgEnrollment(), tuition] })
    admit({ fullName: 'Anna', family: { ...newFamilyAdmission().family, father: { name: 'X', phone: '90000 00099' } } as never, programs: [tuition] })
    admit({ fullName: 'Bala', family: { ...newFamilyAdmission().family, father: { name: 'Y', phone: '90000 00098' } } as never, programs: [lkgEnrollment()] })
    expect(sessionsOf('2026-11-02').map((s) => [s.studentName, s.program])).toEqual([
      ['Anna', 'tu'],
      ['Bala', 'lk'],
      ['Zara', 'lk'],
      ['Zara', 'tu']
    ])
  })

  it('not before the start date or after the last day', () => {
    const id = admit({ joiningDate: '2026-06-01', programs: [lkgEnrollment({ startDate: '2026-11-04' })] })
    expect(sessionsOf('2026-11-03')).toEqual([])
    expect(sessionsOf('2026-11-04')).toHaveLength(1)
    students.enrollments.end(enrollmentOf(id, 'lk'), { endDate: '2026-11-04', reason: '' })
    expect(sessionsOf('2026-11-05')).toEqual([])
  })

  it('uses the days in force that day', () => {
    const id = admit()
    const e = students.profile(id)!.enrollments[0]!
    students.enrollments.edit(e.id, {
      mode: 'change',
      from: '2026-11-03',
      startDate: e.startDate,
      schedule: { days: 21 }, // Mon, Wed, Fri from Tue 3 Nov
      fee: { periodMonths: 1, dueDay: '3', standard: '1500', concession: '', concessionReason: '', remarks: '' }
    })
    expect(sessionsOf('2026-11-02')).toHaveLength(1) // Monday
    expect(sessionsOf('2026-11-03')).toHaveLength(0) // Tuesday: no longer one of the days
    expect(sessionsOf('2026-11-04')).toHaveLength(1) // Wednesday
  })
})

describe('marking from the dashboard', () => {
  it('arrived and left take the laptop’s time; undo brings back the previous state', () => {
    const id = admit()
    const lk = enrollmentOf(id, 'lk')
    repo.tap(lk, { kind: 'arrived' })
    at(12, 35)
    const left = repo.tap(lk, { kind: 'left' }).eventId
    expect(sessionsOf('2026-11-02')[0]!.state).toMatchObject({ status: 'out', arrived: '08:41', left: '12:35' })
    repo.undo(left)
    expect(sessionsOf('2026-11-02')[0]!.state).toMatchObject({ status: 'in', left: null })
    repo.undo(left) // twice is harmless
    expect(db.prepare(`SELECT count(*) FROM attendance_events WHERE kind = 'void'`).pluck().get()).toBe(1)
  })

  it('"Mark left" needs an arrival first', () => {
    const lk = enrollmentOf(admit(), 'lk')
    expect(() => repo.tap(lk, { kind: 'left' })).toThrow('Mark the arrival first')
  })

  it('absent with a reason', () => {
    const lk = enrollmentOf(admit(), 'lk')
    repo.tap(lk, { kind: 'absent', note: 'fever' })
    expect(sessionsOf('2026-11-02')[0]!.state).toMatchObject({ status: 'absent', note: 'fever' })
  })

  it('events are never updated or deleted, and do not fill the change history', () => {
    const lk = enrollmentOf(admit(), 'lk')
    const before = db.prepare('SELECT count(*) FROM audit_log').pluck().get()
    const a = repo.tap(lk, { kind: 'arrived' })
    expect(a.at).toBe('08:41')
    repo.undo(a.eventId)
    repo.tap(lk, { kind: 'absent' })
    expect(db.prepare('SELECT count(*) FROM audit_log').pluck().get()).toBe(before)
    const rows = db.prepare('SELECT kind, created_at = updated_at AS same FROM attendance_events ORDER BY rowid').all()
    expect(rows).toEqual([
      { kind: 'arrived', same: 1 },
      { kind: 'void', same: 1 },
      { kind: 'absent', same: 1 }
    ])
  })
})

describe('setting a day (attendance screen and corrections)', () => {
  it('present without a time, absent, then cleared', () => {
    const lk = enrollmentOf(admit(), 'lk')
    repo.setMany('2026-11-02', [{ enrollmentId: lk, day: { status: 'present' } }])
    expect(sessionsOf('2026-11-02')[0]!.state).toMatchObject({ status: 'in', arrived: null })
    repo.setDay(lk, '2026-11-02', { status: 'absent', note: 'fever' })
    expect(sessionsOf('2026-11-02')[0]!.state).toMatchObject({ status: 'absent', note: 'fever' })
    repo.setDay(lk, '2026-11-02', { status: 'none' })
    expect(sessionsOf('2026-11-02')[0]!.state.status).toBe('none')
  })

  it('saving the same thing again records nothing', () => {
    const lk = enrollmentOf(admit(), 'lk')
    repo.setDay(lk, '2026-11-02', { status: 'present', arrived: '08:50', left: '12:35' })
    const n = db.prepare('SELECT count(*) FROM attendance_events').pluck().get()
    repo.setDay(lk, '2026-11-02', { status: 'present', arrived: '08:50', left: '12:35' })
    expect(db.prepare('SELECT count(*) FROM attendance_events').pluck().get()).toBe(n)
  })

  it('corrects a past day; refuses future days and days outside the program', () => {
    const lk = enrollmentOf(admit({ joiningDate: '2026-10-01', programs: [lkgEnrollment({ startDate: '2026-10-01' })] }), 'lk')
    repo.setDay(lk, '2026-10-30', { status: 'present', arrived: '08:50', left: '12:35' })
    expect(repo.day('2026-10-30').sessions[0]!.state).toMatchObject({ arrived: '08:50', left: '12:35' })
    expect(() => repo.setDay(lk, '2026-11-03', { status: 'present' })).toThrow("Attendance can't be marked for a future day")
    expect(() => repo.setDay(lk, '2026-09-30', { status: 'present' })).toThrow(UserError)
  })

  it('leaving time must be after arrival', () => {
    const lk = enrollmentOf(admit(), 'lk')
    expect(() => repo.setDay(lk, '2026-11-02', { status: 'present', arrived: '12:00', left: '09:00' })).toThrow('Leaving time must be after arrival')
  })

  it('a child marked on a day they were not expected still shows that day', () => {
    const id = admit({ programs: [tuition] })
    repo.setDay(enrollmentOf(id, 'tu'), '2026-10-27', { status: 'present', arrived: '16:05' }) // a Tuesday
    expect(repo.day('2026-10-27').sessions).toMatchObject([{ program: 'tu', expected: false, state: { arrived: '16:05' } }])
  })
})

describe('history and summary', () => {
  it('last school days per program, newest first, with what happened', () => {
    const id = admit({ joiningDate: '2026-10-26', programs: [lkgEnrollment({ startDate: '2026-10-26' }), { ...tuition, startDate: '2026-10-26' }] })
    const lk = enrollmentOf(id, 'lk')
    repo.setDay(lk, '2026-10-30', { status: 'present', arrived: '08:50', left: '12:35' })
    repo.setDay(lk, '2026-10-28', { status: 'absent', note: 'fever' })
    const h = repo.history(id)
    const lkg = h.programs.find((p) => p.program === 'lk')!
    expect(lkg.days.map((d) => [d.date, d.state.status])).toEqual([
      ['2026-11-02', 'none'],
      ['2026-10-30', 'out'],
      ['2026-10-29', 'none'],
      ['2026-10-28', 'absent'],
      ['2026-10-27', 'none'],
      ['2026-10-26', 'none']
    ])
    expect(h.programs.find((p) => p.program === 'tu')!.days.map((d) => d.date)).toEqual(['2026-11-02', '2026-10-30', '2026-10-28', '2026-10-26'])
  })

  it('dashboard figures', () => {
    admit({ programs: [lkgEnrollment(), tuition] })
    admit({ fullName: 'Dev Krishna', joiningDate: '2026-10-12', family: { ...newFamilyAdmission().family, father: { name: 'K', phone: '90000 00061' } } as never, programs: [lkgEnrollment({ startDate: '2026-10-12' })] })
    const s = repo.summary()
    expect(s.activeStudents).toBe(2)
    expect(s.kgAndTuition).toBe(1)
    expect(s.byProgram).toEqual({ pg: 0, nu: 0, lk: 2, uk: 0, dc: 0, tu: 1 })
    expect(s.recentAdmissions.map((r) => [r.fullName, r.programs])).toEqual([
      ['Dev Krishna', ['lk']],
      ['Aadhya Menon', ['lk', 'tu']]
    ])
  })
})

describe('school closed days', () => {
  it('a closed day has a reason, can be opened again, and shows in the history', () => {
    const id = admit({ joiningDate: '2026-10-26', programs: [lkgEnrollment({ startDate: '2026-10-26' })] })
    repo.closeDay('2026-10-28', { reason: 'Strike' })
    expect(repo.day('2026-10-28').closed).toEqual({ reason: 'Strike' })
    expect(repo.day('2026-10-27').closed).toBeNull()
    const lkg = repo.history(id).programs[0]!
    expect(lkg.days.find((d) => d.date === '2026-10-28')!.closed).toEqual({ reason: 'Strike' })

    repo.closeDay('2026-10-28', { reason: 'Hartal' }) // closing again just changes the reason
    expect(repo.day('2026-10-28').closed).toEqual({ reason: 'Hartal' })
    repo.reopenDay('2026-10-28')
    expect(repo.day('2026-10-28').closed).toBeNull()
    repo.closeDay('2026-10-28', {})
    expect(repo.day('2026-10-28').closed).toEqual({ reason: '' })
    // Every change is in the change history.
    expect(db.prepare(`SELECT action FROM audit_log WHERE table_name = 'closed_days' ORDER BY rowid`).pluck().all()).toEqual([
      'insert',
      'update',
      'delete',
      'insert'
    ])
  })
})

describe('Nursery and Daycare', () => {
  it('Nursery is a kindergarten class; Daycare and Tuition are add-ons', async () => {
    const { isKindergarten } = await import('@shared/enrollments')
    expect(['pg', 'nu', 'lk', 'uk', 'dc', 'tu'].filter((c) => isKindergarten(c as never))).toEqual(['pg', 'nu', 'lk', 'uk'])
  })

  it('a child can be in Nursery and Daycare, each with their own days', () => {
    const id = admit({
      programs: [
        lkgEnrollment({ program: 'nu', schedule: { days: 31 } }),
        lkgEnrollment({ program: 'dc', schedule: { days: 21 } })
      ]
    })
    expect(sessionsOf('2026-11-02').map((s) => s.program)).toEqual(['nu', 'dc'])
    expect(repo.summary().byProgram).toMatchObject({ nu: 1, dc: 1 })
    expect(students.profile(id)!.enrollments.map((e) => e.program)).toEqual(['nu', 'dc'])
  })
})
