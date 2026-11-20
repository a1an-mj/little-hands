import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// Payments, with the laptop's clock set to Friday 23 Oct 2026, 10:00 AM.
const userData = mkdtempSync(join(tmpdir(), 'little-hands-e2e-payments-'))
let app: ElectronApplication
let page: Page

test.describe.configure({ mode: 'serial' })

const fee = (standard: string, dueDay: string, concession = '', concessionReason = '') => ({
  periodMonths: 1,
  dueDay,
  standard,
  concession,
  concessionReason,
  remarks: ''
})
const admission = (fullName: string, phone: string, programs: unknown[], admissionFee = '') => ({
  fullName,
  joiningDate: '2026-08-01',
  notes: '',
  homeAddress: '',
  photo: null,
  family: {
    kind: 'new',
    father: { name: 'Suresh', phone },
    mother: { name: '', phone: '' },
    emergency: { name: 'Grandmother', relationship: 'Grandmother', phone: phone.slice(0, -1) + '9' },
    extra: [],
    feeContact: 'father'
  },
  programs,
  admissionFee
})

test.beforeAll(async () => {
  app = await electron.launch({
    args: [join(__dirname, '../..')],
    env: { ...process.env, LH_USER_DATA: userData, LH_NOW: '2026-10-23T10:00:00' } as Record<string, string>
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.evaluate(() => window.lh.lock.setup('2468'))
  const children = [
    admission(
      'Aadhya Menon',
      '90000 00014',
      [
        { program: 'lk', startDate: '2026-08-01', schedule: { days: 31 }, fee: fee('1500', '5') },
        { program: 'tr', startDate: '2026-10-01', fee: fee('600', '1') }
      ],
      '2000'
    ),
    admission('Dev Krishna', '90000 00061', [{ program: 'lk', startDate: '2026-08-01', schedule: { days: 31 }, fee: fee('1500', '5', '200', 'Sibling') }])
  ]
  for (const c of children) {
    const r = await page.evaluate((input) => window.lh.students.admit(input as never), c)
    expect(r).toEqual(expect.objectContaining({ ok: true }))
  }
  await page.reload()
})

test.afterAll(async () => {
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
})

const nav = (name: string) => page.getByRole('navigation', { name: 'Main menu' }).getByRole('button', { name, exact: true })
const snack = () => page.getByRole('status')
const openProfile = async (name: string) => {
  await nav('Students').click()
  await page.getByRole('region', { name: 'Student list' }).getByText(name, { exact: true }).click()
}

test('dashboard: fees to follow up, longest due first', async () => {
  await expect(page.getByTestId('outstanding-earlier')).toContainText('₹7,600') // Aadhya: admission ₹2,000 + Aug + Sep ₹1,500; Dev: Aug + Sep at ₹1,300
  await expect(page.getByTestId('outstanding-earlier')).toContainText('2 students · oldest from August')
  const rows = page.getByTestId('follow-up').getByTestId('owed')
  await expect(rows.first()).toContainText('Aadhya Menon')
  await expect(rows.first()).toContainText('Due for 83 days')
  await expect(page.getByTestId('collected-month')).toContainText('₹0')
})

test('profile → Fees & payments: periods, charges, owed now', async () => {
  await openProfile('Aadhya Menon')
  await page.getByRole('tab', { name: 'Fees & payments' }).click()
  await expect(page.getByTestId('owed-now')).toHaveText('₹7,100') // ₹2,000 + 3 × ₹1,500 + Transport ₹600
  const lkg = page.getByTestId('fees-lk')
  await expect(lkg).toContainText('₹1,500 / month')
  await expect(lkg.getByTestId('period')).toHaveText([/Nov 2026.*Not due yet/, /Oct 2026.*Due for 18 days/, /Sept 2026.*Due for 48 days/, /Aug 2026.*Due for 83 days/])
  await expect(page.getByTestId('fees-tr')).toContainText('Transport')
  await expect(page.getByTestId('charges')).toContainText('Admission fee')
})

test('record a part payment from the profile, then the rest', async () => {
  await page.getByRole('button', { name: 'Pay LKG · Aug 2026' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Record a payment' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Aug 2026 · Due for 83 days/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Amount (₹)')).toHaveValue('1500')
  await page.getByRole('button', { name: /Half ₹750/ }).click()
  await page.getByLabel('Amount (₹)').fill('1000')
  await expect(page.getByTestId('balance-after')).toHaveText('₹500')
  await expect(page.getByText('Still partly paid')).toBeVisible()

  await page.getByRole('button', { name: 'Save payment' }).click()
  await expect(page.getByText('Choose how it was paid')).toBeVisible()
  await expect(page.getByText('Choose who received the money')).toBeVisible()
  await page.getByRole('button', { name: 'Cash' }).click()
  await page.getByLabel('Received by').fill('Anu teacher')
  await page.getByRole('button', { name: 'Save payment' }).click()
  await expect(snack()).toContainText('Payment PAY-0001 saved · ₹1,000')

  // The same period is still the oldest owed: ₹500 left.
  await expect(page.getByRole('button', { name: /Aug 2026 · ₹500 left/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Received by')).toHaveValue('Anu teacher') // remembered
  // A little more than this month goes towards the next month (an advance)…
  await page.getByLabel('Amount (₹)').fill('600')
  await expect(page.getByTestId('advance-note')).toHaveText('₹100 goes towards LKG · Sept 2026 (advance)')
  // …but not more than this month and the next together.
  await page.getByLabel('Amount (₹)').fill('2600')
  await expect(page.getByText("More than what's due – check the amount")).toBeVisible()
  await page.getByRole('button', { name: 'UPI' }).click()
  await page.getByLabel('UPI reference (UTR)').fill('412345678901')
  await page.getByRole('button', { name: 'Save payment' }).click()
  await expect(snack()).toContainText("That is more than what's owed for LKG · Aug 2026 and LKG · Sept 2026 together (₹2,000). Check the amount.")
  await page.getByRole('button', { name: /Full balance ₹500/ }).click()
  await page.getByRole('button', { name: 'Save payment' }).click()
  await expect(snack()).toContainText('Payment PAY-0002 saved · ₹500')
  await snack().getByRole('button', { name: 'View' }).click()
  await expect(page.getByTestId('fees-lk').getByTestId('period').filter({ hasText: /^Aug 2026/ })).toContainText('Paid')
})

test('payment history: a wrong amount is reversed, never edited', async () => {
  // ₹15,000 instead of ₹1,500 is refused outright (more than owed); a wrong ₹1,500 for the wrong month is reversed.
  await page.getByRole('button', { name: 'Pay LKG · Sept 2026' }).click()
  await page.getByRole('button', { name: 'Cash' }).click()
  await page.getByRole('button', { name: 'Save payment' }).click()
  await expect(snack()).toContainText('PAY-0003 saved')
  await snack().getByRole('button', { name: 'View' }).click()

  const history = page.getByTestId('payment-history')
  await expect(history.getByTestId('payment')).toHaveCount(3)
  await expect(history.getByTestId('payment').first()).toContainText('LKG · Sept 2026')
  await history.getByRole('button', { name: 'Reverse PAY-0003' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Reverse payment' }).click()
  await expect(page.getByRole('dialog').getByText('Say why this payment is being reversed')).toBeVisible()
  await page.getByRole('dialog').getByLabel('Reason').fill('Paid for October, not September')
  await page.getByRole('dialog').getByRole('button', { name: 'Reverse payment' }).click()
  await expect(snack()).toContainText('PAY-0003 reversed (PAY-0004)')

  await expect(history.getByTestId('payment')).toHaveCount(4)
  await expect(history.getByTestId('payment').filter({ hasText: 'PAY-0004' })).toContainText('Reversal of PAY-0003')
  await expect(history.getByTestId('payment').filter({ hasText: 'PAY-0004' })).toContainText('−₹1,500')
  await expect(history.getByTestId('payment').filter({ hasText: 'PAY-0003' }).filter({ hasNotText: 'Reversal of' })).toContainText('Reversed')
  await expect(history.getByRole('button', { name: 'Reverse PAY-0003' })).toHaveCount(0)
  await expect(page.getByTestId('fees-lk').getByTestId('period').filter({ hasText: /^Sept 2026/ })).toContainText('Due for 48 days')
})

test('extra charges: admission fee paid, a late fine added', async () => {
  await page.getByRole('button', { name: 'Pay Admission fee' }).click()
  await expect(page.getByRole('button', { name: /Admission fee/ })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Bank transfer' }).click()
  await page.getByRole('button', { name: 'Save payment' }).click()
  await expect(snack()).toContainText('₹2,000')
  await snack().getByRole('button', { name: 'View' }).click()
  await expect(page.getByTestId('charges')).toContainText('Paid')

  await page.getByRole('button', { name: 'Add charge' }).click()
  await page.getByRole('dialog').getByLabel('Amount (₹)').fill('100')
  await page.getByRole('dialog').getByLabel('Reason (optional)').fill('September paid late')
  await page.getByRole('dialog').getByRole('button', { name: 'Add charge' }).click()
  await expect(snack()).toContainText('Late fine added')
  await expect(page.getByTestId('charges')).toContainText('Late fine')
  await page.getByRole('button', { name: 'Cancel Late fine' }).click()
  await expect(snack()).toContainText('Late fine cancelled')
})

test("don't charge a period (e.g. away), then charge it again", async () => {
  await page.getByRole('button', { name: "Don't charge LKG · Sept 2026" }).click()
  await page.getByRole('dialog').getByLabel('Reason').fill('Away for the month')
  await page.getByRole('dialog').getByRole('button', { name: "Don't charge" }).click()
  const sept = page.getByTestId('fees-lk').getByTestId('period').filter({ hasText: /^Sept 2026/ })
  await expect(sept).toContainText('Not charged')
  await expect(sept).toContainText('Away for the month')
  await page.getByRole('button', { name: 'Charge LKG · Sept 2026 again' }).click()
  await expect(sept).toContainText('Due for 48 days')
})

test('Fees screen: who owes and the monthly report', async () => {
  await nav('Fees').click()
  await expect(page.getByRole('heading', { level: 1, name: 'Fees' })).toBeVisible()
  const owes = page.getByTestId('who-owes').getByTestId('owed')
  await expect(owes.first()).toContainText('Dev Krishna')
  await expect(owes.filter({ hasText: 'Dev Krishna' }).first()).toContainText('₹1,300')
  const report = page.getByTestId('month-report')
  await expect(report.getByTestId('collected')).toHaveText('₹3,500') // ₹1,000 + ₹500 + ₹1,500 − ₹1,500 + ₹2,000
  await expect(report).toContainText('Admission fee')
  await expect(report).toContainText('Concessions given · ₹200')
  await page.getByRole('searchbox', { name: 'Search who owes' }).fill('Transport')
  await expect(owes).toHaveCount(1)
  await owes.getByRole('button', { name: /Collect/ }).click()
  await expect(page.getByRole('button', { name: /Transport/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Amount (₹)')).toHaveValue('600')
})

test('the + button opens Record payment with a student search', async () => {
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('button', { name: 'Record a payment' }).click()
  await page.getByRole('searchbox', { name: 'Search students' }).fill('Dev')
  await page.getByRole('list', { name: 'Students' }).getByText('Dev Krishna').click()
  await expect(page.getByRole('button', { name: /Aug 2026 · Due for 83 days/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Amount (₹)')).toHaveValue('1300') // ₹1,500 − ₹200 sibling concession
})

test('dashboard: collected this month and recent payments', async () => {
  await nav('Home').click()
  await expect(page.getByTestId('collected-month')).toContainText('₹3,500')
  await expect(page.getByTestId('recent-payments')).toContainText('Reversal of PAY-0003')
  await expect(page.getByTestId('recent-payments')).toContainText('Aadhya Menon')
})

test('admission form: extras have no days; the admission fee is optional', async () => {
  await nav('Students').click()
  await page.getByRole('button', { name: 'New admission' }).click()
  await expect(page.getByRole('heading', { name: /Extras/ })).toBeVisible()
  await page.getByRole('checkbox', { name: /^Karate/ }).click()
  await expect(page.getByRole('group', { name: 'Karate days' })).toHaveCount(0)
  await expect(page.getByLabel('Karate standard fee (₹)')).toBeVisible()
  await expect(page.getByLabel('Admission fee (₹)')).toBeVisible()
})
