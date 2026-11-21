import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// Attendance and the dashboard, with the laptop's clock set to Monday 2 Nov 2026, 10:15 AM.
const userData = mkdtempSync(join(tmpdir(), 'little-hands-e2e-attendance-'))
let app: ElectronApplication
let page: Page

test.describe.configure({ mode: 'serial' })

const program = (code: string, days: number) => ({
  program: code,
  startDate: '2026-06-01',
  schedule: { days },
  fee: { periodMonths: 1, dueDay: '1', standard: '1500', concession: '', concessionReason: '', remarks: '' }
})
const admission = (fullName: string, phone: string, programs: unknown[]) => ({
  fullName,
  joiningDate: '2026-06-01',
  notes: '',
  homeAddress: '',
  photo: null,
  family: {
    kind: 'new',
    father: { name: 'Father of ' + fullName, phone },
    mother: { name: '', phone: '' },
    emergency: { name: 'Grandmother', relationship: 'Grandmother', phone: phone.slice(0, -1) + '9' },
    extra: [],
    feeContact: 'father'
  },
  programs
})

test.beforeAll(async () => {
  app = await electron.launch({
    args: [join(__dirname, '../..')],
    env: { ...process.env, LH_USER_DATA: userData, LH_NOW: '2026-11-02T10:15:00' } as Record<string, string>
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.evaluate(() => window.lh.lock.setup('2468'))
  const children = [
    admission('Aadhya Menon', '90000 00014', [program('lk', 31), program('tu', 21)]),
    admission('Dev Krishna', '90000 00061', [program('lk', 31)])
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

const arrivals = () => page.getByRole('list', { name: 'Arrivals' }).getByTestId('arrival')
const row = (name: string, prog: string) => arrivals().filter({ hasText: name }).filter({ has: page.locator(`.tag.${prog}`) })
const arrivedCard = () => page.getByTestId('arrived-today')
const snack = () => page.getByRole('status')

test("dashboard: today's arrivals and counts, no expected times or 'late'", async () => {
  await expect(arrivals()).toHaveCount(3)
  await expect(arrivedCard()).toContainText('0 of 2')
  await expect(arrivedCard()).toContainText('2 yet to arrive · 0 absent')
  await expect(row('Aadhya Menon', 'lk')).toContainText('Not marked yet')
  await expect(row('Aadhya Menon', 'tu')).toContainText('Not marked yet')
  await expect(page.getByRole('button', { name: 'Absent: Aadhya Menon, Tuition' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Arrivals' })).not.toContainText(/late|Expected|\d [AP]M/)
  await expect(page.getByTestId('by-program-lk')).toContainText('2')
  await expect(page.getByTestId('by-program-tu')).toContainText('1')
  await expect(page.getByText('1 attend kindergarten + Tuition')).toBeVisible()
})

test('arrived, undo, arrived again, then left', async () => {
  await page.getByRole('button', { name: 'Arrived: Aadhya Menon, LKG' }).click()
  await expect(snack()).toContainText(/Aadhya marked arrived at 10:1\d AM/)
  await expect(row('Aadhya Menon', 'lk')).toContainText(/Arrived 10:1\d AM/)
  await expect(arrivedCard()).toContainText('1 of 2')

  await snack().getByRole('button', { name: 'Undo' }).click()
  await expect(row('Aadhya Menon', 'lk')).toContainText('Not marked yet')
  await expect(arrivedCard()).toContainText('0 of 2')

  await page.getByRole('button', { name: 'Arrived: Aadhya Menon, LKG' }).click()
  await page.getByRole('button', { name: 'Mark left: Aadhya Menon, LKG' }).click()
  await expect(row('Aadhya Menon', 'lk')).toContainText(/Left 10:1\d AM/)
  await expect(arrivedCard()).toContainText('1 of 2')
})

test('absent, and the filters', async () => {
  await page.getByRole('button', { name: 'Absent: Dev Krishna, LKG' }).click()
  await expect(snack()).toContainText('Dev marked absent today')
  await expect(row('Dev Krishna', 'lk')).toContainText('Absent today')
  await expect(arrivedCard()).toContainText('0 yet to arrive · 1 absent')

  await page.getByRole('group', { name: 'Filter arrivals' }).getByRole('button', { name: /Not yet/ }).click()
  await expect(arrivals()).toHaveCount(1)
  await expect(arrivals()).toContainText('Tuition')
  await page.getByRole('group', { name: 'Filter arrivals' }).getByRole('button', { name: /Arrived/ }).click()
  await expect(arrivals()).toHaveCount(1)
  await expect(arrivals()).toContainText('Aadhya Menon')
  await page.getByRole('group', { name: 'Filter arrivals' }).getByRole('button', { name: 'All' }).click()
})

test('attendance screen: mark the rest present and save', async () => {
  await page.getByRole('button', { name: 'Open attendance for everyone' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Attendance' })).toBeVisible()
  await expect(page.getByTestId('att-counts')).toHaveText('1 present · 1 absent · 1 not marked yet')
  await page.getByRole('button', { name: 'Mark the rest present' }).click()
  await expect(page.getByTestId('att-counts')).toHaveText('2 present · 1 absent · 0 not marked yet')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(snack()).toContainText('Attendance saved · 2 present, 1 absent')
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()
})

test('attendance screen: an earlier day', async () => {
  await page.getByLabel('Day', { exact: true }).fill('2026-10-30') // a Friday: Tuition too
  await expect(page.getByRole('heading', { name: 'Attendance · Friday, 30 October' })).toBeVisible()
  await expect(page.getByTestId('att-row')).toHaveCount(3)
  await expect(page.getByTestId('att-counts')).toHaveText('0 present · 0 absent · 3 not marked yet')
  await page.getByRole('group', { name: 'Attendance for Dev Krishna, LKG' }).getByRole('button', { name: 'Absent' }).click()
  await page.getByRole('button', { name: 'Mark the rest present' }).click()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(snack()).toContainText('Attendance saved · 2 present, 1 absent')
  // A future day can't be picked.
  await expect(page.getByLabel('Day', { exact: true })).toHaveAttribute('max', '2026-11-02')
})

test('profile: today, the last school days, and a correction', async () => {
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('button', { name: 'Students' }).click()
  await page.getByRole('region', { name: 'Student list' }).getByText('Aadhya Menon', { exact: true }).click()
  const today = page.getByTestId('today-card')
  await expect(today).toContainText(/LKG arrived\s*10:1\d AM/)
  await expect(today).not.toContainText('expected')
  await expect(today).toContainText(/LKG left\s*10:1\d AM/)
  await expect(today).toContainText('Tuition arrivedPresent')

  await page.getByRole('tab', { name: 'Attendance' }).click()
  const lkg = page.getByTestId('history-lk')
  await expect(lkg.getByTestId('history-day').first()).toContainText('Today')
  const fri = lkg.getByTestId('history-day').filter({ hasText: 'Fri 30 Oct' })
  await expect(fri).toContainText('Present · out —')

  await page.getByRole('button', { name: 'Change Fri 30 Oct, LKG' }).click()
  await page.getByRole('dialog').getByLabel('Arrived at').fill('08:50')
  await page.getByRole('dialog').getByLabel('Left at').fill('12:35')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(fri).toContainText('In 8:50 AM · out 12:35 PM')
  await expect(fri).toContainText('Present')
  await expect(fri).not.toContainText('late')

  await page.getByRole('button', { name: 'Change Thu 29 Oct, LKG' }).click()
  await page.getByRole('dialog').getByRole('radio', { name: 'Absent' }).check()
  await page.getByRole('dialog').getByLabel('Reason').fill('fever')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(lkg.getByTestId('history-day').filter({ hasText: 'Thu 29 Oct' })).toContainText('Absent · fever')
})

test('the rail and the students list open the attendance screen', async () => {
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('button', { name: 'Attendance' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Attendance' })).toBeVisible()
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('button', { name: 'Students' }).click()
  await page.getByRole('button', { name: 'Mark attendance' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Attendance' })).toBeVisible()
})

test('home search opens the students list', async () => {
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('button', { name: 'Home' }).click()
  // Wait for Home itself: during the screen change the previous screen (with its own search) is still there.
  await expect(page.getByRole('heading', { level: 2, name: "Today's arrivals" })).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search students' }).fill('Dev')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: 'Students' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Student list' }).getByText('Dev Krishna', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Student list' }).getByText('Aadhya Menon', { exact: true })).toHaveCount(0)
})

test('school closed today, then open again', async () => {
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('button', { name: 'Home' }).click()
  await page.getByRole('button', { name: 'School closed today' }).click()
  await page.getByRole('dialog').getByLabel('Reason').fill('Onam')
  await page.getByRole('dialog').getByRole('button', { name: 'Mark as closed' }).click()
  await expect(page.getByTestId('closed-banner')).toContainText('School closed · Onam')
  await expect(arrivedCard()).toContainText('School closed')
  await expect(page.getByRole('list', { name: 'Arrivals' })).toHaveCount(0)

  await page.getByTestId('closed-banner').getByRole('button', { name: 'Open again' }).click()
  await expect(page.getByTestId('closed-banner')).toHaveCount(0)
  await expect(arrivals()).toHaveCount(3)
})

test('a past day marked closed shows on the profile', async () => {
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('button', { name: 'Attendance' }).click()
  await page.getByLabel('Day', { exact: true }).fill('2026-10-27')
  await page.getByRole('button', { name: 'School was closed this day' }).click()
  await page.getByRole('dialog').getByLabel('Reason').fill('Strike')
  await page.getByRole('dialog').getByRole('button', { name: 'Mark as closed' }).click()
  await expect(page.getByTestId('closed-banner')).toContainText('School closed · Strike')
  await expect(page.getByTestId('att-row')).toHaveCount(0)

  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('button', { name: 'Students' }).click()
  await page.getByRole('region', { name: 'Student list' }).getByText('Dev Krishna', { exact: true }).click()
  await page.getByRole('tab', { name: 'Attendance' }).click()
  await expect(page.getByTestId('history-lk').getByTestId('history-day').filter({ hasText: 'Tue 27 Oct' })).toContainText('School closed · Strike')
})

test('admission offers Nursery and Daycare', async () => {
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('button', { name: 'Students' }).click()
  await page.getByRole('button', { name: 'New admission' }).click()
  await page.getByRole('checkbox', { name: /^Nursery/ }).click()
  await expect(page.getByLabel('Nursery arrives')).toHaveCount(0) // no fixed times
  await expect(page.getByRole('group', { name: 'Nursery days' }).getByRole('button', { pressed: true })).toHaveText(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
  await page.getByRole('checkbox', { name: /^Daycare/ }).click()
  await expect(page.getByRole('checkbox', { name: /^Daycare/ })).toContainText('Not schooling')
  await expect(page.getByText(/usually in only one/)).toHaveCount(0) // Daycare is not a class
  await page.getByRole('checkbox', { name: /^LKG/ }).click()
  await expect(page.getByText('A child is usually in only one of Playgroup, Nursery, LKG or UKG. Please check.')).toBeVisible()
})
