import Database from 'better-sqlite3'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrationsFromFiles, runMigrations } from '../../src/main/db/migrate'
import { Writer } from '../../src/main/db/writer'
import { PlannerRepo } from '../../src/main/planner/repo'
import { runImport } from '../../src/main/students/import'
import { StudentsRepo } from '../../src/main/students/repo'
import { clean, firstPhone, parseCsv, planImport, programsOf } from '@shared/import'

const HEADER =
  "No,Photo file,Form heading (top),Enrolment no,Joining date,Child's name,Date of birth,Age on form,Class (as written),Other school,Address," +
  "Father's name,Father's occupation,Father's phone,Mother's name,Mother's occupation,Mother's phone,Emergency contact,Courses ticked,Fees due by (on form),Check"

type Row = Partial<Record<'heading' | 'joining' | 'name' | 'dob' | 'cls' | 'school' | 'address' | 'father' | 'fPhone' | 'mother' | 'mPhone' | 'emergency' | 'courses' | 'due' | 'check', string>>
const q = (s: string) => `"${s.replace(/"/g, '""')}"`
function csv(...rows: Row[]): string {
  return [
    '﻿' + HEADER,
    ...rows.map((r, i) =>
      [i + 1, 'p.jpg', r.heading ?? '', 'LHL-01', r.joining ?? '2026-06-03', r.name ?? `Child ${i + 1}`, r.dob ?? '2021-10-26', '4', r.cls ?? '', r.school ?? '', r.address ?? 'Flat 4B, Thykoodam',
        r.father ?? 'Bipin T.V', 'Bank Employee', r.fPhone ?? `94965656${String(i).padStart(2, '0')}`, r.mother ?? 'Anjana K.V', 'IT Employee', r.mPhone ?? `82817381${String(i).padStart(2, '0')}`,
        r.emergency ?? 'Aravind 9447788965', r.courses ?? 'LKG', r.due ?? '5th', r.check ?? '']
        .map((v) => q(String(v)))
        .join(',')
    )
  ].join('\r\n')
}
const plan = (text: string, existing: string[] = []) => planImport(parseCsv(text), new Set(existing))

describe('reading the sheet', () => {
  it('parses quoted cells with commas, quotes and line breaks', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"\nthere']])
  })
  it('drops the "?" of an uncertain reading and placeholders', () => {
    expect(clean('Rathvik Dhanush ?')).toBe('Rathvik Dhanush')
    expect(clean('7A, Belrose Tower ?, Elamkulam')).toBe('7A, Belrose Tower, Elamkulam')
    expect(clean('-')).toBe('')
    expect(clean('(c/o, not filled)')).toBe('')
  })
  it('takes the first valid phone number', () => {
    expect(firstPhone('9895119469 / 9072457720')).toBe('+919895119469')
    expect(firstPhone('859003466 ?')).toBeNull()
  })
  it('works out the programs from the heading and the ticked boxes', () => {
    expect(programsOf('LKG 2026-27', 'Day-care, Summer camp').codes).toEqual(['lk', 'dc', 'sm'])
    expect(programsOf('UKG 2026-27', 'Playgroup, Nursery').codes).toEqual(['uk'])
    expect(programsOf('', 'Afterschool care').codes).toEqual(['tu'])
    expect(programsOf('', 'Day-care, Afterschool care').codes).toEqual(['dc'])
    expect(programsOf('AFTERSCHOOL TUITION 2026-27', 'Afterschool care').codes).toEqual(['tu'])
  })
})

describe('the import plan', () => {
  it('turns a row into an admission at ₹0 a month, due by the 5th, Mon–Fri', () => {
    const [p] = plan(csv({ heading: 'LKG 2026-27', name: 'Janvi An Bipin', courses: 'LKG' }))
    expect(p!.skip).toBeNull()
    expect(p!.programs).toBe('LKG')
    expect(p!.admission!.programs).toEqual([{ program: 'lk', startDate: '2026-06-03', schedule: { days: 31 }, fee: expect.objectContaining({ standard: '0', dueDay: '5', periodMonths: 1 }) }])
    expect(p!.admission!.notes).toContain('Fees are ₹0 until set.')
  })

  it('an afterschool child goes into Tuition with their other school', () => {
    const [p] = plan(csv({ courses: 'Afterschool care', school: 'Choice School', cls: 'UKG' }))
    expect(p!.programs).toBe('Tuition')
    expect(p!.admission).toEqual(expect.objectContaining({ afterschool: true, otherSchool: 'Choice School', otherSchoolClass: 'UKG' }))
  })

  it('children with the same parent phone share a family', () => {
    const rows = plan(csv({ name: 'Janvi', fPhone: '9496565684', mPhone: '8281738110' }, { name: 'Tanvi', fPhone: '9496565688', mPhone: '8281738110' }))
    expect(rows[1]!.siblingOf).toBe('Janvi')
    expect(rows[1]!.familyOf).toBe(0)
  })

  it('leaves out summer programs, children already in the app, and rows with no program', () => {
    const rows = plan(
      csv({ name: 'Vasudev', courses: 'Summer camp, Preparatory class' }, { name: 'Beon Joseph' }, { name: 'Thannira', courses: '(none ticked)' }, { name: 'David', heading: 'LKG 2026-27', courses: 'Day-care, Summer camp' }),
      ['beon joseph']
    )
    expect(rows.map((r) => r.skip)).toEqual([
      'Only Summer camp and Preparatory class on the form: add this child by hand if still coming',
      'Already in the app',
      'No program on the form: add this child by hand if still coming',
      null
    ])
    expect(rows[3]!.programs).toBe('LKG, Daycare')
    expect(rows[3]!.admission!.notes).toContain('Summer camp on the form: not added')
  })

  it('a missing joining date or emergency number is filled in and explained in the note', () => {
    const [p] = plan(csv({ joining: '', emergency: '', due: '10th' }))
    expect(p!.admission!.joiningDate).toBe('2026-06-01')
    const fam = p!.admission!.family as { kind: 'new'; emergency: { name: string; phone: string } }
    expect(fam.emergency).toEqual({ name: 'Anjana K.V', relationship: '', phone: '+918281738100' })
    expect(p!.admission!.notes).toContain('No clear joining date on the form')
    expect(p!.admission!.notes).toContain("the mother's number is used for now")
    expect(p!.admission!.notes).toContain('The form says fees by the 10th.')
  })

  it('refuses a file without a name column', () => {
    expect(() => plan('a,b\n1,2')).toThrow(/Child's name/)
  })
})

describe('running the import', () => {
  let db: Database.Database
  let repo: StudentsRepo
  let planner: PlannerRepo
  beforeEach(() => {
    const dir = join(__dirname, '../../src/main/db/migrations')
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    runMigrations(db, migrationsFromFiles(Object.fromEntries(readdirSync(dir).map((f) => [`./migrations/${f}`, readFileSync(join(dir, f), 'utf8')]))))
    const w = new Writer(db, 'device-1')
    repo = new StudentsRepo(w)
    planner = new PlannerRepo(w)
  })

  it('adds the children, siblings share guardians, and a second import adds no one', () => {
    const text = csv(
      { name: 'Janvi An Bipin', heading: 'LKG 2026-27', mPhone: '8281738110' },
      { name: 'Tanvi An Bipin', heading: 'LKG 2026-27', mPhone: '8281738110' },
      { name: 'Mayukh', courses: 'Afterschool care', school: 'Bhavans', joining: '2026-08-10' }
    )
    expect(runImport(repo, planner, plan(text, [...repo.existingNames()]))).toEqual({ added: 3, todos: 0, skipped: [] })
    const guardians = db.prepare('SELECT count(*) FROM guardians WHERE deleted_at IS NULL').pluck().get()
    expect(guardians).toBe(6) // two families of father, mother and emergency contact
    const fees = db.prepare('SELECT DISTINCT standard_paise FROM fee_agreements').pluck().all()
    expect(fees).toEqual([0])
    expect(repo.list({ search: 'Mayukh', status: 'active', page: 0 }).total).toBe(1)

    const again = runImport(repo, planner, plan(text, [...repo.existingNames()]))
    expect(again.added).toBe(0)
    expect(again.skipped.map((s) => s.reason)).toEqual(['Already in the app', 'Already in the app', 'Already in the app'])
  })

  it("turns each form's Check notes into a to-do for the child, also for children already in the app, once", () => {
    const first = csv({ name: 'Mayukh', courses: 'Afterschool care', school: 'Bhavans', check: 'Afterschool: Tuition or Daycare?' })
    expect(runImport(repo, planner, plan(first)).todos).toBe(1)
    const both = csv(
      { name: 'Mayukh', courses: 'Afterschool care', school: 'Bhavans', check: 'Afterschool: Tuition or Daycare?' },
      { name: 'Shristi Sethi', heading: 'UKG 2026-27', check: "Mother's phone has only 9 digits." }
    )
    const r = runImport(repo, planner, plan(both, [...repo.existingNames()]))
    expect(r).toEqual(expect.objectContaining({ added: 1, todos: 1 }))
    const todos = planner.todos().open
    expect(todos.map((t) => [t.title, t.notes, t.studentName])).toEqual([
      ["Check Mayukh's admission form", 'Afterschool: Tuition or Daycare?', 'Mayukh'],
      ["Check Shristi Sethi's admission form", "Mother's phone has only 9 digits.", 'Shristi Sethi']
    ])
    expect(runImport(repo, planner, plan(both, [...repo.existingNames()])).todos).toBe(0)
  })
})
