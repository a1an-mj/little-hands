import Database from 'better-sqlite3'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FeeVersion } from '@shared/enrollments'
import { periodLabel } from '@shared/payments'
import { balanceOf, dueText, monthPlus, nextPeriodAfter, partialAmount, periodsOf } from '@shared/periods'
import { admissionSchema, type AdmissionInput, type PaymentInput } from '@shared/schemas'
import { migrationsFromFiles, runMigrations } from '../../src/main/db/migrate'
import { Writer } from '../../src/main/db/writer'
import { PaymentsRepo } from '../../src/main/payments/repo'
import { StudentsRepo, UserError } from '../../src/main/students/repo'
import { lkgEnrollment, newFamilyAdmission } from './fixtures'

const fee = (effectiveFrom: string, agreed: number, periodMonths = 1, dueDay = Number(effectiveFrom.slice(8))): FeeVersion => ({
  id: effectiveFrom,
  effectiveFrom,
  periodMonths,
  dueDay,
  standardPaise: agreed,
  concessionPaise: 0,
  agreedPaise: agreed,
  concessionReason: '',
  remarks: ''
})

describe('periods (owner: calendar months, due by the 5th, first month by days)', () => {
  it('joins on 15 Nov at ₹2,000/month: 15–30 Nov is 16/30 of the fee, due on joining; then the 5th', () => {
    const p = periodsOf('2026-11-15', null, [fee('2026-11-15', 200000, 1, 5)], '2027-01-10')
    expect(p.map((x) => [x.start, x.end, x.due, x.amountPaise, x.partial])).toEqual([
      ['2026-11-15', '2026-11-30', '2026-11-15', 106667, true], // ₹1,066.67, to the paisa
      ['2026-12-01', '2026-12-31', '2026-12-05', 200000, false],
      ['2027-01-01', '2027-01-31', '2027-01-05', 200000, false]
    ])
    expect(partialAmount(200000, 1, '2026-11-15')).toBe(106667)
  })

  it('by days in that month: 31-day, 28-day and leap months; joining on the 1st is a full month', () => {
    expect(partialAmount(310000, 1, '2026-10-21')).toBe(110000) // 11 of 31 days
    expect(partialAmount(280000, 1, '2027-02-15')).toBe(140000) // 14 of 28
    expect(partialAmount(290000, 1, '2028-02-15')).toBe(150000) // 15 of 29
    expect(partialAmount(150000, 1, '2026-10-31')).toBe(4839) // the last day: 1 of 31
    const p = periodsOf('2026-11-01', null, [fee('2026-11-01', 150000, 1, 5)], '2026-12-31')
    expect(p.map((x) => [x.start, x.due, x.amountPaise, x.partial])).toEqual([
      ['2026-11-01', '2026-11-01', 150000, false], // paid on joining
      ['2026-12-01', '2026-12-05', 150000, false]
    ])
  })

  it('a period is listed from its first day; until the 5th it is not due yet', () => {
    const fees = [fee('2026-11-01', 150000, 1, 5)]
    expect(periodsOf('2026-11-01', null, fees, '2026-11-30')).toHaveLength(1)
    expect(periodsOf('2026-11-01', null, fees, '2026-12-01')).toHaveLength(2)
    expect(balanceOf(150000, 0, '2026-12-05', '2026-12-03')).toMatchObject({ status: 'upcoming' })
  })

  it('every 3 months: blocks from the joining month, due on the 5th of the first month', () => {
    const p = periodsOf('2026-06-15', null, [fee('2026-06-15', 450000, 3, 5)], '2027-01-01')
    expect(p.map((x) => [x.start, x.end, x.due, x.amountPaise])).toEqual([
      ['2026-06-15', '2026-08-31', '2026-06-15', 380000], // 16/30 × ₹1,500 + 2 × ₹1,500 = ₹3,800
      ['2026-09-01', '2026-11-30', '2026-09-05', 450000],
      ['2026-12-01', '2027-02-28', '2026-12-05', 450000]
    ])
  })

  it('a fee rise applies from the first period starting on or after it', () => {
    const p = periodsOf('2026-06-01', null, [fee('2026-06-01', 150000, 1, 5), fee('2026-08-15', 180000, 1, 5)], '2026-10-01')
    expect(p.map((x) => [x.start, x.amountPaise])).toEqual([
      ['2026-06-01', 150000],
      ['2026-07-01', 150000],
      ['2026-08-01', 150000], // started before the rise
      ['2026-09-01', 180000],
      ['2026-10-01', 180000]
    ])
  })

  it('stops after the last day (no refund); one-time fees are a single period', () => {
    expect(periodsOf('2026-06-01', '2026-08-10', [fee('2026-06-01', 1, 1, 5)], '2027-01-01').map((x) => x.start)).toEqual([
      '2026-06-01',
      '2026-07-01',
      '2026-08-01'
    ])
    expect(periodsOf('2026-06-20', null, [fee('2026-06-20', 50000, 0)], '2027-01-01')).toEqual([
      { start: '2026-06-20', end: null, due: '2026-06-20', amountPaise: 50000, periodMonths: 0, partial: false }
    ])
    expect(nextPeriodAfter('2026-06-20', null, [fee('2026-06-20', 1, 1, 5)], '2026-07-25')!.start).toBe('2026-08-01')
    expect(nextPeriodAfter('2026-06-20', '2026-07-30', [fee('2026-06-20', 1, 1, 5)], '2026-07-25')).toBeNull()
    expect(monthPlus('2028-01-31', 1, 31)).toBe('2028-02-29')
  })

  it('balances and "due for N days"', () => {
    expect(balanceOf(150000, 0, '2026-10-20', '2026-10-20')).toMatchObject({ status: 'due', daysDue: 0, balancePaise: 150000 })
    expect(balanceOf(150000, 100000, '2026-10-20', '2026-10-23')).toMatchObject({ status: 'partly', daysDue: 3, balancePaise: 50000 })
    expect(balanceOf(150000, 150000, '2026-10-20', '2026-10-23')).toMatchObject({ status: 'paid', balancePaise: 0 })
    expect(balanceOf(150000, 0, '2026-11-20', '2026-10-23')).toMatchObject({ status: 'upcoming', daysDue: null })
    expect(balanceOf(150000, 0, '2026-10-20', '2026-10-23', true)).toMatchObject({ status: 'waived', balancePaise: 0 })
    expect([dueText(0), dueText(1), dueText(12)]).toEqual(['Due today', 'Due for 1 day', 'Due for 12 days'])
  })

  it('labels', () => {
    expect(periodLabel({ start: '2026-10-01', end: '2026-10-31', periodMonths: 1 })).toBe('Oct 2026')
    expect(periodLabel({ start: '2026-11-15', end: '2026-11-30', periodMonths: 1 })).toBe('15–30 Nov 2026')
    expect(periodLabel({ start: '2026-09-01', end: '2026-11-30', periodMonths: 3 })).toBe('1 Sept 2026 – 30 Nov 2026')
    expect(periodLabel({ start: '2026-09-01', end: null, periodMonths: 0 })).toBe('One-time')
  })
})

// ---------- Repository ----------

const dir = join(__dirname, '../../src/main/db/migrations')
const migrations = migrationsFromFiles(
  Object.fromEntries(readdirSync(dir).map((f) => [`./migrations/${f}`, readFileSync(join(dir, f), 'utf8')]))
)

let db: Database.Database
let students: StudentsRepo
let repo: PaymentsRepo
let now: Date

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db, migrations)
  now = new Date(2026, 9, 23, 10, 0) // Friday 23 Oct 2026, 10:00
  const w = new Writer(db, 'device-1', () => now)
  students = new StudentsRepo(w)
  repo = new PaymentsRepo(w)
})

const admit = (overrides: Partial<AdmissionInput> = {}) =>
  students.admit(
    admissionSchema.parse(
      newFamilyAdmission({
        joiningDate: '2026-08-01',
        programs: [lkgEnrollment({ startDate: '2026-08-01', fee: { ...lkgEnrollment().fee, dueDay: '5' } })],
        ...overrides
      })
    ),
    null
  )
const lkgOf = (id: string) => repo.forStudent(id).programs.find((p) => p.program === 'lk')!
const pay = (studentId: string, enrollmentId: string, periodStart: string, amount: string, extra: Partial<PaymentInput> = {}) =>
  repo.record({
    studentId,
    target: { kind: 'period', enrollmentId, periodStart },
    amount,
    method: 'cash',
    reference: '',
    paidAt: '2026-10-23T09:30',
    recordedBy: 'Anu',
    remarks: '',
    ...extra
  })

describe('recording payments', () => {
  it('periods so far, with their status; a part payment leaves a balance', () => {
    const id = admit()
    const lk = lkgOf(id)
    // Aug, Sep, Oct so far, plus November's (not due yet) — newest first.
    expect(lk.periods.map((p) => [p.start, p.status])).toEqual([
      ['2026-11-01', 'upcoming'],
      ['2026-10-01', 'due'],
      ['2026-09-01', 'due'],
      ['2026-08-01', 'due']
    ])
    expect(pay(id, lk.enrollmentId, '2026-08-01', '1500').no).toBe('PAY-0001')
    expect(pay(id, lk.enrollmentId, '2026-09-01', '1,000').no).toBe('PAY-0002')
    const f = repo.forStudent(id)
    expect(f.programs[0]!.periods.map((p) => [p.start, p.status, p.balancePaise])).toEqual([
      ['2026-11-01', 'upcoming', 150000],
      ['2026-10-01', 'due', 150000],
      ['2026-09-01', 'partly', 50000],
      ['2026-08-01', 'paid', 0]
    ])
    expect(f.owedPaise).toBe(200000) // Sep ₹500 + Oct ₹1,500
    expect(f.payments.map((p) => [p.no, p.forText, p.leftAfterPaise])).toEqual([
      ['PAY-0002', 'LKG · Sept 2026', 50000],
      ['PAY-0001', 'LKG · Aug 2026', 0]
    ])
  })

  it('refuses more than what is owed (parents pay the exact amount) and future dates', () => {
    const id = admit()
    const lk = lkgOf(id).enrollmentId
    // Up to this month and the next together is allowed (an advance); more is refused.
    expect(() => pay(id, lk, '2026-08-01', '3000.01')).toThrow("That is more than what's owed for LKG · Aug 2026 and LKG · Sept 2026 together (₹3,000). Check the amount.")
    pay(id, lk, '2026-08-01', '1500')
    expect(() => pay(id, lk, '2026-08-01', '1')).toThrow('Nothing is owed for LKG · Aug 2026.')
    expect(() => pay(id, lk, '2026-09-01', '100', { paidAt: '2026-10-24T09:00' })).toThrow("can't be in the future")
    expect(() => pay(id, lk, '2026-09-02', '100')).toThrow('That period could not be found')
  })

  it('the next period can be paid in advance, but not the one after', () => {
    const id = admit()
    const lk = lkgOf(id).enrollmentId
    pay(id, lk, '2026-11-01', '1500')
    expect(lkgOf(id).periods[0]).toMatchObject({ start: '2026-11-01', status: 'paid' })
    expect(() => pay(id, lk, '2026-12-01', '1500')).toThrow('That period could not be found')
  })

  it('needs a name for "Recorded by", and remembers names', () => {
    const id = admit()
    const lk = lkgOf(id).enrollmentId
    expect(() => pay(id, lk, '2026-08-01', '1500', { recordedBy: ' ' })).toThrow()
    pay(id, lk, '2026-08-01', '1500', { recordedBy: 'Anu' })
    pay(id, lk, '2026-09-01', '1500', { recordedBy: 'Owner' })
    expect(repo.recorders().sort()).toEqual(['Anu', 'Owner'])
  })
})

describe('paying at joining (owner): a full month, the extra counts towards the next month', () => {
  it('joins 15 Nov at ₹2,000: pays ₹2,000 → ₹1,066.67 for 15–30 Nov and ₹933.33 towards December', () => {
    now = new Date(2026, 10, 15, 10, 0)
    const id = admit({
      joiningDate: '2026-11-15',
      programs: [lkgEnrollment({ startDate: '2026-11-15', fee: { ...lkgEnrollment().fee, standard: '2000', dueDay: '5' } })]
    })
    const lk = lkgOf(id)
    expect(lk.periods.map((p) => [periodLabel(p), p.amountPaise, p.due, p.status])).toEqual([
      ['Dec 2026', 200000, '2026-12-05', 'upcoming'],
      ['15–30 Nov 2026', 106667, '2026-11-15', 'due']
    ])
    expect(lk.fee).toEqual({ agreedPaise: 200000, periodMonths: 1, dueDay: 5 })
    const r = pay(id, lk.enrollmentId, '2026-11-15', '2000', { paidAt: '2026-11-15T10:00' })
    expect(r).toMatchObject({ no: 'PAY-0001', advance: { no: 'PAY-0002', forText: 'LKG · Dec 2026', amountPaise: 93333 } })
    const after = repo.forStudent(id)
    expect(after.programs[0]!.periods.map((p) => [p.start, p.status, p.balancePaise])).toEqual([
      ['2026-12-01', 'upcoming', 106667], // the rest of December, due by 5 Dec
      ['2026-11-15', 'paid', 0]
    ])
    expect(after.payments.map((p) => [p.no, p.forText, p.amountPaise, p.remarks])).toEqual([
      ['PAY-0002', 'LKG · Dec 2026', 93333, 'Advance, paid with PAY-0001'],
      ['PAY-0001', 'LKG · 15–30 Nov 2026', 106667, '']
    ])
  })
})

describe('reversals (payments are never edited or deleted)', () => {
  it('₹15,000 typed instead of ₹1,500: reverse, then record again', () => {
    const id = admit({ programs: [lkgEnrollment({ startDate: '2026-08-01', fee: { ...lkgEnrollment().fee, standard: '15000', dueDay: '5' } })] })
    const lk = lkgOf(id).enrollmentId
    const wrong = pay(id, lk, '2026-08-01', '15000')
    now = new Date(2026, 9, 23, 10, 1)
    const rev = repo.reverse(wrong.id, { reason: 'Typed ₹15,000 instead of ₹1,500', recordedBy: 'Owner' })
    expect(rev.no).toBe('PAY-0002')
    pay(id, lk, '2026-08-01', '1500')
    const f = repo.forStudent(id)
    expect(f.payments.map((p) => [p.no, p.kind, p.amountPaise, p.reversed, p.reversesNo])).toEqual([
      ['PAY-0002', 'reversal', -1500000, false, 'PAY-0001'],
      ['PAY-0003', 'payment', 150000, false, null],
      ['PAY-0001', 'payment', 1500000, true, null]
    ])
    expect(f.programs[0]!.periods.at(-1)).toMatchObject({ paidPaise: 150000, balancePaise: 1350000 })
    // Rows are never updated: the original is untouched.
    expect(db.prepare('SELECT count(*) FROM payments WHERE created_at <> updated_at').pluck().get()).toBe(0)
  })

  it('a payment can be reversed only once; a reversal can’t be reversed; a reason is needed', () => {
    const id = admit()
    const p = pay(id, lkgOf(id).enrollmentId, '2026-08-01', '1500')
    expect(() => repo.reverse(p.id, { reason: '', recordedBy: 'Owner' })).toThrow()
    const r = repo.reverse(p.id, { reason: 'Wrong child', recordedBy: 'Owner' })
    expect(() => repo.reverse(p.id, { reason: 'Again', recordedBy: 'Owner' })).toThrow('has already been reversed')
    expect(() => repo.reverse(r.id, { reason: 'x', recordedBy: 'Owner' })).toThrow('A reversal itself cannot be reversed')
  })
})

describe('charges and waivers', () => {
  it('the admission fee from the admission form is owed from the joining date', () => {
    const id = admit({ admissionFee: '2,000' })
    const c = repo.forStudent(id).charges
    expect(c).toMatchObject([{ kind: 'admission', label: 'Admission fee', amountPaise: 200000, dueDate: '2026-08-01', status: 'due' }])
    repo.record({ studentId: id, target: { kind: 'charge', chargeId: c[0]!.id }, amount: '2000', method: 'upi', reference: '1234', paidAt: '2026-10-23T09:00', recordedBy: 'Owner', remarks: '' })
    expect(repo.forStudent(id).charges[0]!.status).toBe('paid')
    expect(() => repo.cancelCharge(c[0]!.id)).toThrow('Reverse that payment first')
  })

  it('a late fine, and cancelling a charge added by mistake', () => {
    const id = admit()
    const fine = repo.addCharge(id, { kind: 'fine', label: 'Late fine · Sep', amount: '100', dueDate: '2026-10-23', reason: '' })
    expect(repo.forStudent(id).charges[0]).toMatchObject({ label: 'Late fine · Sep', status: 'due', daysDue: 0 })
    repo.cancelCharge(fine)
    expect(repo.forStudent(id).charges).toEqual([])
    expect(db.prepare(`SELECT action FROM audit_log WHERE table_name = 'charges' ORDER BY rowid`).pluck().all()).toEqual(['insert', 'delete'])
  })

  it('a waived period is not charged, and can be charged again', () => {
    const id = admit()
    const lk = lkgOf(id).enrollmentId
    repo.waive(lk, '2026-09-01', { reason: 'Away in Dubai' })
    expect(lkgOf(id).periods.find((p) => p.start === '2026-09-01')).toMatchObject({ status: 'waived', balancePaise: 0, waiver: { reason: 'Away in Dubai' } })
    expect(() => pay(id, lk, '2026-09-01', '100')).toThrow('waived')
    expect(repo.forStudent(id).owedPaise).toBe(300000) // Aug + Oct
    repo.unwaive(lk, '2026-09-01')
    expect(repo.forStudent(id).owedPaise).toBe(450000)
    pay(id, lk, '2026-09-01', '100')
    expect(() => repo.waive(lk, '2026-09-01', { reason: 'x' })).toThrow('Reverse that payment first')
  })
})

describe('overview and report', () => {
  it('collected this month, outstanding from earlier, who owes (longest due first), recent payments', () => {
    const a = admit()
    const b = admit({ fullName: 'Dev Krishna', family: { ...newFamilyAdmission().family, father: { name: 'K', phone: '90000 00061' } } as never })
    pay(a, lkgOf(a).enrollmentId, '2026-08-01', '1500', { paidAt: '2026-09-02T10:00' })
    pay(a, lkgOf(a).enrollmentId, '2026-09-01', '1500', { paidAt: '2026-10-05T10:00' })
    pay(b, lkgOf(b).enrollmentId, '2026-08-01', '500', { method: 'upi', reference: 'U1' })
    const o = repo.overview()
    expect(o.collectedThisMonthPaise).toBe(200000) // Oct: ₹1,500 + ₹500
    expect(o.dueThisMonthPaise).toBe(300000) // two Oct periods
    expect(o.outstandingEarlierPaise).toBe(100000 + 150000) // Dev: Aug ₹1,000 left + Sep ₹1,500
    expect(o.outstandingStudents).toBe(1)
    expect(o.oldestDue).toBe('2026-08-01')
    expect(o.owed.map((x) => [x.studentName, x.forText, x.balancePaise, x.daysDue])).toEqual([
      ['Dev Krishna', 'LKG · Aug 2026', 100000, 83], // due on joining, 1 Aug
      ['Dev Krishna', 'LKG · Sept 2026', 150000, 48], // due 5 Sept
      ['Aadhya Menon', 'LKG · Oct 2026', 150000, 18], // due 5 Oct
      ['Dev Krishna', 'LKG · Oct 2026', 150000, 18]
    ])
    expect(o.recent.map((r) => [r.studentName, r.amountPaise])).toEqual([
      ['Dev Krishna', 50000],
      ['Aadhya Menon', 150000],
      ['Aadhya Menon', 150000]
    ])
  })

  it('the monthly report: by program, by method, concessions, who owes', () => {
    const a = admit({
      programs: [
        lkgEnrollment({ startDate: '2026-08-01', fee: { ...lkgEnrollment().fee, dueDay: '5', concession: '200', concessionReason: 'Sibling' } }),
        lkgEnrollment({ program: 'tr', startDate: '2026-08-01', schedule: undefined, fee: { ...lkgEnrollment().fee, standard: '600', dueDay: '5' } })
      ]
    })
    const f = repo.forStudent(a)
    const lk = f.programs.find((p) => p.program === 'lk')!.enrollmentId
    const tr = f.programs.find((p) => p.program === 'tr')!.enrollmentId
    pay(a, lk, '2026-10-01', '1300')
    pay(a, tr, '2026-10-01', '600', { method: 'upi' })
    const r = repo.monthReport('2026-10')
    expect(r.collectedPaise).toBe(190000)
    expect(r.byProgram).toEqual([
      { label: 'LKG', paise: 130000 },
      { label: 'Transport', paise: 60000 }
    ])
    expect(r.byMethod).toEqual({ cash: 130000, upi: 60000, bank: 0 })
    expect(r.concessions).toEqual([{ studentName: 'Aadhya Menon', program: 'lk', concessionPaise: 20000, reason: 'Sibling' }])
    expect(r.owed.map((o) => o.forText)).toEqual(['LKG · Aug 2026', 'Transport · Aug 2026', 'LKG · Sept 2026', 'Transport · Sept 2026'])
  })
})

describe('protecting recorded payments', () => {
  it('a program or child with payments can’t be removed', () => {
    const id = admit()
    const lk = lkgOf(id).enrollmentId
    pay(id, lk, '2026-08-01', '1500')
    expect(() => students.enrollments.remove(lk)).toThrow(UserError)
    expect(() => students.remove(id)).toThrow('Mark them Inactive instead')
  })

  it('can’t move the start, the due day or the period length under paid periods', () => {
    const id = admit()
    const e = students.profile(id)!.enrollments[0]!
    pay(id, e.id, '2026-09-01', '1500')
    const base = {
      startDate: e.startDate,
      schedule: { days: 31 },
      fee: { periodMonths: 1, dueDay: '5', standard: '1500', concession: '', concessionReason: '', remarks: '' },
      mode: 'fix' as const,
      from: ''
    }
    expect(() => students.enrollments.edit(e.id, { ...base, startDate: '2026-08-02' })).toThrow("start date can't be changed")
    expect(() => students.enrollments.edit(e.id, { ...base, fee: { ...base.fee, dueDay: '10' } })).toThrow('A change from a date')
    // A change from after the last paid period is fine, and so is a new amount.
    students.enrollments.edit(e.id, { ...base, mode: 'change', from: '2026-10-21', fee: { ...base.fee, dueDay: '10' } })
    students.enrollments.edit(e.id, { ...base, mode: 'change', from: '2026-11-21', fee: { ...base.fee, dueDay: '10', standard: '1800' } })
    expect(() => students.enrollments.end(e.id, { endDate: '2026-08-15', reason: '' })).toThrow('already paid') // September is paid
  })

  it('extras: a fee only, no days, no attendance', () => {
    const id = admit({
      programs: [
        lkgEnrollment({ startDate: '2026-08-01' }),
        lkgEnrollment({ program: 'ka', startDate: '2026-09-01', schedule: undefined, fee: { ...lkgEnrollment().fee, standard: '500', dueDay: '1' } })
      ]
    })
    const ka = students.profile(id)!.enrollments.find((e) => e.program === 'ka')!
    expect(ka.schedules).toEqual([])
    expect(repo.forStudent(id).programs.find((p) => p.program === 'ka')!.periods.map((p) => p.start)).toEqual(['2026-11-01', '2026-10-01', '2026-09-01'])
    expect(() =>
      admissionSchema.parse(newFamilyAdmission({ programs: [lkgEnrollment({ schedule: undefined })] }))
    ).toThrow('Choose at least one day') // classes still need days
  })
})
