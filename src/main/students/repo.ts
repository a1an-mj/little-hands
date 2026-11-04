import type Database from 'better-sqlite3'
import type { Writer } from '../db/writer'
import type { Admission, GuardianInput, NoteInput, StudentDetailsInput } from '@shared/schemas'
import { guardianSchema, noteSchema, studentDetailsSchema } from '@shared/schemas'
import { phoneSearchDigits } from '@shared/phone'
import { formatStudentCode, yearOf } from '@shared/student-code'
import {
  PAGE_SIZE,
  STUDENT_STATUSES,
  type GuardianLink,
  type StudentListQuery,
  type StudentListResult,
  type StudentProfile,
  type StudentStatus
} from '@shared/students'

/** A problem the owner can fix; its message is shown in the app as-is. */
export class UserError extends Error {}

type GuardianRow = {
  link_id: string
  guardian_id: string
  name: string | null
  phone: string | null
  relationship: string
  is_fee_contact: number
  is_emergency: number
}

const bool = (b: boolean) => (b ? 1 : 0)
const nullIfEmpty = (s: string) => (s === '' ? null : s)
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c)

export class StudentsRepo {
  private readonly db: Database.Database

  constructor(private readonly w: Writer) {
    this.db = w.db
  }

  // ---------- Reading ----------

  list(q: StudentListQuery): StudentListResult {
    const search = q.search.trim()
    const digits = phoneSearchDigits(search)
    const params = {
      status: q.status,
      like: `%${likeEscape(search)}%`,
      digits: digits ? `%${digits}%` : null,
      hasSearch: search ? 1 : 0,
      limit: PAGE_SIZE,
      offset: q.page * PAGE_SIZE
    }
    const where = `s.deleted_at IS NULL AND s.status = @status AND (
        @hasSearch = 0
        OR s.full_name LIKE @like ESCAPE '\\'
        OR s.student_code LIKE @like ESCAPE '\\'
        OR (@digits IS NOT NULL AND EXISTS (
          SELECT 1 FROM student_guardians x JOIN guardians gx ON gx.id = x.guardian_id
          WHERE x.student_id = s.id AND x.deleted_at IS NULL AND gx.deleted_at IS NULL
            AND gx.phone LIKE @digits)))`

    const rows = this.db
      .prepare(
        `SELECT s.id, s.student_code, s.full_name, s.joining_date, s.status,
                g.name AS c_name, g.phone AS c_phone, sg.relationship AS c_rel
         FROM students s
         LEFT JOIN student_guardians sg ON sg.student_id = s.id AND sg.is_fee_contact = 1 AND sg.deleted_at IS NULL
         LEFT JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
         WHERE ${where}
         ORDER BY s.full_name COLLATE NOCASE, s.student_code
         LIMIT @limit OFFSET @offset`
      )
      .all(params) as {
      id: string
      student_code: string
      full_name: string
      joining_date: string
      status: StudentStatus
      c_name: string | null
      c_phone: string | null
      c_rel: string | null
    }[]

    const total = this.db.prepare(`SELECT count(*) FROM students s WHERE ${where}`).pluck().get(params) as number

    const counts = Object.fromEntries(STUDENT_STATUSES.map((s) => [s, 0])) as Record<StudentStatus, number>
    for (const r of this.db
      .prepare('SELECT status, count(*) AS n FROM students WHERE deleted_at IS NULL GROUP BY status')
      .all() as { status: StudentStatus; n: number }[]) {
      counts[r.status] = r.n
    }

    return {
      total,
      counts,
      rows: rows.map((r) => ({
        id: r.id,
        code: r.student_code,
        fullName: r.full_name,
        joiningDate: r.joining_date,
        status: r.status,
        mainContact: r.c_rel === null ? null : { name: r.c_name, phone: r.c_phone, relationship: r.c_rel }
      }))
    }
  }

  /** The ID the next student joining in that year would get (shown on the admission form). */
  nextCode(joiningDate: string): string {
    const year = yearOf(joiningDate)
    return formatStudentCode(year, this.nextSeq(year))
  }

  profile(id: string): StudentProfile | null {
    const s = this.db
      .prepare('SELECT * FROM students WHERE id = ? AND deleted_at IS NULL')
      .get(id) as
      | { id: string; student_code: string; full_name: string; joining_date: string; status: StudentStatus; home_address: string }
      | undefined
    if (!s) return null

    const photo = this.db
      .prepare('SELECT image FROM student_photos WHERE student_id = ? AND deleted_at IS NULL')
      .pluck()
      .get(id) as Buffer | undefined

    const notes = this.db
      .prepare(
        `SELECT id, title, details, important FROM student_notes
         WHERE student_id = ? AND deleted_at IS NULL ORDER BY important DESC, created_at`
      )
      .all(id) as { id: string; title: string; details: string; important: number }[]

    return {
      id: s.id,
      code: s.student_code,
      fullName: s.full_name,
      joiningDate: s.joining_date,
      status: s.status,
      homeAddress: s.home_address,
      photo: photo ? `data:image/jpeg;base64,${photo.toString('base64')}` : null,
      guardians: this.guardians(id),
      notes: notes.map((n) => ({ ...n, important: n.important === 1 }))
    }
  }

  private guardians(studentId: string): GuardianLink[] {
    const rows = this.db
      .prepare(
        `SELECT sg.id AS link_id, g.id AS guardian_id, g.name, g.phone, sg.relationship,
                sg.is_fee_contact, sg.is_emergency
         FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
         WHERE sg.student_id = ? AND sg.deleted_at IS NULL AND g.deleted_at IS NULL
         ORDER BY sg.is_fee_contact DESC, sg.sort_order, sg.created_at`
      )
      .all(studentId) as GuardianRow[]
    const siblings = this.db.prepare(
      `SELECT s.id, s.full_name AS fullName FROM student_guardians sg JOIN students s ON s.id = sg.student_id
       WHERE sg.guardian_id = ? AND sg.student_id <> ? AND sg.deleted_at IS NULL AND s.deleted_at IS NULL
       ORDER BY s.full_name`
    )
    return rows.map((r) => ({
      linkId: r.link_id,
      guardianId: r.guardian_id,
      name: r.name,
      phone: r.phone,
      relationship: r.relationship,
      isFeeContact: r.is_fee_contact === 1,
      isEmergency: r.is_emergency === 1,
      sharedWith: siblings.all(r.guardian_id, studentId) as { id: string; fullName: string }[]
    }))
  }

  // ---------- Admission ----------

  admit(a: Admission, photo: Buffer | null): string {
    return this.w.transaction(() => {
      const year = yearOf(a.joiningDate)
      const seq = this.nextSeq(year)
      const homeAddress =
        a.family.kind === 'sibling' && !a.homeAddress ? this.siblingAddress(a.family.siblingId) : a.homeAddress

      const studentId = this.w.insert('students', {
        student_code: formatStudentCode(year, seq),
        code_year: year,
        code_seq: seq,
        full_name: a.fullName,
        joining_date: a.joiningDate,
        status: 'active',
        home_address: homeAddress
      })

      if (a.family.kind === 'sibling') this.copyFamily(a.family.siblingId, studentId)
      else this.addNewFamily(studentId, a.family)

      if (a.notes) {
        this.w.insert('student_notes', { student_id: studentId, title: 'Admission note', details: a.notes, important: 0 })
      }
      if (photo) this.w.insert('student_photos', { student_id: studentId, image: photo, mime: 'image/jpeg' })
      return studentId
    })
  }

  private nextSeq(year: number): number {
    // Counts removed students too, so an ID is never given out twice.
    const max = this.db.prepare('SELECT max(code_seq) FROM students WHERE code_year = ?').pluck().get(year) as number | null
    return (max ?? 0) + 1
  }

  private siblingAddress(siblingId: string): string {
    const addr = this.db
      .prepare('SELECT home_address FROM students WHERE id = ? AND deleted_at IS NULL')
      .pluck()
      .get(siblingId) as string | undefined
    if (addr === undefined) throw new UserError('That brother or sister could not be found.')
    return addr
  }

  private copyFamily(siblingId: string, studentId: string) {
    const links = this.guardians(siblingId)
    if (links.length === 0) throw new UserError('That brother or sister has no parents or guardians saved yet.')
    links.forEach((g, i) =>
      this.w.insert('student_guardians', {
        student_id: studentId,
        guardian_id: g.guardianId,
        relationship: g.relationship,
        is_fee_contact: bool(g.isFeeContact),
        is_emergency: bool(g.isEmergency),
        sort_order: i
      })
    )
  }

  private addNewFamily(studentId: string, f: Extract<Admission['family'], { kind: 'new' }>) {
    type P = { key: string; name: string; phone: string | null; relationship: string; emergency: boolean }
    const people: P[] = [
      { key: 'father', ...f.father, relationship: 'Father', emergency: false },
      { key: 'mother', ...f.mother, relationship: 'Mother', emergency: false }
    ]
    // If the emergency number belongs to a parent, mark that parent instead of adding the same person twice.
    const sameAsParent = people.find((p) => p.phone && p.phone === f.emergency.phone)
    if (sameAsParent) sameAsParent.emergency = true
    else {
      people.push({
        key: 'emergency',
        name: f.emergency.name,
        phone: f.emergency.phone,
        relationship: f.emergency.relationship || 'Emergency contact',
        emergency: true
      })
    }
    f.extra.forEach((g, i) => people.push({ key: `extra-${i}`, ...g, emergency: false }))

    const feeKey = f.feeContact === 'emergency' && sameAsParent ? sameAsParent.key : f.feeContact
    let order = 0
    for (const p of people) {
      if (!p.name && !p.phone) continue
      const guardianId = this.w.insert('guardians', { name: nullIfEmpty(p.name), phone: p.phone })
      this.w.insert('student_guardians', {
        student_id: studentId,
        guardian_id: guardianId,
        relationship: p.relationship,
        is_fee_contact: bool(p.key === feeKey),
        is_emergency: bool(p.emergency),
        sort_order: order++
      })
    }
  }

  // ---------- Editing ----------

  updateDetails(id: string, input: StudentDetailsInput): void {
    const d = studentDetailsSchema.parse(input)
    this.w.transaction(() => {
      this.w.update('students', id, {
        full_name: d.fullName,
        joining_date: d.joiningDate,
        status: d.status,
        home_address: d.homeAddress
      })
    })
  }

  /** "Added by mistake": hides the student everywhere. Nothing is erased. */
  remove(id: string): void {
    this.w.transaction(() => {
      this.requireStudent(id)
      // From step 4: refuse if the student has any payment.
      for (const link of this.guardians(id)) this.w.softDelete('student_guardians', link.linkId)
      this.w.softDelete('students', id)
    })
  }

  setPhoto(studentId: string, jpeg: Buffer | null): void {
    this.w.transaction(() => {
      this.requireStudent(studentId)
      const existing = this.db
        .prepare('SELECT id FROM student_photos WHERE student_id = ? AND deleted_at IS NULL')
        .pluck()
        .get(studentId) as string | undefined
      if (existing && jpeg) this.w.update('student_photos', existing, { image: jpeg })
      else if (existing) this.w.softDelete('student_photos', existing)
      else if (jpeg) this.w.insert('student_photos', { student_id: studentId, image: jpeg, mime: 'image/jpeg' })
    })
  }

  // ---------- Guardians ----------

  addGuardian(studentId: string, input: GuardianInput): string {
    const g = guardianSchema.parse(input)
    return this.w.transaction(() => {
      this.requireStudent(studentId)
      const existing = this.guardians(studentId)
      const guardianId = this.w.insert('guardians', { name: nullIfEmpty(g.name), phone: g.phone })
      return this.w.insert('student_guardians', {
        student_id: studentId,
        guardian_id: guardianId,
        relationship: g.relationship,
        // The first guardian of a child automatically becomes the main contact.
        is_fee_contact: bool(existing.length === 0),
        is_emergency: bool(g.isEmergency),
        sort_order: existing.length
      })
    })
  }

  /** Name and phone belong to the person (shared with siblings); relationship and emergency belong to this child. */
  updateGuardian(linkId: string, input: GuardianInput): void {
    const g = guardianSchema.parse(input)
    this.w.transaction(() => {
      const link = this.requireLink(linkId)
      this.w.update('guardians', link.guardian_id, { name: nullIfEmpty(g.name), phone: g.phone })
      this.w.update('student_guardians', linkId, { relationship: g.relationship, is_emergency: bool(g.isEmergency) })
    })
  }

  setFeeContact(linkId: string): void {
    this.w.transaction(() => {
      const link = this.requireLink(linkId)
      const current = this.db
        .prepare(
          'SELECT id FROM student_guardians WHERE student_id = ? AND is_fee_contact = 1 AND deleted_at IS NULL'
        )
        .pluck()
        .get(link.student_id) as string | undefined
      if (current === linkId) return
      if (current) this.w.update('student_guardians', current, { is_fee_contact: 0 })
      this.w.update('student_guardians', linkId, { is_fee_contact: 1 })
    })
  }

  removeGuardian(linkId: string): void {
    this.w.transaction(() => {
      const link = this.requireLink(linkId)
      if (link.is_fee_contact === 1) {
        throw new UserError('This is the main contact for fees. Choose another main contact first.')
      }
      // Only the link to this child is removed; the person stays for any brothers or sisters.
      this.w.softDelete('student_guardians', linkId)
    })
  }

  // ---------- Notes ----------

  addNote(studentId: string, input: NoteInput): string {
    const n = noteSchema.parse(input)
    return this.w.transaction(() => {
      this.requireStudent(studentId)
      return this.w.insert('student_notes', {
        student_id: studentId,
        title: n.title,
        details: n.details,
        important: bool(n.important)
      })
    })
  }

  updateNote(noteId: string, input: NoteInput): void {
    const n = noteSchema.parse(input)
    this.w.transaction(() => {
      this.w.update('student_notes', noteId, { title: n.title, details: n.details, important: bool(n.important) })
    })
  }

  removeNote(noteId: string): void {
    this.w.transaction(() => this.w.softDelete('student_notes', noteId))
  }

  // ---------- Helpers ----------

  private requireStudent(id: string) {
    const ok = this.db.prepare('SELECT 1 FROM students WHERE id = ? AND deleted_at IS NULL').get(id)
    if (!ok) throw new UserError('This student could not be found. They may have been removed.')
  }

  private requireLink(linkId: string) {
    const link = this.db
      .prepare('SELECT * FROM student_guardians WHERE id = ? AND deleted_at IS NULL')
      .get(linkId) as { student_id: string; guardian_id: string; is_fee_contact: number } | undefined
    if (!link) throw new UserError('This contact could not be found.')
    return link
  }
}
