import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// Settings → Import students, from the spreadsheet of paper admission forms (CSV).
const userData = mkdtempSync(join(tmpdir(), 'little-hands-e2e-import-'))
const file = join(userData, 'students.csv')
let app: ElectronApplication
let page: Page

const HEADER =
  "No,Photo file,Form heading (top),Enrolment no,Joining date,Child's name,Date of birth,Age on form,Class (as written),Other school,Address," +
  "Father's name,Father's occupation,Father's phone,Mother's name,Mother's occupation,Mother's phone,Emergency contact,Courses ticked,Fees due by (on form),Check"
const ROWS = [
  '25,a.jpg,LKG 2026-27,LHL-04,2026-06-03,Janvi An Bipin,2021-10-26,4,LKG,Little Hands,"Flat 4B, Thykoodam",Bipin T.V,Bank Employee,9496565684 ?,Anjana K.V,IT Employee,8281738110,Aravind 9447788965,LKG,5th,"Twin of Tanvi."',
  '26,b.jpg,LKG 2026-27,LHL-03,2026-06-03,Tanvi An Bipin,2021-10-26,4,LKG,Little Hands,"Flat 4B, Thykoodam",Bipin T.V,Bank Employee,9496565688 ?,Anjana K.V,IT Employee,8281738110,Aravind 9447788965,LKG,5th,"Twin of Janvi."',
  '4,c.jpg,,,2026-08-10,Mayukh Adiyodi,2018-12-21,7,II,"Bhavans, Girinagar",Starpark Apartments,Suresh A.V,,,Raji J S,KSEBL,9809044044,7356399099,Afterschool care,5th,"Afterschool: Tuition or Daycare?"',
  '3,d.jpg,,,2026-10-20 ?,Thannira H Kumar ?,2023-01-11,3.6,,,Elamkulam,Hari Kumar ?,,,Sandhya Vas ?,Business,6380816778,,(none ticked),5th,No course ticked.'
]

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  writeFileSync(file, '﻿' + [HEADER, ...ROWS].join('\r\n'))
  app = await electron.launch({
    args: [join(__dirname, '../..')],
    env: { ...process.env, LH_USER_DATA: userData, LH_NOW: '2026-11-21T10:00:00' } as Record<string, string>
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.evaluate(() => window.lh.lock.setup('2468'))
  await page.reload()
  // The file picker can't be clicked in a test: it answers with the spreadsheet above.
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, file)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
})

const nav = (name: string) => page.getByRole('navigation', { name: 'Main menu' }).getByRole('button', { name, exact: true })

test('preview, then add the children', async () => {
  await nav('Settings').click()
  await page.getByRole('button', { name: 'Choose spreadsheet…' }).click()
  const d = page.getByRole('dialog')
  await expect(d.getByTestId('import-summary')).toHaveText('3 children will be added, 1 left out.')
  await expect(d.getByTestId('import-row').filter({ hasText: 'Tanvi An Bipin' })).toContainText('LKG · same family as Janvi An Bipin')
  await expect(d.getByTestId('import-row').filter({ hasText: 'Mayukh Adiyodi' })).toContainText('Tuition')
  await expect(d.getByTestId('import-row').filter({ hasText: 'Thannira H Kumar' })).toContainText('No program on the form')
  await d.getByRole('button', { name: 'Add 3 children' }).click()
  await expect(page.getByTestId('import-result')).toHaveText("3 children added. Set their fees on each child's profile.")
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click()
})

test('the children are in the app, with the form notes and ₹0 fees', async () => {
  await nav('Students').click()
  await page.getByRole('region', { name: 'Student list' }).getByText('Mayukh Adiyodi', { exact: true }).click()
  await expect(page.getByTestId('afterschool')).toHaveText('After school · Bhavans, Girinagar, II')
  await expect(page.getByTestId('program-tu')).toContainText('₹0 / month')
  await page.getByRole('tab', { name: 'Notes · 1' }).click()
  await expect(page.getByText(/To check: Afterschool: Tuition or Daycare\?/)).toBeVisible()
})

test('importing the same file again adds no one', async () => {
  await nav('Settings').click()
  await page.getByRole('button', { name: 'Choose spreadsheet…' }).click()
  await expect(page.getByRole('dialog').getByTestId('import-summary')).toHaveText('0 children will be added, 4 left out.')
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Add 0 children' })).toBeDisabled()
})
