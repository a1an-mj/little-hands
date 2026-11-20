import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// The owner's paper admission form: DOB, afterschool children, occupations, fees by the 5th with the
// first month by days, and moving a class up. The laptop's clock says Sunday 15 Nov 2026, 10:00 AM.
const userData = mkdtempSync(join(tmpdir(), 'little-hands-e2e-paper-'))
let app: ElectronApplication
let page: Page

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  app = await electron.launch({
    args: [join(__dirname, '../..')],
    env: { ...process.env, LH_USER_DATA: userData, LH_NOW: '2026-11-15T10:00:00' } as Record<string, string>
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.evaluate(() => window.lh.lock.setup('2468'))
  await page.reload()
})

test.afterAll(async () => {
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
})

const field = (label: string) => page.getByLabel(label)
const nav = (name: string) => page.getByRole('navigation', { name: 'Main menu' }).getByRole('button', { name, exact: true })
const snack = () => page.getByRole('status')

test('admission: date of birth, an afterschool child must be in Tuition or Daycare, occupations', async () => {
  await nav('Students').click()
  await page.getByRole('button', { name: 'New admission' }).click()
  await field('Full name').fill('Daksha S')
  await field('Joining date').fill('2026-11-15')
  await field('Date of birth').fill('2021-04-01')
  await expect(page.getByText('5 years')).toBeVisible()
  await page.getByText('Studies at another school and comes here after school').click()
  await field('Their school').fill("Bhavan's Balamandir")
  await field('Class there').fill('UKG')
  await field("Father's name").fill('Sarath')
  await field("Father's phone").fill('90000 00051')
  await field("Father's occupation").fill('Electrician')
  await field("Mother's name").fill('Remya')
  await field("Mother's occupation").fill('Accountant')
  await field('Emergency phone').fill('90000 00017')

  await page.getByRole('checkbox', { name: /^LKG/ }).click()
  await field('LKG standard fee (₹)').fill('2000')
  await page.getByRole('button', { name: 'Save student' }).click()
  await expect(page.getByText('A child who comes after school must be in Tuition or Daycare')).toBeVisible()
  await page.getByRole('checkbox', { name: /^LKG/ }).click()
  await page.getByRole('checkbox', { name: /^Daycare/ }).click()
  await expect(field('Daycare due on day')).toHaveValue('5')
  await field('Daycare standard fee (₹)').fill('2000')
  await page.getByRole('button', { name: 'Save student' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'Daksha S' })).toBeVisible()
  await expect(page.getByTestId('age')).toHaveText('5 years old')
  await expect(page.getByTestId('afterschool')).toHaveText("After school · Bhavan's Balamandir, UKG")
  await expect(page.getByTestId('guardian').filter({ hasText: 'Sarath' })).toContainText('Electrician')
})

test('joins on the 15th: 15–30 Nov is charged by days; ₹2,000 at joining also covers part of December', async () => {
  await page.getByRole('tab', { name: 'Fees & payments' }).click()
  const daycare = page.getByTestId('fees-dc')
  await expect(daycare).toContainText('₹2,000 / month · due by the 5th')
  await expect(daycare.getByTestId('period').first()).toContainText('Dec 2026')
  await expect(daycare.getByTestId('period').filter({ hasText: /^15–30 Nov 2026/ })).toContainText('₹1,066.67')

  await page.getByRole('button', { name: 'Pay Daycare · 15–30 Nov 2026' }).click()
  await field('Amount (₹)').fill('2000')
  await expect(page.getByTestId('advance-note')).toHaveText('₹933.33 goes towards Daycare · Dec 2026 (advance)')
  await page.getByRole('button', { name: 'Cash' }).click()
  await field('Received by').fill('Owner')
  await page.getByRole('button', { name: 'Save payment' }).click()
  await expect(snack()).toContainText('Payment PAY-0001 saved · ₹2,000 (₹933.33 of it towards Daycare · Dec 2026, PAY-0002)')
  await snack().getByRole('button', { name: 'View' }).click()
  const dec = page.getByTestId('fees-dc').getByTestId('period').filter({ hasText: /^Dec 2026/ })
  await expect(dec).toContainText('due 5 Dec 2026')
  await expect(page.getByTestId('owed-now')).toHaveText('₹0')
})

test('move a whole class up for the new school year', async () => {
  for (const child of [
    { fullName: 'Aadhya Menon', phone: '90000 00014' },
    { fullName: 'Dev Krishna', phone: '90000 00061' }
  ]) {
    const r = await page.evaluate(
      (c) =>
        window.lh.students.admit({
          fullName: c.fullName,
          joiningDate: '2026-06-01',
          notes: '',
          homeAddress: '',
          photo: null,
          family: { kind: 'new', father: { name: 'F', phone: c.phone }, mother: { name: '', phone: '' }, emergency: { name: 'G', relationship: 'Gran', phone: c.phone.slice(0, -1) + '9' }, extra: [], feeContact: 'father' },
          programs: [{ program: 'lk', startDate: '2026-06-01', schedule: { days: 31 }, fee: { periodMonths: 1, dueDay: '5', standard: '1500', concession: '', concessionReason: '', remarks: '' } }]
        } as never),
      child
    )
    expect(r).toEqual(expect.objectContaining({ ok: true }))
  }
  await nav('Students').click()
  await page.getByRole('group', { name: 'Program' }).getByRole('button', { name: 'LKG' }).click()
  await page.getByRole('button', { name: 'Move all to UKG…' }).click()
  const d = page.getByRole('dialog')
  await expect(d.getByLabel('UKG starts on')).toHaveValue('2027-06-01')
  await d.getByLabel('UKG standard fee (₹)').fill('1800')
  await d.getByRole('button', { name: 'Move 2 up' }).click()
  await expect(d.getByTestId('move-result')).toHaveText('2 children moved up to UKG.')
  await d.getByRole('button', { name: 'Done' }).click()

  await page.getByRole('region', { name: 'Student list' }).getByText('Aadhya Menon', { exact: true }).click()
  await expect(page.getByTestId('program-lk')).toContainText('Last day 31 May 2027')
  await expect(page.getByTestId('program-uk')).toContainText('Starts 1 Jun 2027')
  await expect(page.getByTestId('program-uk')).toContainText('₹1,800 / month')
})
