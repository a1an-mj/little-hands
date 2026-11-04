// The typed API the preload script exposes to the UI as `window.lh`.
// All data access lives in the main process; the UI only talks through this.

export type Theme = 'light' | 'dark'

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
