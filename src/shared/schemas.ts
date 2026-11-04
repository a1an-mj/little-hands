import { z } from 'zod'
import { normalizePhone } from './phone'
import { STUDENT_STATUSES } from './students'

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

const person = z.object({ name: text(100), phone: phoneSchema })
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

const siblingFamily = z.object({ kind: z.literal('sibling'), siblingId: idSchema })

export const admissionSchema = z.object({
  fullName: text(100).min(1, "Enter the child's full name"),
  joiningDate: isoDateSchema,
  notes: text(2000),
  homeAddress: text(500),
  /** JPEG data URL from the photo picker, or null. */
  photo: z.string().max(2_000_000).nullable(),
  family: z.discriminatedUnion('kind', [newFamily, siblingFamily])
})
export type AdmissionInput = z.input<typeof admissionSchema>
export type Admission = z.output<typeof admissionSchema>

export const studentDetailsSchema = z.object({
  fullName: text(100).min(1, "Enter the child's full name"),
  joiningDate: isoDateSchema,
  status: z.enum(STUDENT_STATUSES),
  homeAddress: text(500)
})
export type StudentDetailsInput = z.input<typeof studentDetailsSchema>

export const guardianSchema = z
  .object({
    name: text(100),
    phone: phoneSchema,
    relationship: text(40).min(1, 'Say how they are related (e.g. Father, Grandmother)'),
    isEmergency: z.boolean()
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
