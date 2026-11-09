import Database from 'better-sqlite3'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrationsFromFiles, runMigrations } from '../../src/main/db/migrate'
import { Writer } from '../../src/main/db/writer'
import { StudentsRepo, UserError } from '../../src/main/students/repo'
import { admissionSchema, type AdmissionInput } from '@shared/schemas'
import { newFamilyAdmission } from './fixtures'

const dir = join(__dirname, '../../src/main/db/migrations')
const migrations = migrationsFromFiles(
  Object.fromEntries(readdirSync(dir).map((f) => [`./migrations/${f}`, readFileSync(join(dir, f), 'utf8')]))
)

let db: Database.Database
let repo: StudentsRepo

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db, migrations)
  repo = new StudentsRepo(new Writer(db, 'device-1'))
})

const admit = (overrides: Partial<AdmissionInput> = {}, photo: Buffer | null = null) =>
  repo.admit(admissionSchema.parse(newFamilyAdmission(overrides)), photo)
const list = (search = '', status: 'active' | 'inactive' | 'graduated' = 'active', page = 0) =>
  repo.list({ search, status, page })
const audit = () =>
  db.prepare('SELECT table_name, action, changes FROM audit_log ORDER BY rowid').all() as {
    table_name: string
    action: string
    changes: string
  }[]

describe('student IDs', () => {
  it('numbers students per joining year: LH-<year>-<3 digits>', () => {
    expect(repo.nextCode('2026-11-02')).toBe('LH-2026-001')
    const a = admit({ joiningDate: '2026-06-01' })
    const b = admit({ joiningDate: '2026-11-02' })
    const c = admit({ joiningDate: '2025-06-04' })
    expect(repo.profile(a)!.code).toBe('LH-2026-001')
    expect(repo.profile(b)!.code).toBe('LH-2026-002')
    expect(repo.profile(c)!.code).toBe('LH-2025-001')
    expect(repo.nextCode('2026-01-01')).toBe('LH-2026-003')
  })

  it('never reuses the ID of a removed student', () => {
    const a = admit()
    repo.remove(a)
    const b = admit()
    expect(repo.profile(b)!.code).toBe('LH-2026-002')
  })

  it('keeps the ID when the joining date changes', () => {
    const a = admit()
    repo.updateDetails(a, { fullName: 'Aadhya Menon', joiningDate: '2025-06-01', status: 'active', homeAddress: '' })
    expect(repo.profile(a)!.code).toBe('LH-2026-001')
  })

  it('goes past 999 in a year', () => {
    db.prepare(
      `INSERT INTO students (id, student_code, code_year, code_seq, full_name, joining_date, created_at, updated_at, device_id)
       VALUES ('x', 'LH-2026-999', 2026, 999, 'X', '2026-01-01', '', '', 'd')`
    ).run()
    expect(repo.nextCode('2026-05-05')).toBe('LH-2026-1000')
  })
})

describe('admission', () => {
  it('saves the child, parents, emergency contact, notes and photo in one go', () => {
    const id = admit({ notes: 'Peanut allergy', homeAddress: 'Rose Villa, Kochi' }, Buffer.from([0xff, 0xd8, 0xff]))
    const p = repo.profile(id)!
    expect(p).toMatchObject({ fullName: 'Aadhya Menon', joiningDate: '2026-06-03', status: 'active', homeAddress: 'Rose Villa, Kochi' })
    expect(p.photo).toMatch(/^data:image\/jpeg;base64,/)
    expect(p.notes).toEqual([{ id: expect.any(String), title: 'Admission note', details: 'Peanut allergy', important: false }])
    expect(p.guardians.map((g) => [g.name, g.relationship, g.phone, g.isFeeContact, g.isEmergency])).toEqual([
      ['Suresh Menon', 'Father', '+919000000014', true, false],
      ['Lakshmi Menon', 'Mother', null, false, false],
      ['Sarojini Amma', 'Grandmother', '+919000000016', false, true]
    ])
  })

  it('skips empty parents', () => {
    const id = admit({
      family: {
        kind: 'new',
        father: { name: '', phone: '' },
        mother: { name: 'Mary Joseph', phone: '9000000063' },
        emergency: { name: '', relationship: '', phone: '9000000099' },
        extra: [],
        feeContact: 'mother'
      }
    })
    const g = repo.profile(id)!.guardians
    expect(g.map((x) => x.relationship)).toEqual(['Mother', 'Emergency contact'])
  })

  it('does not add a parent twice when their number is also the emergency number', () => {
    const id = admit({
      family: {
        kind: 'new',
        father: { name: 'Suresh Menon', phone: '9000000014' },
        mother: { name: '', phone: '' },
        emergency: { name: '', relationship: '', phone: '+91 90000 00014' },
        extra: [],
        feeContact: 'emergency'
      }
    })
    const g = repo.profile(id)!.guardians
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({ name: 'Suresh Menon', isFeeContact: true, isEmergency: true })
  })

  it('a brother or sister shares the same guardians and address', () => {
    const first = admit({ homeAddress: 'Rose Villa' })
    const second = admit({ fullName: 'Arav Menon', family: { kind: 'sibling', siblingId: first } })
    const p2 = repo.profile(second)!
    expect(p2.homeAddress).toBe('Rose Villa')
    expect(p2.guardians.map((g) => g.guardianId)).toEqual(repo.profile(first)!.guardians.map((g) => g.guardianId))
    expect(p2.guardians[0]!.sharedWith).toEqual([{ id: first, fullName: 'Aadhya Menon' }])

    // Changing the father's phone on one child changes it for both.
    const father = p2.guardians[0]!
    repo.updateGuardian(father.linkId, { name: 'Suresh Menon', phone: '9000000777', relationship: 'Father', isEmergency: false })
    expect(repo.profile(first)!.guardians[0]!.phone).toBe('+919000000777')
  })

  it('writes nothing if any part fails', () => {
    expect(() => admit({ family: { kind: 'sibling', siblingId: '6f1c1a49-7f0e-4b6d-9a57-0d7a0c1f2b11' } })).toThrow(UserError)
    expect(db.prepare('SELECT count(*) FROM students').pluck().get()).toBe(0)
    expect(db.prepare('SELECT count(*) FROM audit_log').pluck().get()).toBe(0)
  })
})

describe('student list', () => {
  beforeEach(() => {
    admit({ fullName: 'Neha Varghese' })
    admit({
      fullName: 'anna Joseph',
      family: {
        kind: 'new',
        father: { name: '', phone: '' },
        mother: { name: 'Mary Joseph', phone: '9000000063' },
        emergency: { name: '', relationship: '', phone: '9000000063' },
        extra: [],
        feeContact: 'mother'
      }
    })
    admit({ fullName: 'Dev Krishna', joiningDate: '2025-06-01' })
  })

  it('is A–Z ignoring case, with the main contact', () => {
    const r = list()
    expect(r.rows.map((x) => x.fullName)).toEqual(['anna Joseph', 'Dev Krishna', 'Neha Varghese'])
    expect(r.rows[0]!.mainContact).toEqual({ name: 'Mary Joseph', relationship: 'Mother', phone: '+919000000063' })
    expect(r.total).toBe(3)
  })

  it('finds by name, student ID or any parent phone', () => {
    expect(list('neha').rows.map((x) => x.fullName)).toEqual(['Neha Varghese'])
    expect(list('LH-2025').rows.map((x) => x.fullName)).toEqual(['Dev Krishna'])
    expect(list('90000 00063').rows.map((x) => x.fullName)).toEqual(['anna Joseph'])
    expect(list('00016').total).toBe(2) // grandmother's number on two children
    expect(list('100%').total).toBe(0)
  })

  it('filters by status and counts each status', () => {
    const dev = list('Dev').rows[0]!.id
    repo.updateDetails(dev, { fullName: 'Dev Krishna', joiningDate: '2025-06-01', status: 'graduated', homeAddress: '' })
    expect(list().total).toBe(2)
    expect(list('', 'graduated').rows.map((x) => x.fullName)).toEqual(['Dev Krishna'])
    expect(list().counts).toEqual({ active: 2, inactive: 0, graduated: 1 })
  })

  it('pages 25 at a time', () => {
    for (let i = 0; i < 30; i++) admit({ fullName: `Child ${String(i).padStart(2, '0')}` })
    expect(list().total).toBe(33)
    expect(list().rows).toHaveLength(25)
    expect(list('', 'active', 1).rows).toHaveLength(8)
  })

  it('hides removed students', () => {
    repo.remove(list('Neha').rows[0]!.id)
    expect(list().total).toBe(2)
    expect(list().counts.active).toBe(2)
  })
})

describe('guardians', () => {
  it('only one main contact for fees; switching moves it', () => {
    const id = admit()
    const [father, mother] = repo.profile(id)!.guardians
    repo.setFeeContact(mother!.linkId)
    const g = repo.profile(id)!.guardians
    expect(g.filter((x) => x.isFeeContact).map((x) => x.name)).toEqual(['Lakshmi Menon'])
    expect(father).toBeDefined()
  })

  it('the database itself refuses two main contacts', () => {
    const id = admit()
    const mother = repo.profile(id)!.guardians[1]!
    expect(() => db.prepare('UPDATE student_guardians SET is_fee_contact = 1 WHERE id = ?').run(mother.linkId)).toThrow(/UNIQUE/)
  })

  it('cannot remove the main contact, but can remove others (only for this child)', () => {
    const first = admit()
    const second = admit({ fullName: 'Arav Menon', family: { kind: 'sibling', siblingId: first } })
    const [father, mother] = repo.profile(second)!.guardians
    expect(() => repo.removeGuardian(father!.linkId)).toThrow(/main contact/)
    repo.removeGuardian(mother!.linkId)
    expect(repo.profile(second)!.guardians.map((g) => g.name)).not.toContain('Lakshmi Menon')
    expect(repo.profile(first)!.guardians.map((g) => g.name)).toContain('Lakshmi Menon')
  })

  it('adds a guardian; the first guardian of a child becomes the main contact', () => {
    const id = admit()
    repo.addGuardian(id, { name: 'Joseph', phone: '', relationship: 'Uncle', isEmergency: true })
    expect(repo.profile(id)!.guardians.at(-1)).toMatchObject({ name: 'Joseph', relationship: 'Uncle', isEmergency: true, isFeeContact: false })
  })
})

describe('notes and photo', () => {
  it('adds, edits and removes notes; important ones first', () => {
    const id = admit()
    const a = repo.addNote(id, { title: 'Pick-up', details: 'Grandmother on Tuesdays', important: false })
    repo.addNote(id, { title: 'Peanut allergy', details: '', important: true })
    expect(repo.profile(id)!.notes.map((n) => n.title)).toEqual(['Peanut allergy', 'Pick-up'])
    repo.updateNote(a, { title: 'Pick-up', details: 'Grandmother on Tue and Thu', important: false })
    expect(repo.profile(id)!.notes[1]!.details).toBe('Grandmother on Tue and Thu')
    repo.removeNote(a)
    expect(repo.profile(id)!.notes).toHaveLength(1)
  })

  it('adds, replaces and removes the photo', () => {
    const id = admit()
    expect(repo.profile(id)!.photo).toBeNull()
    repo.setPhoto(id, Buffer.from([1]))
    repo.setPhoto(id, Buffer.from([2]))
    expect(repo.profile(id)!.photo).toBe('data:image/jpeg;base64,Ag==')
    repo.setPhoto(id, null)
    expect(repo.profile(id)!.photo).toBeNull()
  })
})

describe('change history', () => {
  it('records inserts, real changes only, and removals', () => {
    const id = admit()
    const before = audit().length
    repo.updateDetails(id, { fullName: 'Aadhya Menon', joiningDate: '2026-06-03', status: 'active', homeAddress: '' })
    expect(audit()).toHaveLength(before) // nothing changed → nothing logged

    repo.updateDetails(id, { fullName: 'Aadhya S Menon', joiningDate: '2026-06-03', status: 'inactive', homeAddress: '' })
    const last = audit().filter((a) => a.table_name === 'students').at(-1)!
    expect(last.action).toBe('update')
    expect(JSON.parse(last.changes)).toEqual({ full_name: ['Aadhya Menon', 'Aadhya S Menon'], status: ['active', 'inactive'] })

    repo.remove(id)
    expect(audit().at(-1)).toMatchObject({ table_name: 'students', action: 'delete' })
    expect(db.prepare('SELECT deleted_at IS NOT NULL FROM students WHERE id = ?').pluck().get(id)).toBe(1)
  })

  it('logs photos without copying the image into the history', () => {
    const id = admit()
    repo.setPhoto(id, Buffer.from([1, 2, 3]))
    expect(JSON.parse(audit().at(-1)!.changes).image).toEqual([null, '[image]'])
  })

  it('every row carries the device id and timestamps', () => {
    const id = admit()
    const row = db.prepare('SELECT device_id, created_at, updated_at FROM students WHERE id = ?').get(id) as Record<string, string>
    expect(row.device_id).toBe('device-1')
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('the history cannot be edited or deleted', () => {
    admit()
    expect(() => db.prepare("UPDATE audit_log SET action = 'insert'").run()).toThrow(/append-only/)
    expect(() => db.prepare('DELETE FROM audit_log').run()).toThrow(/append-only/)
  })
})
