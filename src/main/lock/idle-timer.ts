export const IDLE_LOCK_MS = 10 * 60 * 1000

/**
 * Tracks the last time the owner used the app. `check()` is called on an interval
 * and fires `onIdle` once when the timeout has passed. Pure (clock injected) so it can be unit-tested.
 */
export class IdleTimer {
  private last: number
  private fired = false

  constructor(
    private readonly timeoutMs: number,
    private readonly onIdle: () => void,
    private readonly now: () => number = Date.now
  ) {
    this.last = now()
  }

  touch(): void {
    this.last = this.now()
    this.fired = false
  }

  check(): void {
    if (!this.fired && this.now() - this.last >= this.timeoutMs) {
      this.fired = true
      this.onIdle()
    }
  }
}
