import Database from 'better-sqlite3'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrationsFromFiles, runMigrations } from '../../src/main/db/migrate'
import { Writer } from '../../src/main/db/writer'
import { AttendanceRepo } from '../../src/main/attendance/repo'
import { PlannerRepo } from '../../src/main/planner/repo'
import { StudentsRepo } from '../../src/main/students/repo'
import { addMonths, birthdayIn, dueText, monthGrid, todoGroup } from '@shared/planner'
import { admissionSchema } from '@shared/schemas'
import { newFamilyAdmission } from './fixtures'

const dir = join(__dirname, '../../src/main/db/migrations')
const migrations = migrationsFromFiles(Object.fromEntries(readdirSync(dir).map((f) => [`./migrations/${f}`, readFileSync(join(dir, f), 'utf8')])))

let db: Database.Database
let planner: PlannerRepo
let students: StudentsRepo
let attendance: AttendanceRepo

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db, migrations)
  // The laptop's clock: Saturday 21 Nov 2026, 10:00.
  const w = new Writer(db, 'device-1', () => new Date(2026, 10, 21, 10, 0))
  planner = new PlannerRepo(w)
  students = new StudentsRepo(w)
  attendance = new AttendanceRepo(w)
})

const closedDays = () => db.prepare('SELECT date, reason FROM closed_days WHERE deleted_at IS NULL ORDER BY date').all()
const event = (over: Record<string, string> = {}) => ({ title: "Parents' meeting", date: '2026-11-25', time: '16:00', kind: 'meeting' as const, notes: '', ...over })

describe('helpers', () => {
  it('a month grid starts on the Monday before the 1st and has 6 weeks', () => {
    const g = monthGrid('2026-11') // 1 Nov 2026 is a Sunday
    expect(g[0]).toBe('2026-10-26')
    expect(g[6]).toBe('2026-11-01')
    expect(g).toHaveLength(42)
  })
  it('moves between months across years', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
  })
  it('29 Feb birthdays fall on 28 Feb outside leap years', () => {
    expect(birthdayIn('2020-02-29', 2027)).toBe('2027-02-28')
    expect(birthdayIn('2020-02-29', 2028)).toBe('2028-02-29')
  })
  it('groups to-dos and says how late they are', () => {
    expect(todoGroup({ dueDate: '2026-11-19' }, '2026-11-21')).toBe('overdue')
    expect(todoGroup({ dueDate: '2026-11-21' }, '2026-11-21')).toBe('today')
    expect(todoGroup({ dueDate: null }, '2026-11-21')).toBe('nodate')
    expect(dueText('2026-11-19', '2026-11-21')).toBe('2 days late')
    expect(dueText('2026-11-22', '2026-11-21')).toBe('Due tomorrow')
  })
})

describe('calendar', () => {
  it('shows events, closed days, birthdays and dated to-dos for the month', () => {
    planner.addEvent(event())
    attendance.closeDay('2026-11-14', { reason: "Children's Day" })
    students.admit(admissionSchema.parse(newFamilyAdmission({ fullName: 'Mayukh Adiyodi', dateOfBirth: '2018-11-30', joiningDate: '2026-06-01' })), null)
    planner.addTodo({ title: 'Order crayons', dueDate: '2026-11-27' })
    planner.addTodo({ title: 'No date', dueDate: '' })
    planner.addTodo({ title: 'Next month', dueDate: '2026-12-02' })

    const m = planner.month('2026-11')
    expect(m.today).toBe('2026-11-21')
    expect(m.items.map((i) => [i.kind, i.date, i.title])).toEqual([
      ['meeting', '2026-11-25', "Parents' meeting"],
      ['closed', '2026-11-14', "School closed · Children's Day"],
      ['birthday', '2026-11-30', 'Mayukh Adiyodi turns 8'],
      ['todo', '2026-11-27', 'Order crayons']
    ])
  })

  it('a holiday closes the school; moving or removing it opens the day again', () => {
    const id = planner.addEvent(event({ title: 'Christmas', date: '2026-12-25', time: '', kind: 'holiday' }))
    expect(closedDays()).toEqual([{ date: '2026-12-25', reason: 'Christmas' }])
    expect(planner.month('2026-12').items.map((i) => i.kind)).toEqual(['holiday']) // not shown twice

    planner.updateEvent(id, event({ title: 'Christmas', date: '2026-12-24', time: '', kind: 'holiday' }))
    expect(closedDays()).toEqual([{ date: '2026-12-24', reason: 'Christmas' }])

    planner.updateEvent(id, event({ title: 'Christmas party', date: '2026-12-24', time: '', kind: 'event' }))
    expect(closedDays()).toEqual([])

    planner.updateEvent(id, event({ title: 'Christmas', date: '2026-12-25', time: '', kind: 'holiday' }))
    planner.removeEvent(id)
    expect(closedDays()).toEqual([])
    expect(planner.month('2026-12').items).toEqual([])
  })

  it('two holidays on one day: removing one keeps the school closed', () => {
    const a = planner.addEvent(event({ title: 'Onam', date: '2027-08-25', time: '', kind: 'holiday' }))
    planner.addEvent(event({ title: 'Local holiday', date: '2027-08-25', time: '', kind: 'holiday' }))
    planner.removeEvent(a)
    expect(closedDays()).toHaveLength(1)
  })

  it('checks what is typed', () => {
    expect(() => planner.addEvent(event({ title: '  ' }))).toThrow('Enter a title')
    expect(() => planner.addEvent(event({ time: '25:00' }))).toThrow('Choose a time')
    expect(() => planner.month('2026-13')).toThrow('Choose a month')
  })
})

describe('to-do list', () => {
  it('lists open tasks by due date (undated last), ticks them done and back', () => {
    const later = planner.addTodo({ title: 'Later', dueDate: '2026-12-01' })
    planner.addTodo({ title: 'Undated' })
    const late = planner.addTodo({ title: 'Late', dueDate: '2026-11-19' })
    expect(planner.todos().open.map((t) => t.title)).toEqual(['Late', 'Later', 'Undated'])

    planner.setDone(late, true)
    const l = planner.todos()
    expect(l.open.map((t) => t.title)).toEqual(['Later', 'Undated'])
    expect(l.done.map((t) => t.title)).toEqual(['Late'])
    expect(l.done[0]!.doneAt).not.toBeNull()

    planner.setDone(late, false)
    expect(planner.todos().done).toEqual([])
    planner.removeTodo(later)
    expect(planner.todos().open.map((t) => t.title)).toEqual(['Late', 'Undated'])
  })

  it("links a to-do to a child and lists it on the child's profile", () => {
    const kid = students.admit(admissionSchema.parse(newFamilyAdmission({ fullName: 'Shristi Sethi' })), null)
    const id = planner.addTodo({ title: "Get the mother's full phone number", studentId: kid })
    expect(planner.todosFor(kid).map((t) => [t.title, t.studentName])).toEqual([["Get the mother's full phone number", 'Shristi Sethi']])
    planner.updateTodo(id, { title: 'Phone number', studentId: null })
    expect(planner.todosFor(kid)).toEqual([])
    expect(() => planner.addTodo({ title: 'x', studentId: '00000000-0000-4000-8000-000000000000' })).toThrow('That child could not be found.')
    expect(() => planner.addTodo({ title: '' })).toThrow('Enter what needs doing')
  })

  it('keeps a change history of to-do edits', () => {
    const id = planner.addTodo({ title: 'A' })
    planner.updateTodo(id, { title: 'B' })
    const rows = db.prepare(`SELECT action FROM audit_log WHERE table_name = 'todos' ORDER BY rowid`).pluck().all()
    expect(rows).toEqual(['insert', 'update'])
  })
})
