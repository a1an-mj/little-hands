import { describe, expect, it } from 'vitest'
import { formatPhone, normalizePhone, phoneSearchDigits } from '@shared/phone'

describe('normalizePhone', () => {
  it.each([
    ['9000000014', '+919000000014'],
    ['90000 00014', '+919000000014'],
    ['090000 00014', '+919000000014'],
    ['+91 90000 00014', '+919000000014'],
    ['91 90000 00014', '+919000000014'],
    ['0091 9000000014', '+919000000014'],
    ['(484) 2345-678', '+914842345678'],
    ['+44 20 7946 0958', '+442079460958']
  ])('%s → %s', (input, out) => {
    expect(normalizePhone(input)).toBe(out)
  })

  it.each(['', '   ', '12345', '+91 12345', 'call me', '900000000145', '+91 90000 000145'])('rejects %j', (input) => {
    expect(normalizePhone(input)).toBeNull()
  })
})

describe('formatPhone', () => {
  it('groups Indian numbers as +91 XXXXX XXXXX', () => {
    expect(formatPhone('+919000000014')).toBe('+91 90000 00014')
  })
  it('leaves other numbers as stored, and empty as empty', () => {
    expect(formatPhone('+442079460958')).toBe('+442079460958')
    expect(formatPhone(null)).toBe('')
  })
})

describe('phoneSearchDigits', () => {
  it('finds digits in number-like searches only', () => {
    expect(phoneSearchDigits('90000 00014')).toBe('9000000014')
    expect(phoneSearchDigits('0014')).toBe('0014')
    expect(phoneSearchDigits('014')).toBeNull()
    expect(phoneSearchDigits('LH-2026-014')).toBeNull()
    expect(phoneSearchDigits('Anna')).toBeNull()
  })
})
