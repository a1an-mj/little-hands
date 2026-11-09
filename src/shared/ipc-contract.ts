// The typed API the preload script exposes to the UI as `window.lh`.
// All data access lives in the main process; the UI only talks through this.

import type { ProgramDefaults } from './enrollments'
import type {
  AdmissionInput,
  EndEnrollmentInput,
  EnrollmentEditInput,
  EnrollmentInput,
  GuardianInput,
  NoteInput,
  StudentDetailsInput
} from './schemas'
import type { Result, StudentListQuery, StudentListResult, StudentProfile } from './students'

export type Theme = 'light' | 'dark'

/** Every call needs the app to be unlocked. Problems the owner can fix come back as `{ ok: false, message }`. */
export interface StudentsApi {
  list(query: StudentListQuery): Promise<Result<StudentListResult>>
  nextCode(joiningDate: string): Promise<Result<string>>
  profile(id: string): Promise<Result<StudentProfile | null>>
  admit(input: AdmissionInput): Promise<Result<string>>
  updateDetails(id: string, input: StudentDetailsInput): Promise<Result>
  remove(id: string): Promise<Result>
  /** Opens the file picker; returns a JPEG data URL to preview, or null if cancelled. */
  pickPhoto(): Promise<Result<string | null>>
  setPhoto(id: string, photo: string | null): Promise<Result>
  addGuardian(studentId: string, input: GuardianInput): Promise<Result<string>>
  updateGuardian(linkId: string, input: GuardianInput): Promise<Result>
  setFeeContact(linkId: string): Promise<Result>
  removeGuardian(linkId: string): Promise<Result>
  addNote(studentId: string, input: NoteInput): Promise<Result<string>>
  updateNote(noteId: string, input: NoteInput): Promise<Result>
  removeNote(noteId: string): Promise<Result>
}

export const STUDENTS_METHODS = [
  'list', 'nextCode', 'profile', 'admit', 'updateDetails', 'remove', 'pickPhoto', 'setPhoto',
  'addGuardian', 'updateGuardian', 'setFeeContact', 'removeGuardian', 'addNote', 'updateNote', 'removeNote'
] as const satisfies readonly (keyof StudentsApi)[]

/** Programs a child attends, with timings and fees. Same rules as StudentsApi. */
export interface EnrollmentsApi {
  /** Default days/timings per program, plus the last standard fee used, for pre-filling forms. */
  defaults(): Promise<Result<ProgramDefaults[]>>
  add(studentId: string, input: EnrollmentInput): Promise<Result<string>>
  edit(enrollmentId: string, input: EnrollmentEditInput): Promise<Result>
  end(enrollmentId: string, input: EndEnrollmentInput): Promise<Result>
  /** Undoes "End": the child continues. */
  resume(enrollmentId: string): Promise<Result>
  /** "Added by mistake". */
  remove(enrollmentId: string): Promise<Result>
}

export const ENROLLMENTS_METHODS = ['defaults', 'add', 'edit', 'end', 'resume', 'remove'] as const satisfies readonly (keyof EnrollmentsApi)[]

export type LockStatus =
  | { state: 'needs-setup' }
  | { state: 'locked'; triesLeft: number; waitUntil: number | null }
  | { state: 'unlocked' }

export type AttemptResult =
  | { ok: true }
  | { ok: false; reason: 'wrong'; triesLeft: number; waitUntil: number | null }
  | { ok: false; reason: 'wait'; waitUntil: number }

export type ResetResult = { ok: true; recoveryCode: string } | Exclude<AttemptResult, { ok: true }>

export interface LhApi {
  lock: {
    status(): Promise<LockStatus>
    /** First run only: sets the PIN, unlocks, and returns the recovery code to show once. */
    setup(pin: string): Promise<{ recoveryCode: string }>
    unlock(pin: string): Promise<AttemptResult>
    /** Checks a recovery code without changing anything (counts as an attempt). */
    checkRecovery(code: string): Promise<AttemptResult>
    /** Sets a new PIN using the recovery code; returns a fresh recovery code. */
    resetWithRecovery(code: string, newPin: string): Promise<ResetResult>
    lockNow(): Promise<void>
    /** Tells the main process the owner is using the app (resets the idle timer). */
    activity(): void
    onChange(listener: (status: LockStatus) => void): () => void
  }
  theme: {
    /** The theme to show right now: the owner's saved choice, or else the system (Windows) setting. */
    readonly initial: Theme
    /** Remembers the owner's choice from now on. */
    set(theme: Theme): Promise<void>
    /** Fires when the system setting changes (before a choice is made) or after `set`. */
    onChange(listener: (theme: Theme) => void): () => void
  }
  students: StudentsApi
  enrollments: EnrollmentsApi
}

export const IPC = {
  lockStatus: 'lock:status',
  lockSetup: 'lock:setup',
  lockUnlock: 'lock:unlock',
  lockCheckRecovery: 'lock:check-recovery',
  lockReset: 'lock:reset',
  lockNow: 'lock:now',
  lockActivity: 'lock:activity',
  lockChanged: 'lock:changed',
  themeInitial: 'theme:initial',
  themeSet: 'theme:set',
  themeChanged: 'theme:changed'
} as const
