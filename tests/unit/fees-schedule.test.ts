import { describe, expect, it } from 'vitest'
import { academicYearOf } from '@shared/academic-year'
import { weekdayOf } from '@shared/dates'
import { shownVersions, versionOn } from '@shared/effective'
import { enrollmentState, monthlyTotalPaise, perLabel } from '@shared/enrollments'
import { formatRupees, parseRupees, rupeesInput } from '@shared/money'
import { expectedOn, formatDays, formatTime, formatTimeRange, toggleDay } from '@shared/schedule'
import { enrollmentEditSchema, feeInputSchema, scheduleInputSchema } from '@shared/schemas'

describe('money', () => {
  it('reads rupees as typed into whole paise', () => {
    expect(parseRupees('1500')).toBe(150000)
    expect(parseRupees('1,500')).toBe(150000)
    expect(parseRupees(' ₹ 1,500.5 ')).toBe(150050)
    expect(parseRupees('0.05')).toBe(5)
    expect(parseRupees('0')).toBe(0)
  })

  it('refuses things that are not amounts', () => {
    for (const bad of ['', 'abc', '-200', '1.234', '1e3', '12345678']) expect(parseRupees(bad)).toBeNull()
  })

  it('shows amounts the Indian way', () => {
    expect(formatRupees(150000)).toBe('₹1,500')
    expect(formatRupees(10000000)).toBe('₹1,00,000')
    expect(formatRupees(150050)).toBe('₹1,500.50')
    expect(formatRupees(0)).toBe('₹0')
    expect(formatRupees(-50000)).toBe('−₹500')
    expect(rupeesInput(150000)).toBe('1500')
    expect(rupeesInput(150005)).toBe('1500.05')
  })
})

describe('fee agreements', () => {
  const fee = (o: Partial<Record<string, string>> = {}) =>
    feeInputSchema.safeParse({ frequency: 'monthly', customLabel: '', standard: '1000', concession: '', concessionReason: '', remarks: '', ...o })

  it('agreed fee = standard − concession, in paise', () => {
    const r = fee({ concession: '200', concessionReason: 'Sibling' })
    expect(r.success && r.data).toMatchObject({ standard: 100000, concession: 20000 })
  })

  it('needs a fee, a reason for any concession, and no more concession than the fee', () => {
    const issues = (r: ReturnType<typeof fee>) => (r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`))
    expect(issues(fee({ standard: '' }))).toEqual(['standard: Enter the fee'])
    expect(issues(fee({ standard: 'abc' }))).toEqual(['standard: Enter an amount in rupees, e.g. 1500'])
    expect(issues(fee({ concession: '200' }))).toEqual(['concessionReason: Say why there is a concession'])
    expect(issues(fee({ concession: '1200', concessionReason: 'x' }))).toEqual(["concession: Can't be more than the standard fee"])
    expect(issues(fee({ frequency: 'custom' }))).toEqual(['customLabel: Say how it is charged, e.g. One-time'])
    expect(fee({ standard: '0' }).success).toBe(true) // free of charge is allowed
  })

  it('adds up only the monthly fees', () => {
    expect(
      monthlyTotalPaise([
        { frequency: 'monthly', agreedPaise: 150000 },
        { frequency: 'monthly', agreedPaise: 80000 },
        { frequency: 'term', agreedPaise: 500000 }
      ])
    ).toBe(230000)
  })

  it('names the period', () => {
    expect(perLabel('monthly', '')).toBe('month')
    expect(perLabel('term', 'x')).toBe('term')
    expect(perLabel('custom', 'One-time')).toBe('One-time')
  })
})

describe('timings', () => {
  it('describes days in plain words', () => {
    expect(formatDays(31)).toBe('Mon–Fri')
    expect(formatDays(21)).toBe('Mon, Wed, Fri')
    expect(formatDays(23)).toBe('Mon–Wed, Fri')
    expect(formatDays(63)).toBe('Mon–Sat')
    expect(formatDays(3)).toBe('Mon, Tue')
    expect(formatDays(toggleDay(31, 4))).toBe('Mon–Thu')
  })

  it('shows times with AM/PM, like the designs', () => {
    expect(formatTime('08:45')).toBe('8:45 AM')
    expect(formatTime('12:30')).toBe('12:30 PM')
    expect(formatTime('00:15')).toBe('12:15 AM')
    expect(formatTimeRange('08:45', '12:30')).toBe('8:45 AM – 12:30 PM')
    expect(formatTimeRange('16:00', '17:30')).toBe('4:00 – 5:30 PM')
  })

  it('knows which dates a child is expected', () => {
    expect(weekdayOf('2026-11-02')).toBe(0) // a Monday
    expect(expectedOn(21, '2026-11-02')).toBe(true) // Mon, Wed, Fri
    expect(expectedOn(21, '2026-11-03')).toBe(false)
    expect(expectedOn(31, '2026-11-08')).toBe(false) // Sunday
  })

  it('needs at least one day and leaving after arriving', () => {
    expect(scheduleInputSchema.safeParse({ days: 0, arrives: '09:00', leaves: '12:00' }).success).toBe(false)
    expect(scheduleInputSchema.safeParse({ days: 1, arrives: '12:00', leaves: '09:00' }).success).toBe(false)
    expect(scheduleInputSchema.safeParse({ days: 1, arrives: '9:00', leaves: '12:00' }).success).toBe(false)
    expect(scheduleInputSchema.safeParse({ days: 1, arrives: '09:00', leaves: '12:00' }).success).toBe(true)
  })
})

describe('versions by date', () => {
  const v = [{ effectiveFrom: '2026-06-01', n: 1 }, { effectiveFrom: '2026-12-01', n: 2 }, { effectiveFrom: '2027-06-01', n: 3 }]

  it('finds the version in force on a date', () => {
    expect(versionOn(v, '2026-05-31')).toBeUndefined()
    expect(versionOn(v, '2026-06-01')?.n).toBe(1)
    expect(versionOn(v, '2026-11-30')?.n).toBe(1)
    expect(versionOn(v, '2026-12-01')?.n).toBe(2)
    expect(versionOn(v, '2030-01-01')?.n).toBe(3)
  })

  it('shows the current version and the next change', () => {
    expect(shownVersions(v, '2026-11-02')).toMatchObject({ current: { n: 1 }, next: { n: 2 } })
    expect(shownVersions(v, '2026-01-01')).toMatchObject({ current: { n: 1 }, next: { n: 2 } }) // not started yet
    expect(shownVersions(v, '2027-07-01')).toMatchObject({ current: { n: 3 }, next: undefined })
  })

  it('tells upcoming, current and ended programs apart', () => {
    expect(enrollmentState('2026-12-01', null, '2026-11-02')).toBe('upcoming')
    expect(enrollmentState('2026-06-01', null, '2026-11-02')).toBe('current')
    expect(enrollmentState('2026-06-01', '2026-11-02', '2026-11-02')).toBe('current') // last day is today
    expect(enrollmentState('2026-06-01', '2026-11-01', '2026-11-02')).toBe('ended')
  })
})

describe('academic year (June–May until confirmed)', () => {
  it('labels dates with their academic year', () => {
    expect(academicYearOf('2026-06-01')).toBe('2026–27')
    expect(academicYearOf('2027-05-31')).toBe('2026–27')
    expect(academicYearOf('2026-05-31')).toBe('2025–26')
    expect(academicYearOf('2099-12-01')).toBe('2099–00')
  })
})

describe('editing a program', () => {
  const base = {
    startDate: '2026-06-01',
    schedule: { days: 31, arrives: '08:45', leaves: '12:30' },
    fee: { frequency: 'monthly', customLabel: '', standard: '1500', concession: '', concessionReason: '', remarks: '' }
  } as const
  it('needs a start date for a change, but not for a fix', () => {
    expect(enrollmentEditSchema.safeParse({ ...base, mode: 'fix', from: '' }).success).toBe(true)
    const r = enrollmentEditSchema.safeParse({ ...base, mode: 'change', from: '' })
    expect(r.success ? null : r.error.issues[0]?.path).toEqual(['from'])
  })
})
