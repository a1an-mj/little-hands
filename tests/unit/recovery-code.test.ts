import { describe, expect, it } from 'vitest'
import {
  RECOVERY_ALPHABET,
  formatRecoveryCode,
  normalizeRecoveryCode,
  recoveryCodeFromBytes
} from '@shared/recovery-code'

describe('recoveryCodeFromBytes', () => {
  it('makes 16 characters from the safe alphabet', () => {
    const code = recoveryCodeFromBytes(new Uint8Array([1, 2, 3, 4, 5, 250, 251, 252, 253, 254]))
    expect(code).toHaveLength(16)
    for (const ch of code) expect(RECOVERY_ALPHABET).toContain(ch)
  })

  it('maps all-zero and all-one bytes to the ends of the alphabet', () => {
    expect(recoveryCodeFromBytes(new Uint8Array(10))).toBe('0'.repeat(16))
    expect(recoveryCodeFromBytes(new Uint8Array(10).fill(255))).toBe('Z'.repeat(16))
  })

  it('rejects the wrong number of bytes', () => {
    expect(() => recoveryCodeFromBytes(new Uint8Array(9))).toThrow()
  })
})

describe('normalizeRecoveryCode', () => {
  it('accepts dashes, spaces and small letters', () => {
    expect(normalizeRecoveryCode(' 7kq4-m9tx 2hpv-wn3c ')).toBe('7KQ4M9TX2HPVWN3C')
  })

  it('reads O as zero and I/L as one', () => {
    expect(normalizeRecoveryCode('OOOO-IIII-LLLL-0000')).toBe('0000111111110000')
  })

  it('rejects wrong lengths and letters outside the alphabet', () => {
    expect(normalizeRecoveryCode('7KQ4-M9TX-2HPV')).toBeNull()
    expect(normalizeRecoveryCode('7KQ4-M9TX-2HPV-WN3U')).toBeNull()
    expect(normalizeRecoveryCode('')).toBeNull()
  })
})

describe('formatRecoveryCode', () => {
  it('groups in fours', () => {
    expect(formatRecoveryCode('7KQ4M9TX2HPVWN3C')).toBe('7KQ4-M9TX-2HPV-WN3C')
  })
})
