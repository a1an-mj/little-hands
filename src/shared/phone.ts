// Phone numbers are stored in international form ("+919000000014") and shown as "+91 90000 00014".
// Owners usually type Indian numbers without the country code, so 10 digits mean +91.

/** Returns the stored form, or null if this can't be a phone number. */
export function normalizePhone(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  if (!/^[+\d\s\-().]+$/.test(raw)) return null
  const plus = raw.startsWith('+')
  let digits = raw.replace(/\D/g, '')

  if (!plus && digits.startsWith('00')) return international(digits.slice(2))
  if (plus) return international(digits)

  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  if (digits.length === 12 && digits.startsWith('91')) return '+' + digits
  if (digits.length === 10) return '+91' + digits
  return null
}

function international(digits: string): string | null {
  if (digits.startsWith('91')) return digits.length === 12 ? '+' + digits : null
  return digits.length >= 8 && digits.length <= 15 ? '+' + digits : null
}

export function formatPhone(stored: string | null | undefined): string {
  if (!stored) return ''
  const m = /^\+91(\d{5})(\d{5})$/.exec(stored)
  return m ? `+91 ${m[1]} ${m[2]}` : stored
}

/** Digits to look for when searching by phone ("90000 00014" → "9000000014"). */
export function phoneSearchDigits(query: string): string | null {
  const digits = query.replace(/\D/g, '')
  return digits.length >= 4 && /^[+\d\s\-().]+$/.test(query.trim()) ? digits : null
}
