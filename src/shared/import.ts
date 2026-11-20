// "Import students" from a spreadsheet (CSV) typed up from the paper admission forms.
// The forms have no fees, so every program starts at ₹0 for the owner to fill in; whatever the form
// leaves unclear goes into the child's admission note.
import { KINDERGARTEN_CODES, PROGRAM_NAME, type ProgramCode } from './enrollments'
import { normalizePhone } from './phone'
import { admissionSchema, type AdmissionInput, type EnrollmentInput } from './schemas'

/** Columns the import reads (headers as in the sheet; matched ignoring case and punctuation). */
export const IMPORT_COLUMNS = {
  name: "Child's name",
  joining: 'Joining date',
  dob: 'Date of birth',
  heading: 'Form heading (top)',
  classWritten: 'Class (as written)',
  otherSchool: 'Other school',
  address: 'Address',
  fatherName: "Father's name",
  fatherJob: "Father's occupation",
  fatherPhone: "Father's phone",
  motherName: "Mother's name",
  motherJob: "Mother's occupation",
  motherPhone: "Mother's phone",
  emergency: 'Emergency contact',
  courses: 'Courses ticked',
  dueBy: 'Fees due by (on form)',
  check: 'Check',
  age: 'Age on form',
  photo: 'Photo file'
} as const
type Col = keyof typeof IMPORT_COLUMNS

export const ALREADY_IN_APP = 'Already in the app'

/** Mon–Fri. */
const WEEKDAYS = 31
/** Used when a form has no joining date: the start of the 2026–27 school year. */
export const FALLBACK_JOINING = '2026-06-01'

export interface ImportRow {
  /** Row number in the sheet (the header is row 1). */
  line: number
  name: string
  /** Shown in the preview: "LKG, Daycare". */
  programs: string
  /** Name of the earlier row whose family this child shares, if any. */
  siblingOf: string | null
  /** Why this row won't be imported; null = it will be. */
  skip: string | null
  /** Whether a to-do comes with it ("Check …'s admission form"). */
  hasTodo: boolean
}

export interface ImportPlanItem extends ImportRow {
  admission: AdmissionInput | null
  /** A to-do from the form's "Check" column, linked to the child (also for children already in the app). */
  todo: { title: string; notes: string } | null
  /** Index into the plan of the sibling whose family to share. */
  familyOf: number | null
}

export interface ImportPreview {
  fileName: string
  rows: ImportRow[]
}

export interface ImportResult {
  added: number
  /** To-dos made from the forms' "Check" notes. */
  todos: number
  skipped: { name: string; reason: string }[]
}

// ---------- CSV ----------

/** RFC 4180 CSV (quotes, doubled quotes, newlines inside quotes, optional BOM). */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((x) => x.trim()))
}

const key = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '')

// ---------- Cleaning up what was read off the forms ----------

/** Drops the "?" that marks an uncertain reading, and placeholders like "-", "?" or "(not filled)". */
export function clean(v: string | undefined): string {
  const s = (v ?? '').replace(/\s*\?+\s*$/, '').replace(/\s+\?(?=[\s,;]|$)/g, '').trim()
  if (/^[-?–]*$/.test(s) || /^\(.*\)$/.test(s)) return ''
  return s
}

/** The first number in the text that is a valid phone, e.g. "9895119469 / 9072457720" → the first. */
export function firstPhone(v: string): string | null {
  for (const m of v.matchAll(/\+?\d[\d\s-]{7,}\d/g)) {
    const p = normalizePhone(m[0])
    if (p) return p
  }
  return null
}

/** "Grandfather Sivadas 9895303584" → name "Grandfather Sivadas"; just a number → no name. */
function emergencyOf(v: string): { name: string; phone: string | null } {
  const first = v.split(';')[0] ?? ''
  const phone = firstPhone(first) ?? firstPhone(v)
  const name = clean(first.replace(/\+?\d[\d\s-]*\d\??\??/g, ' ').replace(/[/?]/g, ' ').replace(/\s+/g, ' '))
  return { name, phone }
}

const isoDate = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(clean(v)) ? clean(v) : '')

/** Programs from the heading ("LKG 2026-27") and the ticked boxes ("Day-care, Afterschool care"). */
export function programsOf(heading: string, courses: string): { codes: ProgramCode[]; afterschoolTicked: boolean } {
  const h = heading.toLowerCase()
  const c = courses.toLowerCase()
  const has = (re: RegExp) => re.test(c)
  const codes = new Set<ProgramCode>()

  // One kindergarten class: the form's heading wins; otherwise the box that is ticked.
  const fromHeading: ProgramCode | null =
    /^\s*playgroup/.test(h) ? 'pg' : /^\s*nursery/.test(h) ? 'nu' : /^\s*lkg/.test(h) ? 'lk' : /^\s*ukg/.test(h) ? 'uk' : null
  const ticked = KINDERGARTEN_CODES.filter((k) =>
    k === 'pg' ? has(/playgroup/) : k === 'nu' ? has(/nursery/) : k === 'lk' ? has(/\blkg\b/) : has(/\bukg\b/)
  )
  const cls = fromHeading ?? ticked[0]
  if (cls) codes.add(cls)

  if (has(/day-?\s?care/) || /^\s*daycare/.test(h)) codes.add('dc')
  if (has(/summer camp/)) codes.add('sm')
  if (has(/preparatory/)) codes.add('pc')
  const afterschoolTicked = has(/afterschool|after school/) || /afterschool/.test(h)
  // An afterschool child must be in Tuition or Daycare (owner): Daycare if ticked, else Tuition.
  if (afterschoolTicked && !codes.has('dc')) codes.add('tu')
  if (/tuition/.test(h)) codes.add('tu')
  return { codes: [...codes], afterschoolTicked }
}

// ---------- The plan ----------

/** Turns the sheet into admissions. `existing` = names already in the app (lower case), which are skipped. */
export function planImport(table: string[][], existing: ReadonlySet<string>): ImportPlanItem[] {
  const [header, ...body] = table
  if (!header) throw new Error('The file is empty.')
  const idx = new Map(header.map((h, i) => [key(h), i]))
  const col = (r: string[], c: Col) => r[idx.get(key(IMPORT_COLUMNS[c])) ?? -1] ?? ''
  if (!idx.has(key(IMPORT_COLUMNS.name))) {
    throw new Error(`This file has no "${IMPORT_COLUMNS.name}" column. Use the spreadsheet made from the admission forms.`)
  }

  const items: ImportPlanItem[] = []
  const familyByPhone = new Map<string, number>()
  const seen = new Set<string>()

  body.forEach((r, i) => {
    const line = i + 2
    const name = clean(col(r, 'name'))
    const checkText = col(r, 'check').trim()
    const todo = name && checkText ? { title: `Check ${name}'s admission form`, notes: checkText.slice(0, 2000) } : null
    const base = { line, name: name || `(row ${line})`, programs: '', siblingOf: null, admission: null, familyOf: null, todo, hasTodo: todo !== null }
    if (!name) return items.push({ ...base, skip: 'No name' })
    if (existing.has(name.toLowerCase())) return items.push({ ...base, skip: ALREADY_IN_APP })
    if (seen.has(name.toLowerCase())) return items.push({ ...base, skip: 'Twice in the file' })
    seen.add(name.toLowerCase())

    const heading = col(r, 'heading')
    const all = programsOf(heading, col(r, 'courses'))
    // Summer camp and Preparatory class are for the summer holidays, which are over for every form:
    // they go in the note, not in the programs (otherwise the child is expected every day).
    const summer: ProgramCode[] = all.codes.filter((c) => c === 'sm' || c === 'pc')
    const codes = all.codes.filter((c) => !summer.includes(c))
    const afterschoolTicked = all.afterschoolTicked
    const programs = codes.map((c) => PROGRAM_NAME[c]).join(', ')
    if (codes.length === 0) {
      const why = summer.length ? `Only ${summer.map((c) => PROGRAM_NAME[c]).join(' and ')} on the form` : 'No program on the form'
      return items.push({ ...base, programs: '—', skip: `${why}: add this child by hand if still coming` })
    }

    const rawJoining = isoDate(col(r, 'joining'))
    const joiningDate = rawJoining || FALLBACK_JOINING
    let dob = isoDate(col(r, 'dob'))
    if (dob && dob >= joiningDate) dob = ''

    const otherSchoolRaw = clean(col(r, 'otherSchool'))
    const otherSchool = /little hands/i.test(otherSchoolRaw) ? '' : otherSchoolRaw
    const inClassHere = codes.some((c) => KINDERGARTEN_CODES.includes(c))
    // Goes to another school and comes here after it (Tuition or Daycare, not a class here).
    const afterschool = !inClassHere && (afterschoolTicked || otherSchool !== '') && codes.some((c) => c === 'tu' || c === 'dc')

    const father = { name: clean(col(r, 'fatherName')), phone: firstPhone(col(r, 'fatherPhone')) ?? '', occupation: clean(col(r, 'fatherJob')) }
    const mother = { name: clean(col(r, 'motherName')), phone: firstPhone(col(r, 'motherPhone')) ?? '', occupation: clean(col(r, 'motherJob')) }
    let emergency = emergencyOf(col(r, 'emergency'))
    let emergencyNote = ''
    if (!emergency.phone) {
      const fallback = mother.phone ? { name: mother.name, phone: mother.phone, who: 'mother' } : father.phone ? { name: father.name, phone: father.phone, who: 'father' } : null
      if (fallback) {
        emergencyNote = `No clear emergency number on the form; the ${fallback.who}'s number is used for now.`
        emergency = { name: fallback.name, phone: fallback.phone }
      }
    }
    const feeContact = father.name || father.phone ? 'father' : mother.name || mother.phone ? 'mother' : 'emergency'

    // The same parent phone number means the same family (siblings, twins).
    const phones = [father.phone, mother.phone].filter(Boolean)
    const familyOf = phones.map((p) => familyByPhone.get(p)).find((x) => x !== undefined) ?? null
    phones.forEach((p) => familyByPhone.has(p) || familyByPhone.set(p, items.length))

    const note = [
      `Imported from the paper admission form${col(r, 'photo') ? ` (photo ${col(r, 'photo')})` : ''}. Fees are ₹0 until set.`,
      heading && `Form heading: ${heading}.`,
      col(r, 'classWritten') && `Class written: ${col(r, 'classWritten')}.`,
      `Courses ticked: ${col(r, 'courses') || '(none)'}.`,
      summer.length > 0 && `${summer.map((c) => PROGRAM_NAME[c]).join(' and ')} on the form: not added (summer is over).`,
      col(r, 'age') && `Age on form: ${col(r, 'age')}.`,
      !rawJoining && `No clear joining date on the form (${col(r, 'joining') || 'blank'}); ${FALLBACK_JOINING} used.`,
      col(r, 'dueBy') && col(r, 'dueBy') !== '5th' && `The form says fees by the ${col(r, 'dueBy')}.`,
      otherSchoolRaw && !afterschool && otherSchool && `Other school on the form: ${otherSchoolRaw}${col(r, 'classWritten') ? `, ${col(r, 'classWritten')}` : ''}.`,
      col(r, 'emergency') && `Emergency contact on the form: ${col(r, 'emergency')}.`,
      `Phones on the form: father ${col(r, 'fatherPhone') || '—'}, mother ${col(r, 'motherPhone') || '—'}.`,
      emergencyNote,
      col(r, 'check') && `To check: ${col(r, 'check')}`
    ]
      .filter(Boolean)
      .join('\n')

    const fee = { periodMonths: 1, dueDay: '5', standard: '0', concession: '', concessionReason: '', remarks: '' }
    const enrollments: EnrollmentInput[] = codes.map((program) => ({ program, startDate: joiningDate, schedule: { days: WEEKDAYS }, fee }))
    const admission: AdmissionInput = {
      fullName: name,
      joiningDate,
      notes: note.slice(0, 2000),
      homeAddress: clean(col(r, 'address')),
      photo: null,
      family: { kind: 'new', father, mother, emergency: { ...emergency, relationship: '', phone: emergency.phone ?? '' }, extra: [], feeContact },
      programs: enrollments,
      admissionFee: '',
      dateOfBirth: dob,
      afterschool,
      otherSchool: afterschool ? otherSchool || 'Not on the form' : '',
      otherSchoolClass: afterschool ? clean(col(r, 'classWritten')).slice(0, 40) : ''
    }

    // A sibling shares the family already entered, so only the child's own details must be valid.
    const check = admissionSchema.safeParse(familyOf === null ? admission : { ...admission, family: { kind: 'sibling', siblingId: '00000000-0000-4000-8000-000000000000' } })
    const skip = check.success ? null : `Can't be read: ${check.error.issues[0]?.message ?? 'check the row'}`
    items.push({ ...base, programs, siblingOf: familyOf === null ? null : items[familyOf]!.name, admission, familyOf, skip })
  })
  return items
}
