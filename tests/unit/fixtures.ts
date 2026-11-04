import type { AdmissionInput } from '@shared/schemas'

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
    ...overrides
  }
}
