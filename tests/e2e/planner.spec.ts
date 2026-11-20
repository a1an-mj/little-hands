import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// Calendar and to-do list. The laptop's clock says Monday 23 Nov 2026, 10:00 AM.
const userData = mkdtempSync(join(tmpdir(), 'little-hands-e2e-planner-'))
let app: ElectronApplication
let page: Page

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  app = await electron.launch({
    args: [join(__dirname, '../..')],
    env: { ...process.env, LH_USER_DATA: userData, LH_NOW: '2026-11-23T10:00:00' } as Record<string, string>
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.evaluate(() => window.lh.lock.setup('2468'))
  await page.reload()
  const r = await page.evaluate(() =>
    window.lh.students.admit({
      fullName: 'Nyla Nitish',
      joiningDate: '2026-07-01',
      dateOfBirth: '2024-11-27',
      notes: '',
      homeAddress: '',
      photo: null,
      family: { kind: 'new', father: { name: 'Nitish S', phone: '90000 00021' }, mother: { name: '', phone: '' }, emergency: { name: 'Deepika', relationship: 'Mother', phone: '90000 00022' }, extra: [], feeContact: 'father' },
      programs: [{ program: 'dc', startDate: '2026-07-01', schedule: { days: 31 }, fee: { periodMonths: 1, dueDay: '5', standard: '2000', concession: '', concessionReason: '', remarks: '' } }]
    } as never)
  )
  expect(r).toEqual(expect.objectContaining({ ok: true }))
})

test.afterAll(async () => {
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
})

const nav = (name: string) => page.getByRole('navigation', { name: 'Main menu' }).getByRole('button', { name, exact: true })
const snack = () => page.getByRole('status')

test('the menu has Calendar and To-do after Attendance', async () => {
  const names = await page.getByRole('navigation', { name: 'Main menu' }).locator('.dest').allInnerTexts()
  expect(names.map((n) => n.trim())).toEqual(['Home', 'Students', 'Fees', 'Attendance', 'Calendar', 'To-do', 'Reports', 'Settings', 'Lock'])
})

test('to-do: add, see it on the dashboard, tick it done (with undo)', async () => {
  await nav('To-do').click()
  await page.getByLabel('New to-do').fill('Order crayons')
  await page.getByLabel('Due date').fill('2026-11-23')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByTestId('todo-group-today')).toContainText('Order crayons')

  await page.getByRole('button', { name: 'More…' }).click()
  const d = page.getByRole('dialog')
  await d.getByLabel('What needs doing').fill("Get Nyla's emergency numbers in full")
  await d.getByLabel('Due date').fill('2026-11-20')
  await d.getByLabel('Child').fill('Nyla Nitish')
  await d.getByRole('button', { name: 'Add to-do' }).click()
  await expect(snack()).toContainText('To-do added')
  await expect(page.getByTestId('todo-group-overdue')).toContainText('3 days late')
  await expect(page.getByTestId('todo-count')).toHaveText('2 to do · 1 overdue')

  await nav('Home').click()
  const card = page.getByTestId('todo-today')
  await expect(card.getByTestId('todo')).toHaveCount(2)
  await card.getByRole('checkbox', { name: 'Done: Order crayons' }).click()
  await expect(snack()).toContainText('Done: Order crayons')
  await expect(card.getByTestId('todo')).toHaveCount(1)
  await snack().getByRole('button', { name: 'Undo' }).click()
  await expect(card.getByTestId('todo')).toHaveCount(2)
  await card.getByRole('checkbox', { name: 'Done: Order crayons' }).click()
  await expect(card.getByTestId('todo')).toHaveCount(1)
})

test("a child's to-dos are on their profile", async () => {
  await page.getByTestId('todo-today').getByRole('button', { name: 'Nyla Nitish' }).click()
  const box = page.getByTestId('child-todos')
  await expect(box).toContainText("Get Nyla's emergency numbers in full")
  await box.getByRole('button', { name: 'Add a to-do' }).click()
  await page.getByRole('dialog').getByLabel('What needs doing').fill('Ask about the long absence')
  await page.getByRole('dialog').getByRole('button', { name: 'Add to-do' }).click()
  await expect(box.getByTestId('todo')).toHaveCount(2)
})

test('calendar: birthdays and dated to-dos show; a holiday closes the school', async () => {
  await nav('Calendar').click()
  await expect(page.getByTestId('cal-month')).toHaveText('November 2026')
  await expect(page.getByTestId('day-2026-11-27')).toContainText('Nyla Nitish turns 2')
  await expect(page.getByTestId('day-2026-11-20')).toContainText("Get Nyla's emergency numbers in full")

  await page.getByTestId('day-2026-11-25').click()
  await page.getByRole('button', { name: 'Add event' }).click()
  const d = page.getByRole('dialog')
  await d.getByRole('button', { name: 'Meeting' }).click()
  await d.getByLabel('Title').fill("Parents' meeting")
  await expect(d.getByLabel('Date')).toHaveValue('2026-11-25')
  await d.getByLabel('Time').fill('16:00')
  await d.getByRole('button', { name: 'Add event' }).click()
  await expect(page.getByTestId('day-panel')).toContainText('Meeting · 4:00 PM')

  await page.getByTestId('day-2026-11-24').click()
  await page.getByRole('button', { name: 'Add event' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Holiday' }).click()
  await page.getByRole('dialog').getByLabel('Title').fill('Local festival')
  await page.getByRole('dialog').getByRole('button', { name: 'Add event' }).click()
  await expect(snack()).toContainText('Holiday added. The school is closed that day.')
  await expect(page.getByTestId('day-2026-11-24')).toHaveClass(/closed/)

  // Attendance agrees: nobody is expected on the 24th.
  expect(await page.evaluate(() => window.lh.attendance.day('2026-11-24'))).toEqual(
    expect.objectContaining({ ok: true, value: expect.objectContaining({ closed: { reason: 'Local festival' } }) })
  )

  // Removing the holiday opens the school again.
  await page.getByTestId('day-panel').getByRole('button', { name: 'Local festival' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()
  await expect(snack()).toContainText('Event removed')
  expect(await page.evaluate(() => window.lh.attendance.day('2026-11-24'))).toEqual(
    expect.objectContaining({ value: expect.objectContaining({ closed: null }) })
  )
})

test('moving between months', async () => {
  await page.getByRole('button', { name: 'Next month' }).click()
  await expect(page.getByTestId('cal-month')).toHaveText('December 2026')
  await page.getByRole('button', { name: 'Today' }).click()
  await expect(page.getByTestId('cal-month')).toHaveText('November 2026')
})
