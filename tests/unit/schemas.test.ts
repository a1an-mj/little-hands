import { describe, expect, it } from 'vitest'
import { admissionSchema, fieldErrors, guardianSchema, isoDateSchema, type AdmissionInput } from '@shared/schemas'
import { newFamilyAdmission } from './fixtures'


const errorsOf = (input: AdmissionInput) => {
  const r = admissionSchema.safeParse(input)
  return r.success ? {} : fieldErrors(r.error)
}

describe('isoDateSchema', () => {
  it('accepts real dates only', () => {
    expect(isoDateSchema.safeParse('2026-02-28').success).toBe(true)
    expect(isoDateSchema.safeParse('2026-02-30').success).toBe(false)
    expect(isoDateSchema.safeParse('3 Jun 2026').success).toBe(false)
    expect(isoDateSchema.safeParse('1990-01-01').success).toBe(false)
  })
})

describe('admissionSchema', () => {
  it('accepts a complete form and normalises phones and spaces', () => {
    const r = admissionSchema.parse(newFamilyAdmission({ fullName: '  Aadhya Menon ' }))
    expect(r.fullName).toBe('Aadhya Menon')
    if (r.family.kind !== 'new') throw new Error('expected new family')
    expect(r.family.father.phone).toBe('+919000000014')
    expect(r.family.mother.phone).toBeNull()
  })

  it('needs a name, a joining date and an emergency phone', () => {
    const base = newFamilyAdmission()
    const errors = errorsOf({
      ...base,
      fullName: ' ',
      joiningDate: '',
      family: { ...(base.family as Extract<AdmissionInput['family'], { kind: 'new' }>), emergency: { name: '', relationship: '', phone: '' } }
    })
    expect(Object.keys(errors).sort()).toEqual(['family.emergency.phone', 'fullName', 'joiningDate'])
  })

  it('reports a badly typed phone next to its field', () => {
    const base = newFamilyAdmission()
    const f = base.family as Extract<AdmissionInput['family'], { kind: 'new' }>
    expect(errorsOf({ ...base, family: { ...f, mother: { name: 'L', phone: '12345' } } })).toEqual({
      'family.mother.phone': 'Enter a 10-digit phone number'
    })
  })

  it('the main contact for fees must be someone filled in', () => {
    const base = newFamilyAdmission()
    const f = base.family as Extract<AdmissionInput['family'], { kind: 'new' }>
    expect(errorsOf({ ...base, family: { ...f, feeContact: 'mother', mother: { name: '', phone: '' } } })).toHaveProperty(
      'family.feeContact'
    )
    expect(errorsOf({ ...base, family: { ...f, feeContact: 'extra-0' } })).toHaveProperty('family.feeContact')
    expect(errorsOf({ ...base, family: { ...f, feeContact: 'nobody' } })).toHaveProperty('family.feeContact')
  })

  it('an extra guardian needs a relationship', () => {
    const base = newFamilyAdmission()
    const f = base.family as Extract<AdmissionInput['family'], { kind: 'new' }>
    expect(
      errorsOf({ ...base, family: { ...f, extra: [{ name: 'Joseph', phone: '', relationship: '' }] } })
    ).toEqual({ 'family.extra.0.relationship': 'Say how they are related' })
  })

  it('sibling admissions only need the sibling', () => {
    const r = admissionSchema.safeParse(
      newFamilyAdmission({ family: { kind: 'sibling', siblingId: '6f1c1a49-7f0e-4b6d-9a57-0d7a0c1f2b11' } })
    )
    expect(r.success).toBe(true)
  })
})

describe('guardianSchema', () => {
  it('needs a name or a phone, and a relationship', () => {
    expect(guardianSchema.safeParse({ name: '', phone: '', relationship: 'Uncle', isEmergency: false }).success).toBe(false)
    expect(guardianSchema.safeParse({ name: 'Joseph', phone: '', relationship: '', isEmergency: false }).success).toBe(false)
    expect(guardianSchema.safeParse({ name: '', phone: '9000000099', relationship: 'Uncle', isEmergency: true }).success).toBe(true)
  })
})
