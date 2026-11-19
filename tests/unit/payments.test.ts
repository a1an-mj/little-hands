import Database from 'better-sqlite3'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FeeVersion } from '@shared/enrollments'
import { periodLabel } from '@shared/payments'
import { balanceOf, dueText, monthPlus, nextPeriodAfter, periodsOf } from '@shared/periods'
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

describe('periods (owner: paid in advance, month runs from the start day, no part months)', () => {
  it('joining on 20 June, monthly: due 20 June, 20 July, 20 August…', () => {
    const p = periodsOf('2026-06-20', null, [fee('2026-06-20', 150000)], '2026-08-25')
    expect(p.map((x) => [x.start, x.end, x.amountPaise])).toEqual([
      ['2026-06-20', '2026-07-19', 150000],
      ['2026-07-20', '2026-08-19', 150000],
      ['2026-08-20', '2026-09-19', 150000]
    ])
  })

  it('a period starting today is included; tomorrow’s is not', () => {
    expect(periodsOf('2026-06-20', null, [fee('2026-06-20', 1)], '2026-07-20')).toHaveLength(2)
    expect(periodsOf('2026-06-20', null, [fee('2026-06-20', 1)], '2026-07-19')).toHaveLength(1)
    expect(periodsOf('2026-06-20', null, [fee('2026-06-20', 1)], '2026-06-19')).toHaveLength(0)
  })

  it('due day 31 means the last day of shorter months', () => {
    const p = periodsOf('2027-01-31', null, [fee('2027-01-31', 1)], '2027-04-30')
    expect(p.map((x) => x.start)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'])
    expect(monthPlus('2028-01-31', 1, 31)).toBe('2028-02-29') // leap year
  })

  it('every 3 months, and a due day earlier than the start day', () => {
    const p = periodsOf('2026-06-01', null, [fee('2026-06-01', 450000, 3)], '2027-01-01')
    expect(p.map((x) => [x.start, x.end])).toEqual([
      ['2026-06-01', '2026-08-31'],
      ['2026-09-01', '2026-11-30'],
      ['2026-12-01', '2027-02-28']
    ])
    const q = periodsOf('2026-06-20', null, [fee('2026-06-20', 1, 1, 10)], '2026-08-31')
    expect(q.map((x) => x.start)).toEqual(['2026-06-20', '2026-07-10', '2026-08-10']) // never two in one month
  })

  it('a fee rise applies from the first period starting on or after it', () => {
    const p = periodsOf('2026-06-20', null, [fee('2026-06-20', 150000), fee('2026-09-01', 180000, 1, 20)], '2026-10-20')
    expect(p.map((x) => [x.start, x.amountPaise])).toEqual([
      ['2026-06-20', 150000],
      ['2026-07-20', 150000],
      ['2026-08-20', 150000], // started before the rise
      ['2026-09-20', 180000],
      ['2026-10-20', 180000]
    ])
  })

  it('stops after the last day; one-time fees are a single period', () => {
    expect(periodsOf('2026-06-20', '2026-08-19', [fee('2026-06-20', 1)], '2027-01-01').map((x) => x.start)).toEqual(['2026-06-20', '2026-07-20'])
    expect(periodsOf('2026-06-20', null, [fee('2026-06-20', 50000, 0)], '2027-01-01')).toEqual([
      { start: '2026-06-20', end: null, amountPaise: 50000, periodMonths: 0 }
    ])
    expect(nextPeriodAfter('2026-06-20', null, [fee('2026-06-20', 1)], '2026-07-25')!.start).toBe('2026-08-20')
    expect(nextPeriodAfter('2026-06-20', '2026-08-01', [fee('2026-06-20', 1)], '2026-07-25')).toBeNull()
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
    expect(periodLabel({ start: '2026-10-20', end: '2026-11-19', periodMonths: 1 })).toBe('Oct 2026')
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
        joiningDate: '2026-08-20',
        programs: [lkgEnrollment({ startDate: '2026-08-20', fee: { ...lkgEnrollment().fee, dueDay: '20' } })],
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
      ['2026-11-20', 'upcoming'],
      ['2026-10-20', 'due'],
      ['2026-09-20', 'due'],
      ['2026-08-20', 'due']
    ])
    expect(pay(id, lk.enrollmentId, '2026-08-20', '1500').no).toBe('PAY-0001')
    expect(pay(id, lk.enrollmentId, '2026-09-20', '1,000').no).toBe('PAY-0002')
    const f = repo.forStudent(id)
    expect(f.programs[0]!.periods.map((p) => [p.start, p.status, p.balancePaise])).toEqual([
      ['2026-11-20', 'upcoming', 150000],
      ['2026-10-20', 'due', 150000],
      ['2026-09-20', 'partly', 50000],
      ['2026-08-20', 'paid', 0]
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
    expect(() => pay(id, lk, '2026-08-20', '1600')).toThrow("That is more than what's owed for LKG · Aug 2026 (₹1,500). Check the amount.")
    pay(id, lk, '2026-08-20', '1500')
    expect(() => pay(id, lk, '2026-08-20', '1')).toThrow('Nothing is owed for LKG · Aug 2026.')
    expect(() => pay(id, lk, '2026-09-20', '100', { paidAt: '2026-10-24T09:00' })).toThrow("can't be in the future")
    expect(() => pay(id, lk, '2026-09-21', '100')).toThrow('That period could not be found')
  })

  it('the next period can be paid in advance, but not the one after', () => {
    const id = admit()
    const lk = lkgOf(id).enrollmentId
    pay(id, lk, '2026-11-20', '1500')
    expect(lkgOf(id).periods[0]).toMatchObject({ start: '2026-11-20', status: 'paid' })
    expect(() => pay(id, lk, '2026-12-20', '1500')).toThrow('That period could not be found')
  })

  it('needs a name for "Recorded by", and remembers names', () => {
    const id = admit()
    const lk = lkgOf(id).enrollmentId
    expect(() => pay(id, lk, '2026-08-20', '1500', { recordedBy: ' ' })).toThrow()
    pay(id, lk, '2026-08-20', '1500', { recordedBy: 'Anu' })
    pay(id, lk, '2026-09-20', '1500', { recordedBy: 'Owner' })
    expect(repo.recorders().sort()).toEqual(['Anu', 'Owner'])
  })
})

describe('reversals (payments are never edited or deleted)', () => {
  it('₹15,000 typed instead of ₹1,500: reverse, then record again', () => {
    const id = admit({ programs: [lkgEnrollment({ startDate: '2026-08-20', fee: { ...lkgEnrollment().fee, standard: '15000', dueDay: '20' } })] })
    const lk = lkgOf(id).enrollmentId
    const wrong = pay(id, lk, '2026-08-20', '15000')
    now = new Date(2026, 9, 23, 10, 1)
    const rev = repo.reverse(wrong.id, { reason: 'Typed ₹15,000 instead of ₹1,500', recordedBy: 'Owner' })
    expect(rev.no).toBe('PAY-0002')
    pay(id, lk, '2026-08-20', '1500')
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
    const p = pay(id, lkgOf(id).enrollmentId, '2026-08-20', '1500')
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
    expect(c).toMatchObject([{ kind: 'admission', label: 'Admission fee', amountPaise: 200000, dueDate: '2026-08-20', status: 'due' }])
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
    repo.waive(lk, '2026-09-20', { reason: 'Away in Dubai' })
    expect(lkgOf(id).periods.find((p) => p.start === '2026-09-20')).toMatchObject({ status: 'waived', balancePaise: 0, waiver: { reason: 'Away in Dubai' } })
    expect(() => pay(id, lk, '2026-09-20', '100')).toThrow('waived')
    expect(repo.forStudent(id).owedPaise).toBe(300000) // Aug + Oct
    repo.unwaive(lk, '2026-09-20')
    expect(repo.forStudent(id).owedPaise).toBe(450000)
    pay(id, lk, '2026-09-20', '100')
    expect(() => repo.waive(lk, '2026-09-20', { reason: 'x' })).toThrow('Reverse that payment first')
  })
})

describe('overview and report', () => {
  it('collected this month, outstanding from earlier, who owes (longest due first), recent payments', () => {
    const a = admit()
    const b = admit({ fullName: 'Dev Krishna', family: { ...newFamilyAdmission().family, father: { name: 'K', phone: '90000 00061' } } as never })
    pay(a, lkgOf(a).enrollmentId, '2026-08-20', '1500', { paidAt: '2026-09-02T10:00' })
    pay(a, lkgOf(a).enrollmentId, '2026-09-20', '1500', { paidAt: '2026-10-05T10:00' })
    pay(b, lkgOf(b).enrollmentId, '2026-08-20', '500', { method: 'upi', reference: 'U1' })
    const o = repo.overview()
    expect(o.collectedThisMonthPaise).toBe(200000) // Oct: ₹1,500 + ₹500
    expect(o.dueThisMonthPaise).toBe(300000) // two Oct periods
    expect(o.outstandingEarlierPaise).toBe(100000 + 150000) // Dev: Aug ₹1,000 left + Sep ₹1,500
    expect(o.outstandingStudents).toBe(1)
    expect(o.oldestDue).toBe('2026-08-20')
    expect(o.owed.map((x) => [x.studentName, x.forText, x.balancePaise, x.daysDue])).toEqual([
      ['Dev Krishna', 'LKG · Aug 2026', 100000, 64],
      ['Dev Krishna', 'LKG · Sept 2026', 150000, 33],
      ['Aadhya Menon', 'LKG · Oct 2026', 150000, 3],
      ['Dev Krishna', 'LKG · Oct 2026', 150000, 3]
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
        lkgEnrollment({ startDate: '2026-08-20', fee: { ...lkgEnrollment().fee, dueDay: '20', concession: '200', concessionReason: 'Sibling' } }),
        lkgEnrollment({ program: 'tr', startDate: '2026-08-20', schedule: undefined, fee: { ...lkgEnrollment().fee, standard: '600', dueDay: '20' } })
      ]
    })
    const f = repo.forStudent(a)
    const lk = f.programs.find((p) => p.program === 'lk')!.enrollmentId
    const tr = f.programs.find((p) => p.program === 'tr')!.enrollmentId
    pay(a, lk, '2026-10-20', '1300')
    pay(a, tr, '2026-10-20', '600', { method: 'upi' })
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
    pay(id, lk, '2026-08-20', '1500')
    expect(() => students.enrollments.remove(lk)).toThrow(UserError)
    expect(() => students.remove(id)).toThrow('Mark them Inactive instead')
  })

  it('can’t move the start, the due day or the period length under paid periods', () => {
    const id = admit()
    const e = students.profile(id)!.enrollments[0]!
    pay(id, e.id, '2026-09-20', '1500')
    const base = {
      startDate: e.startDate,
      schedule: { days: 31 },
      fee: { periodMonths: 1, dueDay: '20', standard: '1500', concession: '', concessionReason: '', remarks: '' },
      mode: 'fix' as const,
      from: ''
    }
    expect(() => students.enrollments.edit(e.id, { ...base, startDate: '2026-08-21' })).toThrow("start date can't be changed")
    expect(() => students.enrollments.edit(e.id, { ...base, fee: { ...base.fee, dueDay: '5' } })).toThrow('A change from a date')
    // A change from after the last paid period is fine, and so is a new amount.
    students.enrollments.edit(e.id, { ...base, mode: 'change', from: '2026-10-21', fee: { ...base.fee, dueDay: '5' } })
    students.enrollments.edit(e.id, { ...base, mode: 'change', from: '2026-11-21', fee: { ...base.fee, dueDay: '5', standard: '1800' } })
    expect(() => students.enrollments.end(e.id, { endDate: '2026-09-01', reason: '' })).toThrow('already paid')
  })

  it('extras: a fee only, no days, no attendance', () => {
    const id = admit({
      programs: [
        lkgEnrollment({ startDate: '2026-08-20' }),
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
