import { beforeEach, describe, expect, it } from 'vitest'
import type { KeyValueStore } from '../../src/main/db/settings-store'
import { MAX_TRIES, PinAuth, WAIT_MS, hashSecret, verifySecret } from '../../src/main/lock/pin-auth'

class MemoryStore implements KeyValueStore {
  data = new Map<string, string>()
  get(key: string) {
    return this.data.get(key)
  }
  setMany(entries: Record<string, string | null>) {
    for (const [k, v] of Object.entries(entries)) v === null ? this.data.delete(k) : this.data.set(k, v)
  }
}

describe('hashSecret / verifySecret', () => {
  it('verifies the right secret and rejects a wrong one', async () => {
    const stored = await hashSecret('1234')
    expect(await verifySecret('1234', stored)).toBe(true)
    expect(await verifySecret('1235', stored)).toBe(false)
  })

  it('never stores the PIN itself, and salts every hash', async () => {
    const a = await hashSecret('1234')
    const b = await hashSecret('1234')
    expect(a).not.toContain('1234')
    expect(a).not.toBe(b)
    expect(a.startsWith('scrypt$')).toBe(true)
  })

  it('rejects a damaged hash', async () => {
    expect(await verifySecret('1234', 'garbage')).toBe(false)
  })
})

describe('PinAuth', () => {
  let store: MemoryStore
  let now: number
  let auth: PinAuth

  beforeEach(() => {
    store = new MemoryStore()
    now = 1_000_000
    auth = new PinAuth(store, () => now)
  })

  it('starts not set up, and sets up once', async () => {
    expect(auth.isSetUp()).toBe(false)
    const code = await auth.setup('2468')
    expect(code).toMatch(/^[0-9A-Z]{16}$/)
    expect(auth.isSetUp()).toBe(true)
    await expect(auth.setup('1111')).rejects.toThrow()
  })

  it('unlocks with the right PIN only', async () => {
    await auth.setup('2468')
    expect(await auth.unlock('2468')).toEqual({ ok: true })
    expect(await auth.unlock('8642')).toMatchObject({ ok: false, reason: 'wrong', triesLeft: MAX_TRIES - 1 })
  })

  it('makes the owner wait 30 seconds after 5 wrong tries, even with the right PIN', async () => {
    await auth.setup('2468')
    for (let i = 1; i < MAX_TRIES; i++) {
      expect(await auth.unlock('0000')).toMatchObject({ reason: 'wrong', triesLeft: MAX_TRIES - i, waitUntil: null })
    }
    expect(await auth.unlock('0000')).toMatchObject({ reason: 'wrong', triesLeft: 0, waitUntil: now + WAIT_MS })
    expect(await auth.unlock('2468')).toEqual({ ok: false, reason: 'wait', waitUntil: now + WAIT_MS })
    expect(auth.attemptState().waitUntil).toBe(now + WAIT_MS)

    now += WAIT_MS
    expect(auth.attemptState().waitUntil).toBeNull()
    expect(await auth.unlock('2468')).toEqual({ ok: true })
    expect(auth.attemptState()).toEqual({ triesLeft: MAX_TRIES, waitUntil: null })
  })

  it('keeps the wrong-try count across a restart', async () => {
    await auth.setup('2468')
    await auth.unlock('0000')
    await auth.unlock('0000')
    const restarted = new PinAuth(store, () => now)
    expect(restarted.attemptState().triesLeft).toBe(MAX_TRIES - 2)
  })

  it('a right PIN resets the wrong-try count', async () => {
    await auth.setup('2468')
    await auth.unlock('0000')
    await auth.unlock('2468')
    expect(auth.attemptState().triesLeft).toBe(MAX_TRIES)
  })

  it('accepts the recovery code however it is typed', async () => {
    const code = await auth.setup('2468')
    const typed = code.toLowerCase().match(/.{4}/g)!.join(' - ')
    expect(await auth.checkRecovery(typed)).toEqual({ ok: true })
  })

  it('resets the PIN with the recovery code and replaces the code', async () => {
    const oldCode = await auth.setup('2468')
    const result = await auth.resetWithRecovery(oldCode, '1357')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.recoveryCode).not.toBe(oldCode)

    expect(await auth.unlock('1357')).toEqual({ ok: true })
    expect((await auth.unlock('2468')).ok).toBe(false)
    expect((await auth.checkRecovery(oldCode)).ok).toBe(false)
    expect(await auth.checkRecovery(result.recoveryCode)).toEqual({ ok: true })
  })

  it('does not change the PIN when the recovery code is wrong', async () => {
    await auth.setup('2468')
    const result = await auth.resetWithRecovery('0000-0000-0000-0000', '1357')
    expect(result).toMatchObject({ ok: false, reason: 'wrong' })
    expect(await auth.unlock('2468')).toEqual({ ok: true })
  })

  it('counts badly typed and wrong recovery codes toward the same limit as wrong PINs', async () => {
    await auth.setup('2468')
    await auth.unlock('0000')
    await auth.checkRecovery('not a code')
    await auth.checkRecovery('0000-0000-0000-0000')
    expect(auth.attemptState().triesLeft).toBe(MAX_TRIES - 3)
    await auth.unlock('0000')
    expect(await auth.checkRecovery('0000-0000-0000-0000')).toMatchObject({ waitUntil: now + WAIT_MS })
  })
})
