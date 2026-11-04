import type { LockStatus } from '@shared/ipc-contract'
import { IdleTimer } from './idle-timer'
import type { PinAuth } from './pin-auth'

/**
 * The main process decides whether the app is unlocked; the UI only displays it.
 * Later modules' IPC handlers call `requireUnlocked()` before touching any data.
 */
export class LockSession {
  private unlocked = false
  private readonly idle: IdleTimer
  private readonly interval: NodeJS.Timeout

  constructor(
    private readonly auth: PinAuth,
    idleMs: number,
    private readonly notify: (status: LockStatus) => void
  ) {
    this.idle = new IdleTimer(idleMs, () => this.lock())
    this.interval = setInterval(() => this.unlocked && this.idle.check(), Math.min(5_000, idleMs / 4))
  }

  status(): LockStatus {
    if (!this.auth.isSetUp()) return { state: 'needs-setup' }
    if (this.unlocked) return { state: 'unlocked' }
    return { state: 'locked', ...this.auth.attemptState() }
  }

  isUnlocked(): boolean {
    return this.unlocked
  }

  requireUnlocked(): void {
    if (!this.unlocked) throw new Error('Little Hands is locked')
  }

  /**
   * `announce: false` is used after PIN setup/reset: the UI first shows the new recovery code
   * and switches to the main screen itself, so no "unlocked" event should race ahead of it.
   */
  setUnlocked({ announce = true } = {}): void {
    this.unlocked = true
    this.idle.touch()
    if (announce) this.notify(this.status())
  }

  lock(): void {
    if (!this.unlocked) return
    this.unlocked = false
    this.notify(this.status())
  }

  activity(): void {
    if (this.unlocked) this.idle.touch()
  }

  dispose(): void {
    clearInterval(this.interval)
  }
}
