import { describe, expect, it, vi } from 'vitest'
import { IDLE_LOCK_MS, IdleTimer } from '../../src/main/lock/idle-timer'

function setup() {
  let now = 0
  const onIdle = vi.fn()
  const timer = new IdleTimer(IDLE_LOCK_MS, onIdle, () => now)
  return { timer, onIdle, advance: (ms: number) => (now += ms) }
}

describe('IdleTimer', () => {
  it('is 10 minutes', () => {
    expect(IDLE_LOCK_MS).toBe(600_000)
  })

  it('does not fire before 10 minutes', () => {
    const { timer, onIdle, advance } = setup()
    advance(IDLE_LOCK_MS - 1)
    timer.check()
    expect(onIdle).not.toHaveBeenCalled()
  })

  it('fires once at 10 minutes, not again until used', () => {
    const { timer, onIdle, advance } = setup()
    advance(IDLE_LOCK_MS)
    timer.check()
    timer.check()
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('activity restarts the 10 minutes', () => {
    const { timer, onIdle, advance } = setup()
    advance(IDLE_LOCK_MS - 1000)
    timer.touch()
    advance(IDLE_LOCK_MS - 1000)
    timer.check()
    expect(onIdle).not.toHaveBeenCalled()
    advance(1000)
    timer.check()
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('can fire again after activity', () => {
    const { timer, onIdle, advance } = setup()
    advance(IDLE_LOCK_MS)
    timer.check()
    timer.touch()
    advance(IDLE_LOCK_MS)
    timer.check()
    expect(onIdle).toHaveBeenCalledTimes(2)
  })
})
