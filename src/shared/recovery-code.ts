// Recovery codes: 16 characters from Crockford's base32 alphabet (no I, L, O, U),
// shown as four groups: "7KQ4-M9TX-2HPV-WN3C". 80 bits of randomness.

export const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const RECOVERY_LENGTH = 16

/** Turns 10 random bytes into a 16-character code. */
export function recoveryCodeFromBytes(bytes: Uint8Array): string {
  if (bytes.length !== 10) throw new Error('Need exactly 10 bytes')
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += RECOVERY_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
    value &= (1 << bits) - 1
  }
  return out
}

/**
 * Normalises what the owner typed: ignores spaces, dashes and case, and accepts the
 * look-alike letters O→0, I/L→1. Returns null if it can't be a valid code.
 */
export function normalizeRecoveryCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  if (cleaned.length !== RECOVERY_LENGTH) return null
  for (const ch of cleaned) if (!RECOVERY_ALPHABET.includes(ch)) return null
  return cleaned
}

export function formatRecoveryCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code
}
