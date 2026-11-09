import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// Programs, timings and fees, in the order the owner would meet them.
const userData = mkdtempSync(join(tmpdir(), 'little-hands-e2e-enrollments-'))
let app: ElectronApplication
let page: Page

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const show = (d: Date) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(d)
const now = new Date()
const joined = new Date(now.getFullYear(), now.getMonth() - 2, 1)
const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  app = await electron.launch({
    args: [join(__dirname, '../..')],
    env: { ...process.env, LH_USER_DATA: userData } as Record<string, string>
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
const dialog = () => page.getByRole('dialog')
const lkg = () => page.getByTestId('program-lk')
const tuition = () => page.getByTestId('program-tu')

test('admission: LKG and Tuition, each with its own timings and fee', async () => {
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('button', { name: 'Students' }).click()
  await page.getByRole('button', { name: 'New admission' }).click()
  await field('Full name').fill('Aadhya Menon')
  await field('Joining date').fill(iso(joined))
  await field("Father's name").fill('Suresh Menon')
  await field("Father's phone").fill('90000 00014')
  await field('Emergency phone').fill('90000 00016')

  await page.getByRole('checkbox', { name: /LKG/ }).click()
  await expect(field('LKG arrives')).toHaveValue('08:45')
  await expect(field('LKG leaves')).toHaveValue('12:30')
  await expect(field('LKG starts on')).toHaveValue(iso(joined))
  await field('LKG standard fee (₹)').fill('1500')

  await page.getByRole('checkbox', { name: /Tuition/ }).click()
  await expect(page.getByRole('group', { name: 'Tuition days' }).getByRole('button', { pressed: true })).toHaveText(['Mon', 'Wed', 'Fri'])
  await field('Tuition arrives').fill('16:30')
  await field('Tuition standard fee (₹)').fill('1,000')
  await field('Tuition concession (₹)').fill('200')
  await expect(page.getByTestId('agreed-tu')).toHaveText('₹800')
  await expect(page.getByTestId('monthly-total')).toContainText('₹2,300 across 2 programs')

  // Two kindergarten classes at once gets a warning, not a block.
  await page.getByRole('checkbox', { name: /UKG/ }).click()
  await expect(page.getByText('A child is usually in only one of Playgroup, LKG or UKG. Please check.')).toBeVisible()
  await page.getByRole('checkbox', { name: /UKG/ }).click()
  await expect(page.getByText(/usually in only one/)).toHaveCount(0)

  await page.getByRole('button', { name: 'Save student' }).click()
  await expect(page.getByText('Say why there is a concession')).toBeVisible()
  await field('Tuition reason for concession').fill('Sibling')
  await page.getByRole('button', { name: 'Save student' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'Aadhya Menon' })).toBeVisible()
  await expect(lkg()).toContainText('Mon–Fri · 8:45 AM – 12:30 PM')
  await expect(lkg()).toContainText('₹1,500 / month')
  await expect(lkg()).toContainText(`No concession · since ${show(joined)}`)
  await expect(tuition()).toContainText('Mon, Wed, Fri · 4:30 – 5:30 PM')
  await expect(tuition()).toContainText('₹800 / month')
  await expect(tuition()).toContainText('₹1,000 − ₹200 concession (Sibling)')
})

test('a fee rise from next month keeps the current fee until then', async () => {
  await page.getByRole('button', { name: 'Edit LKG' }).click()
  await expect(dialog().getByRole('radio', { name: /A change from a date/ })).toBeChecked()
  await dialog().getByLabel('LKG standard fee (₹)').fill('1800')
  await dialog().getByLabel('Change starts on').fill(iso(nextMonth))
  await dialog().getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('LKG saved')).toBeVisible()
  await expect(lkg()).toContainText('₹1,500 / month')
  await expect(lkg()).toContainText(`From ${show(nextMonth)}: ₹1,800 / month`)
})

test('fixing a mistake corrects the timings in place', async () => {
  await page.getByRole('button', { name: 'Edit Tuition' }).click()
  await dialog().getByRole('radio', { name: /Fix a mistake/ }).check()
  await dialog().getByLabel('Tuition leaves').fill('18:00')
  await dialog().getByRole('button', { name: 'Save' }).click()
  await expect(tuition()).toContainText('Mon, Wed, Fri · 4:30 – 6:00 PM')
  await expect(tuition()).not.toContainText('From ')
})

test('end Tuition, then continue it again', async () => {
  await page.getByRole('button', { name: 'Edit Tuition' }).click()
  await dialog().getByRole('button', { name: 'End program' }).click()
  await dialog().getByLabel('Last day *').fill(iso(yesterday))
  await dialog().getByLabel('Reason').fill('Exams over')
  await dialog().getByRole('button', { name: 'End Tuition' }).click()
  await expect(tuition()).toHaveCount(0)
  await expect(page.getByTestId('ended-tu')).toContainText('Exams over')

  await page.getByTestId('ended-tu').getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Tuition continues')).toBeVisible()
  await expect(tuition()).toBeVisible()
})

test('students list shows programs and filters by them', async () => {
  await page.getByRole('button', { name: 'Back to all students' }).click()
  const list = page.getByRole('region', { name: 'Student list' })
  await expect(list.locator('.tag.lk')).toHaveText('LKG')
  await expect(list.locator('.tag.tu')).toHaveText('Tuition')
  await page.getByRole('group', { name: 'Program' }).getByRole('button', { name: 'Tuition' }).click()
  await expect(list.getByText('Aadhya Menon')).toBeVisible()
  await page.getByRole('group', { name: 'Program' }).getByRole('button', { name: 'UKG' }).click()
  await expect(page.getByText('No students match.')).toBeVisible()
  await page.getByRole('group', { name: 'Program' }).getByRole('button', { name: 'All programs' }).click()
  await list.getByText('Aadhya Menon').click()
})

test('adding a second kindergarten class shows a warning', async () => {
  await page.getByRole('button', { name: 'Add program' }).click()
  await expect(dialog().getByRole('button', { name: 'LKG' })).toHaveCount(0) // already in it
  await dialog().getByRole('button', { name: 'Playgroup' }).click()
  await expect(dialog().getByText(/already in a kindergarten class/)).toBeVisible()
  await dialog().getByRole('button', { name: 'Cancel' }).click()
})

test('graduating ends the programs from today', async () => {
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await dialog().getByLabel('Status').selectOption('graduated')
  await expect(dialog().getByText('LKG and Tuition will end today.', { exact: false })).toBeVisible()
  await dialog().getByRole('button', { name: 'Save' }).click()
  await expect(lkg()).toContainText(`Last day ${show(now)}`)
  await expect(page.getByRole('button', { name: 'Add program' })).toHaveCount(0)
})
