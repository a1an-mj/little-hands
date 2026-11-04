import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import type { KeyValueStore } from '../db/settings-store'
import type { AttemptResult, ResetResult } from '@shared/ipc-contract'
import { normalizeRecoveryCode, recoveryCodeFromBytes } from '@shared/recovery-code'

export const MAX_TRIES = 5
export const WAIT_MS = 30_000

const KEYS = {
  pin: 'pin_hash',
  recovery: 'recovery_hash',
  failed: 'failed_attempts',
  waitUntil: 'wait_until'
} as const

const PARAMS = { N: 2 ** 15, r: 8, p: 1, keylen: 32 }

function scrypt(secret: string, salt: Buffer, opts: typeof PARAMS): Promise<Buffer> {
  const options: ScryptOptions = { N: opts.N, r: opts.r, p: opts.p, maxmem: 128 * opts.N * opts.r * 2 }
  return new Promise((resolve, reject) =>
    scryptCb(secret, salt, opts.keylen, options, (err, key) => (err ? reject(err) : resolve(key)))
  )
}

/** Hash format: scrypt$N$r$p$<salt base64>$<hash base64> */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scrypt(secret, salt, PARAMS)
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), hash.toString('base64')].join('$')
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split('$')
  if (kind !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const actual = await scrypt(secret, Buffer.from(salt, 'base64'), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    keylen: expected.length
  })
  return timingSafeEqual(actual, expected)
}

/**
 * The 4-digit PIN and the one-time recovery code, stored only as scrypt hashes.
 * Wrong PINs and wrong recovery codes share one counter: after 5 wrong tries in a row
 * the owner must wait 30 seconds, and the counter is kept across restarts.
 */
export class PinAuth {
  constructor(
    private readonly store: KeyValueStore,
    private readonly now: () => number = Date.now
  ) {}

  isSetUp(): boolean {
    return this.store.get(KEYS.pin) !== undefined
  }

  attemptState(): { triesLeft: number; waitUntil: number | null } {
    const waitUntil = Number(this.store.get(KEYS.waitUntil) ?? 0)
    const failed = Number(this.store.get(KEYS.failed) ?? 0)
    return {
      triesLeft: MAX_TRIES - (failed % MAX_TRIES),
      waitUntil: waitUntil > this.now() ? waitUntil : null
    }
  }

  /** First run: stores the PIN and returns a new recovery code (shown to the owner once). */
  async setup(pin: string): Promise<string> {
    if (this.isSetUp()) throw new Error('A PIN is already set')
    return this.saveNewSecrets(pin)
  }

  async unlock(pin: string): Promise<AttemptResult> {
    return this.attempt(pin, KEYS.pin)
  }

  async checkRecovery(input: string): Promise<AttemptResult> {
    const code = normalizeRecoveryCode(input)
    // A badly typed code still counts as a try, so guessing stays slow.
    return this.attempt(code ?? '', KEYS.recovery)
  }

  async resetWithRecovery(input: string, newPin: string): Promise<ResetResult> {
    const result = await this.checkRecovery(input)
    if (!result.ok) return result
    return { ok: true, recoveryCode: await this.saveNewSecrets(newPin) }
  }

  private async attempt(secret: string, key: string): Promise<AttemptResult> {
    const { waitUntil } = this.attemptState()
    if (waitUntil !== null) return { ok: false, reason: 'wait', waitUntil }

    const stored = this.store.get(key)
    const ok = stored !== undefined && secret !== '' && (await verifySecret(secret, stored))
    if (ok) {
      this.store.setMany({ [KEYS.failed]: null, [KEYS.waitUntil]: null })
      return { ok: true }
    }

    const failed = Number(this.store.get(KEYS.failed) ?? 0) + 1
    const blocked = failed % MAX_TRIES === 0
    const until = blocked ? this.now() + WAIT_MS : null
    this.store.setMany({
      [KEYS.failed]: String(failed),
      [KEYS.waitUntil]: until === null ? null : String(until)
    })
    return { ok: false, reason: 'wrong', triesLeft: blocked ? 0 : MAX_TRIES - (failed % MAX_TRIES), waitUntil: until }
  }

  private async saveNewSecrets(pin: string): Promise<string> {
    const code = recoveryCodeFromBytes(randomBytes(10))
    const [pinHash, recoveryHash] = await Promise.all([hashSecret(pin), hashSecret(code)])
    this.store.setMany({
      [KEYS.pin]: pinHash,
      [KEYS.recovery]: recoveryHash,
      [KEYS.failed]: null,
      [KEYS.waitUntil]: null
    })
    return code
  }
}
