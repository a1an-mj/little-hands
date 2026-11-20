// The typed API the preload script exposes to the UI as `window.lh`.
// All data access lives in the main process; the UI only talks through this.

import type { DashboardSummary, DayView, ProgramHistory } from './attendance'
import type { BackupPreview, BackupStatus } from './backup'
import type { ProgramDefaults } from './enrollments'
import type { FeesOverview, MonthReport, StudentFees } from './payments'
import type {
  AdmissionInput,
  AttendanceDayInput,
  AttendanceTap,
  ChargeInput,
  CloseDayInput,
  PaymentInput,
  ReversalInput,
  WaiverInput,
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

/** Attendance (append-only) and the dashboard figures. Same rules as StudentsApi. */
export interface AttendanceApi {
  /** Everyone expected on a day ("YYYY-MM-DD", default today), with what has been marked. */
  day(date?: string): Promise<Result<DayView>>
  /** A child's last school days, per program, newest first. */
  history(studentId: string): Promise<Result<{ today: string; now: string; programs: ProgramHistory[] }>>
  summary(): Promise<Result<DashboardSummary>>
  /** Dashboard buttons, for today at the laptop's current time. Returns the event (for Undo) and the time used. */
  tap(enrollmentId: string, input: AttendanceTap): Promise<Result<{ eventId: string; at: string }>>
  undo(eventId: string): Promise<Result>
  /** Sets what one day says (a correction). */
  setDay(enrollmentId: string, date: string, input: AttendanceDayInput): Promise<Result>
  /** "School closed" for a day (holiday), with an optional reason. */
  closeDay(date: string, input: CloseDayInput): Promise<Result>
  reopenDay(date: string): Promise<Result>
  /** The attendance screen's Save. */
  setMany(date: string, items: { enrollmentId: string; day: AttendanceDayInput }[]): Promise<Result>
}

export const ATTENDANCE_METHODS = ['day', 'history', 'summary', 'tap', 'undo', 'setDay', 'setMany', 'closeDay', 'reopenDay'] as const satisfies readonly (keyof AttendanceApi)[]

/** Payments (append-only), charges and waivers. Same rules as StudentsApi. */
export interface PaymentsApi {
  /** A child's periods, charges and payment history. */
  forStudent(studentId: string): Promise<Result<StudentFees>>
  /** This month's money and everyone who owes (dashboard, Fees screen). */
  overview(): Promise<Result<FeesOverview>>
  /** "YYYY-MM" */
  monthReport(month: string): Promise<Result<MonthReport>>
  /** Names that recorded payments before ("Recorded by"). */
  recorders(): Promise<Result<string[]>>
  record(input: PaymentInput): Promise<Result<{ id: string; no: string }>>
  reverse(paymentId: string, input: ReversalInput): Promise<Result<{ id: string; no: string }>>
  addCharge(studentId: string, input: ChargeInput): Promise<Result<string>>
  cancelCharge(chargeId: string): Promise<Result>
  waive(enrollmentId: string, periodStart: string, input: WaiverInput): Promise<Result>
  unwaive(enrollmentId: string, periodStart: string): Promise<Result>
}

export const PAYMENTS_METHODS = [
  'forStudent', 'overview', 'monthReport', 'recorders', 'record', 'reverse', 'addCharge', 'cancelCharge', 'waive', 'unwaive'
] as const satisfies readonly (keyof PaymentsApi)[]

/** Encrypted backups and restore. Same rules as StudentsApi; the restore methods also work before a PIN is set. */
export interface BackupApi {
  status(): Promise<Result<BackupStatus>>
  /** Opens the folder picker; null if cancelled. */
  pickFolder(): Promise<Result<string | null>>
  /** Folder + backup password; makes the first backup. Returns its path. */
  setUp(folder: string, password: string): Promise<Result<string>>
  changeFolder(folder: string): Promise<Result<string>>
  changePassword(password: string): Promise<Result<string>>
  backupNow(): Promise<Result<string>>
  /** Shows the backup folder in Explorer. */
  openFolder(): Promise<Result>
  /** Opens the file picker for a backup; null if cancelled. */
  pickFile(): Promise<Result<string | null>>
  /** What's inside a backup (needs its password). Changes nothing. */
  inspect(path: string, password: string): Promise<Result<BackupPreview>>
  /** Replaces this laptop's data with the backup, then the app restarts. */
  restore(path: string, password: string): Promise<Result>
}

export const BACKUP_METHODS = [
  'status', 'pickFolder', 'setUp', 'changeFolder', 'changePassword', 'backupNow', 'openFolder', 'pickFile', 'inspect', 'restore'
] as const satisfies readonly (keyof BackupApi)[]

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
  attendance: AttendanceApi
  payments: PaymentsApi
  backup: BackupApi
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
