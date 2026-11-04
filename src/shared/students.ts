// Types shared by the Students module (main process ⇄ UI).

export const STUDENT_STATUSES = ['active', 'inactive', 'graduated'] as const
export type StudentStatus = (typeof STUDENT_STATUSES)[number]

export const STATUS_LABEL: Record<StudentStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  graduated: 'Graduated'
}

export const PAGE_SIZE = 25

export interface StudentListQuery {
  search: string
  status: StudentStatus
  /** 0-based */
  page: number
}

export interface ContactSummary {
  name: string | null
  relationship: string
  phone: string | null
}

export interface StudentListRow {
  id: string
  code: string
  fullName: string
  joiningDate: string
  status: StudentStatus
  mainContact: ContactSummary | null
}

export interface StudentListResult {
  rows: StudentListRow[]
  total: number
  counts: Record<StudentStatus, number>
}

export interface GuardianLink {
  linkId: string
  guardianId: string
  name: string | null
  phone: string | null
  relationship: string
  isFeeContact: boolean
  isEmergency: boolean
  /** Brothers/sisters who share this guardian (editing name/phone changes it for them too). */
  sharedWith: { id: string; fullName: string }[]
}

export interface StudentNote {
  id: string
  title: string
  details: string
  important: boolean
}

export interface StudentProfile {
  id: string
  code: string
  fullName: string
  joiningDate: string
  status: StudentStatus
  homeAddress: string
  /** JPEG data URL, or null when there is no photo. */
  photo: string | null
  guardians: GuardianLink[]
  notes: StudentNote[]
}

export type Result<T = void> = { ok: true; value: T } | { ok: false; message: string }
