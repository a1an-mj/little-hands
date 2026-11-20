import { z } from 'zod'
import { normalizePhone } from './phone'
import { AFTERSCHOOL_CODES, PROGRAM_CODES, isExtra, isKnownPeriod } from './enrollments'
import { parseRupees } from './money'
import { STUDENT_STATUSES } from './students'
import { EVENT_KINDS } from './planner'

export const pinSchema = z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits')

// Loose check here; the main process normalises and validates the exact format.
export const recoveryCodeInputSchema = z.string().min(1).max(64)

export const themeSchema = z.enum(['light', 'dark'])

// ---------- Students ----------

export const idSchema = z.string().uuid()

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date')
  .refine((s) => {
    const d = new Date(s + 'T00:00:00Z')
    const y = d.getUTCFullYear()
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s) && y >= 2000 && y <= 2100
  }, 'Choose a valid date')

const text = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters`)

/** Empty → null; otherwise must be a valid phone number (stored as +91…). */
export const phoneSchema = z
  .string()
  .trim()
  .transform((s, ctx) => {
    if (!s) return null
    const p = normalizePhone(s)
    if (!p) {
      ctx.addIssue({ code: 'custom', message: 'Enter a 10-digit phone number' })
      return z.NEVER
    }
    return p
  })

const person = z.object({ name: text(100), phone: phoneSchema, occupation: text(60).default('') })
const isEmpty = (p: { name: string; phone: string | null }) => !p.name && !p.phone

export const FEE_CONTACT_KEYS = ['father', 'mother', 'emergency'] as const

const newFamily = z
  .object({
    kind: z.literal('new'),
    father: person,
    mother: person,
    emergency: z.object({ name: text(100), relationship: text(40), phone: phoneSchema }),
    extra: z.array(person.extend({ relationship: text(40) })).max(6),
    /** 'father' | 'mother' | 'emergency' | 'extra-<index>' */
    feeContact: z.string()
  })
  .superRefine((f, ctx) => {
    if (!f.emergency.phone) {
      ctx.addIssue({ code: 'custom', path: ['emergency', 'phone'], message: 'An emergency phone number is needed' })
    }
    f.extra.forEach((g, i) => {
      if (!isEmpty(g) && !g.relationship) {
        ctx.addIssue({ code: 'custom', path: ['extra', i, 'relationship'], message: 'Say how they are related' })
      }
    })
    const target =
      f.feeContact === 'father' ? f.father
      : f.feeContact === 'mother' ? f.mother
      : f.feeContact === 'emergency' ? f.emergency
      : /^extra-\d+$/.test(f.feeContact) ? f.extra[Number(f.feeContact.slice(6))]
      : undefined
    if (!target || isEmpty(target)) {
      ctx.addIssue({ code: 'custom', path: ['feeContact'], message: 'Choose who pays the fees (fill in their name or phone first)' })
    }
  })

// ---------- Programs, timings & fees ----------

export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose a time')

/** The days a child comes for a program. There are no fixed times (owner, Nov 2026). */
export const scheduleInputSchema = z.object({
  days: z.number().int().min(1, 'Choose at least one day').max(127)
})

/** Rupees as typed ("1,500") → paise. Empty is 0 unless the amount is required. */
const rupees = (required: boolean) =>
  z.string().transform((s, ctx) => {
    if (!s.trim()) {
      if (!required) return 0
      ctx.addIssue({ code: 'custom', message: 'Enter the fee' })
      return z.NEVER
    }
    const paise = parseRupees(s)
    if (paise === null) {
      ctx.addIssue({ code: 'custom', message: 'Enter an amount in rupees, e.g. 1500' })
      return z.NEVER
    }
    return paise
  })

export const feeInputSchema = z
  .object({
    periodMonths: z.number().int().refine(isKnownPeriod, 'Choose how often the fee is paid'),
    dueDay: z
      .string()
      .trim()
      .regex(/^\d{1,2}$/, 'Enter a day of the month, 1 to 31')
      .transform(Number)
      .refine((d) => d >= 1 && d <= 31, 'Enter a day of the month, 1 to 31'),
    standard: rupees(true),
    concession: rupees(false),
    concessionReason: text(100),
    remarks: text(500)
  })
  .superRefine((f, ctx) => {
    if (f.concession > f.standard) {
      ctx.addIssue({ code: 'custom', path: ['concession'], message: "Can't be more than the standard fee" })
    }
    if (f.concession > 0 && !f.concessionReason) {
      ctx.addIssue({ code: 'custom', path: ['concessionReason'], message: 'Say why there is a concession' })
    }
  })
export type FeeInput = z.input<typeof feeInputSchema>
export type Fee = z.output<typeof feeInputSchema>

export const enrollmentInputSchema = z
  .object({
    program: z.enum(PROGRAM_CODES),
    startDate: isoDateSchema,
    /** The days the child comes. Not used for extras (karate, dance, transport). */
    schedule: scheduleInputSchema.optional(),
    fee: feeInputSchema
  })
  .superRefine((e, ctx) => {
    if (!isExtra(e.program) && !e.schedule) ctx.addIssue({ code: 'custom', path: ['schedule', 'days'], message: 'Choose at least one day' })
  })
export type EnrollmentInput = z.input<typeof enrollmentInputSchema>
export type Enrollment = z.output<typeof enrollmentInputSchema>

/**
 * Editing a program. `mode: 'fix'` corrects the current timings/fee in place (a mistake);
 * `mode: 'change'` keeps the old ones and starts the new ones on `from`.
 */
export const enrollmentEditSchema = z
  .object({
    startDate: isoDateSchema,
    /** Left out for extras (no days). */
    schedule: scheduleInputSchema.optional(),
    fee: feeInputSchema,
    mode: z.enum(['fix', 'change']),
    from: z.string()
  })
  .superRefine((e, ctx) => {
    if (e.mode === 'change' && !isoDateSchema.safeParse(e.from).success) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'Choose the date the change starts' })
    }
  })
export type EnrollmentEditInput = z.input<typeof enrollmentEditSchema>
export type EnrollmentEdit = z.output<typeof enrollmentEditSchema>

export const endEnrollmentSchema = z.object({
  endDate: isoDateSchema,
  reason: text(100)
})
export type EndEnrollmentInput = z.input<typeof endEnrollmentSchema>

const siblingFamily = z.object({ kind: z.literal('sibling'), siblingId: idSchema })

/** From the paper admission form: date of birth, and the other school of an "afterschool" child. */
const childExtras = {
  dateOfBirth: z.union([isoDateSchema, z.literal('')]).default(''),
  /** Studies at another school and comes here after school (then in Tuition or Daycare). */
  afterschool: z.boolean().default(false),
  otherSchool: text(100).default(''),
  otherSchoolClass: text(40).default('')
}
function checkChildExtras(c: { dateOfBirth: string; joiningDate: string; afterschool: boolean; otherSchool: string }, ctx: z.RefinementCtx) {
  if (c.dateOfBirth && c.dateOfBirth >= c.joiningDate) {
    ctx.addIssue({ code: 'custom', path: ['dateOfBirth'], message: 'The date of birth must be before the joining date' })
  }
  if (c.afterschool && !c.otherSchool) {
    ctx.addIssue({ code: 'custom', path: ['otherSchool'], message: 'Enter the school the child goes to' })
  }
}

export const admissionSchema = z.object({
  fullName: text(100).min(1, "Enter the child's full name"),
  joiningDate: isoDateSchema,
  notes: text(2000),
  homeAddress: text(500),
  /** JPEG data URL from the photo picker, or null. */
  photo: z.string().max(2_000_000).nullable(),
  family: z.discriminatedUnion('kind', [newFamily, siblingFamily]),
  programs: z.array(enrollmentInputSchema).min(1, 'Tick at least one program').max(PROGRAM_CODES.length),
  /** One-time admission fee in rupees, paid before joining (owner). Empty = none. */
  admissionFee: rupees(false).optional(),
  ...childExtras
}).superRefine((a, ctx) => {
  checkChildExtras(a, ctx)
  if (a.afterschool && !a.programs.some((p) => AFTERSCHOOL_CODES.includes(p.program))) {
    ctx.addIssue({ code: 'custom', path: ['programs'], message: 'A child who comes after school must be in Tuition or Daycare' })
  }
  const seen = new Set<string>()
  a.programs.forEach((p, i) => {
    if (seen.has(p.program)) ctx.addIssue({ code: 'custom', path: ['programs', i, 'program'], message: 'This program is ticked twice' })
    seen.add(p.program)
    if (p.startDate < a.joiningDate) {
      ctx.addIssue({ code: 'custom', path: ['programs', i, 'startDate'], message: "Can't be before the joining date" })
    }
  })
})
export type AdmissionInput = z.input<typeof admissionSchema>
export type Admission = z.output<typeof admissionSchema>

export const studentDetailsSchema = z
  .object({
    fullName: text(100).min(1, "Enter the child's full name"),
    joiningDate: isoDateSchema,
    status: z.enum(STUDENT_STATUSES),
    homeAddress: text(500),
    ...childExtras
  })
  .superRefine(checkChildExtras)
export type StudentDetailsInput = z.input<typeof studentDetailsSchema>

export const guardianSchema = z
  .object({
    name: text(100),
    phone: phoneSchema,
    relationship: text(40).min(1, 'Say how they are related (e.g. Father, Grandmother)'),
    isEmergency: z.boolean(),
    occupation: text(60).default('')
  })
  .refine((g) => g.name || g.phone, { path: ['name'], message: 'Enter a name or a phone number' })
export type GuardianInput = z.input<typeof guardianSchema>

export const noteSchema = z.object({
  title: text(100).min(1, 'Give the note a short title'),
  details: text(2000),
  important: z.boolean()
})
export type NoteInput = z.input<typeof noteSchema>

export const studentListQuerySchema = z.object({
  search: z.string().max(100),
  status: z.enum(STUDENT_STATUSES),
  program: z.enum(['all', ...PROGRAM_CODES]).default('all'),
  page: z.number().int().min(0).max(10_000)
})

/** Turns zod issues into { "family.emergency.phone": "message" } for showing next to fields. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.')
    if (!(key in out)) out[key] = issue.message
  }
  return out
}

// ---------- Attendance ----------

/** A button on the dashboard: the time is taken from the laptop's clock in the main process. */
export const attendanceTapSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('arrived') }),
  z.object({ kind: z.literal('left') }),
  z.object({ kind: z.literal('absent'), note: text(100).default('') })
])
export type AttendanceTap = z.input<typeof attendanceTapSchema>

/** What a day should say, from the attendance screen or a correction on the profile. */
export const attendanceDaySchema = z
  .object({
    status: z.enum(['none', 'present', 'absent']),
    /** "HH:MM" or empty. */
    arrived: z.union([timeSchema, z.literal('')]).default(''),
    left: z.union([timeSchema, z.literal('')]).default(''),
    note: text(100).default('')
  })
  .superRefine((d, ctx) => {
    if (d.status !== 'present') return
    if (d.left && !d.arrived) ctx.addIssue({ code: 'custom', path: ['arrived'], message: 'Enter the arrival time too' })
    if (d.left && d.arrived && d.left < d.arrived) ctx.addIssue({ code: 'custom', path: ['left'], message: 'Leaving time must be after arrival' })
  })
export type AttendanceDayInput = z.input<typeof attendanceDaySchema>

export const closeDaySchema = z.object({ reason: text(100).default('') })
export type CloseDayInput = z.input<typeof closeDaySchema>

export const attendanceManySchema = z
  .array(z.object({ enrollmentId: idSchema, day: attendanceDaySchema }))
  .max(1000)

// ---------- Payments ----------

/** A positive amount in rupees, as typed. */
const amount = (missing: string) =>
  z.string().transform((s, ctx) => {
    const paise = s.trim() ? parseRupees(s) : null
    if (paise === null || paise <= 0) {
      ctx.addIssue({ code: 'custom', message: s.trim() ? 'Enter an amount in rupees, e.g. 1500' : missing })
      return z.NEVER
    }
    return paise
  })

export const PAYMENT_METHODS = ['cash', 'upi', 'bank'] as const

/** What a payment is for: one period of a program, or one extra charge. */
export const paymentTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('period'), enrollmentId: idSchema, periodStart: isoDateSchema }),
  z.object({ kind: z.literal('charge'), chargeId: idSchema })
])
export type PaymentTarget = z.infer<typeof paymentTargetSchema>

export const paymentInputSchema = z.object({
  studentId: idSchema,
  target: paymentTargetSchema,
  amount: amount('Enter the amount received'),
  method: z.enum(PAYMENT_METHODS, { message: 'Choose how it was paid' }),
  reference: text(40),
  /** Local date and time, "YYYY-MM-DDTHH:MM". */
  paidAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, 'Choose the date and time')
    .refine((s) => isoDateSchema.safeParse(s.slice(0, 10)).success, 'Choose a valid date'),
  recordedBy: text(60).min(1, 'Choose who received the money'),
  remarks: text(200)
})
export type PaymentInput = z.input<typeof paymentInputSchema>

export const reversalSchema = z.object({
  reason: text(200).min(1, 'Say why this payment is being reversed'),
  recordedBy: text(60).min(1, 'Choose who is doing this')
})
export type ReversalInput = z.input<typeof reversalSchema>

export const CHARGE_KINDS = ['admission', 'fine', 'other'] as const

export const chargeInputSchema = z.object({
  kind: z.enum(CHARGE_KINDS),
  label: text(60).min(1, 'Say what the charge is for'),
  amount: amount('Enter the amount'),
  dueDate: isoDateSchema,
  reason: text(200)
})
export type ChargeInput = z.input<typeof chargeInputSchema>

export const waiverSchema = z.object({ reason: text(200).min(1, 'Say why this period is not charged') })
export type WaiverInput = z.input<typeof waiverSchema>

// ---------- Moving up a class ----------

/** "Move up to the next class" (one child or a whole class): from a date, at the next class's fee. */
export const moveUpSchema = z.object({
  from: isoDateSchema,
  /** The new standard fee in rupees (any concession is kept). */
  standard: rupees(true)
})
export type MoveUpInput = z.input<typeof moveUpSchema>
export type MoveUp = z.output<typeof moveUpSchema>

// ---------- Calendar & to-do ----------

export const eventInputSchema = z.object({
  title: text(100).min(1, 'Enter a title'),
  date: isoDateSchema,
  /** Empty = all day. */
  time: z.union([timeSchema, z.literal('')]).default(''),
  kind: z.enum(EVENT_KINDS),
  notes: text(1000).default('')
})
export type EventInput = z.input<typeof eventInputSchema>

export const todoInputSchema = z.object({
  title: text(200).min(1, 'Enter what needs doing'),
  notes: text(2000).default(''),
  /** Empty = no date. */
  dueDate: z.union([isoDateSchema, z.literal('')]).default(''),
  studentId: idSchema.nullable().default(null)
})
export type TodoInput = z.input<typeof todoInputSchema>

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month')
