import type { AdmissionInput, EnrollmentInput } from '@shared/schemas'

/** One program as the admission form would send it (LKG, Mon–Fri, ₹1,500 a month). */
export function lkgEnrollment(overrides: Partial<EnrollmentInput> = {}): EnrollmentInput {
  return {
    program: 'lk',
    startDate: '2026-06-03',
    schedule: { days: 31, arrives: '08:45', leaves: '12:30' },
    fee: { frequency: 'monthly', customLabel: '', standard: '1500', concession: '', concessionReason: '', remarks: '' },
    ...overrides
  }
}

/** A filled-in admission form for a new family, as the UI would send it. */
export function newFamilyAdmission(overrides: Partial<AdmissionInput> = {}): AdmissionInput {
  return {
    fullName: 'Aadhya Menon',
    joiningDate: '2026-06-03',
    notes: '',
    homeAddress: '',
    photo: null,
    family: {
      kind: 'new',
      father: { name: 'Suresh Menon', phone: '90000 00014' },
      mother: { name: 'Lakshmi Menon', phone: '' },
      emergency: { name: 'Sarojini Amma', relationship: 'Grandmother', phone: '90000 00016' },
      extra: [],
      feeContact: 'father'
    },
    programs: [lkgEnrollment({ startDate: overrides.joiningDate ?? '2026-06-03' })],
    ...overrides
  }
}
