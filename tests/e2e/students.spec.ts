import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// Runs in order, like the owner's first day with the Students module.
const userData = mkdtempSync(join(tmpdir(), 'little-hands-e2e-students-'))
const photoFile = join(userData, 'photo.png')
// A small 8×6 PNG (wider than tall, so the square crop is exercised).
writeFileSync(
  photoFile,
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAK0lEQVR4nGM4EWCDFTGcSLHBihhOVNhgRQwnemywIoYTC2ywIoYTW2ywIgB28kkhDaKRNwAAAABJRU5ErkJggg==', 'base64')
)

let app: ElectronApplication
let page: Page
const year = new Date().getFullYear()

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  app = await electron.launch({
    args: [join(__dirname, '../..')],
    env: { ...process.env, LH_USER_DATA: userData } as Record<string, string>
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  // Set the PIN directly (the PIN screens have their own tests), then reload into the app.
  await page.evaluate(() => window.lh.lock.setup('2468'))
  await page.reload()
  // The real file picker can't be clicked by a test, so it returns our photo instead.
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog
  }, photoFile)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
})

const menu = () => page.getByRole('navigation', { name: 'Main menu' })
const field = (label: string | RegExp) => page.getByLabel(label, { exact: typeof label === 'string' ? false : undefined })
const list = () => page.getByRole('region', { name: 'Student list' })

test('the student list starts empty', async () => {
  await menu().getByRole('button', { name: 'Students' }).click()
  await expect(page.getByText('No students yet.')).toBeVisible()
  await expect(page.getByText('0 active · 0 inactive · 0 graduated')).toBeVisible()
})

test('admission form shows what is missing', async () => {
  await page.getByRole('button', { name: 'New admission' }).click()
  await expect(page.getByRole('heading', { name: 'New admission' })).toBeVisible()
  await expect(field('Student ID')).toHaveValue(`LH-${year}-001`)

  await page.getByRole('button', { name: 'Save student' }).click()
  await expect(page.getByText("Enter the child's full name")).toBeVisible()
  await expect(page.getByText('An emergency phone number is needed')).toBeVisible()
  await expect(page.getByText(/Choose who pays the fees/)).toBeVisible()
  await expect(page.getByText('Tick at least one program')).toBeVisible()

  await field("Father's phone").fill('12345')
  await page.getByRole('button', { name: 'Save student' }).click()
  await expect(page.getByText('Enter a 10-digit phone number')).toBeVisible()
})

test('admit a child with parents, emergency contact, notes and photo', async () => {
  await field('Full name').fill('Aadhya Menon')
  await field("Father's name").fill('Suresh Menon')
  await field("Father's phone").fill('90000 00014')
  await field("Mother's name").fill('Lakshmi Menon')
  await field("Mother's phone").fill('9000000015')
  await field('Emergency contact').fill('Sarojini Amma')
  await field('Relationship').fill('Grandmother')
  await field('Emergency phone').fill('90000 00016')
  await field('Home address').fill('Rose Villa, Kochi')
  await field('Notes for staff').fill('Peanut allergy')
  await page.getByRole('checkbox', { name: /LKG/ }).click()
  await field('LKG standard fee (₹)').fill('1500')
  await page.getByRole('button', { name: 'Add photo, optional' }).click()
  await expect(page.getByRole('button', { name: 'Change photo' })).toBeVisible()

  await page.getByRole('button', { name: 'Save student' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'Aadhya Menon' })).toBeVisible()
  await expect(page.getByText('Aadhya Menon has been admitted')).toBeVisible()
  await expect(page.getByText(`LH-${year}-001`)).toBeVisible()
  await expect(page.getByText('No photo yet')).toHaveCount(0)

  const guardians = page.getByTestId('guardian')
  await expect(guardians).toHaveCount(3)
  await expect(guardians.nth(0)).toContainText('Suresh Menon')
  await expect(guardians.nth(0)).toContainText('Main')
  await expect(guardians.nth(0)).toContainText('+91 90000 00014')
  await expect(guardians.nth(2)).toContainText('Emergency')
  await expect(page.getByText('Rose Villa, Kochi')).toBeVisible()

  await page.getByRole('tab', { name: /Notes/ }).click()
  await expect(page.getByText('Peanut allergy')).toBeVisible()
})

test('find the child by name, ID or parent phone', async () => {
  await page.getByRole('button', { name: 'Back to all students' }).click()
  await expect(list().getByText('Aadhya Menon')).toBeVisible()
  await expect(list()).toContainText('Suresh Menon · Father')

  const search = page.getByRole('searchbox', { name: 'Search students' })
  for (const q of ['aadhya', `LH-${year}-001`, '90000 00016']) {
    await search.fill(q)
    await expect(list().getByText('Aadhya Menon')).toBeVisible()
  }
  await search.fill('nobody')
  await expect(page.getByText('No students match.')).toBeVisible()
  await search.fill('')
  await expect(list().getByText('Aadhya Menon')).toBeVisible()
})

test('a brother joins: same family, shared guardians', async () => {
  await page.getByRole('button', { name: 'New admission' }).click()
  await field('Full name').fill('Arav Menon')
  await page.getByRole('button', { name: 'Same family as an existing student' }).click()
  const dlg = page.getByRole('dialog', { name: 'Same family as…' })
  await dlg.getByRole('searchbox').fill('Aadhya')
  await dlg.getByRole('button', { name: /Aadhya Menon/ }).click()
  await expect(page.getByText(/Same parents and guardians as/)).toBeVisible()
  await expect(field('Home address')).toHaveValue('Rose Villa, Kochi')
  await page.getByRole('checkbox', { name: /UKG/ }).click()
  await field('UKG standard fee (₹)').fill('1800')
  await page.getByRole('button', { name: 'Save student' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'Arav Menon' })).toBeVisible()
  await expect(page.getByText(`LH-${year}-002`)).toBeVisible()
  await expect(page.getByTestId('guardian')).toHaveCount(3)
  await expect(page.getByTestId('guardian').first()).toContainText('Also for Aadhya Menon')
})

test('change the main contact and remove a guardian (only for this child)', async () => {
  await page.getByRole('button', { name: 'Edit Lakshmi Menon' }).click()
  await page.getByRole('button', { name: 'Make main contact for fees' }).click()
  await expect(page.getByText('Lakshmi Menon is now the main contact for fees')).toBeVisible()
  await expect(page.getByTestId('guardian').first()).toContainText('Lakshmi Menon')

  await page.getByRole('button', { name: 'Edit Sarojini Amma' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByText(/They stay listed for Aadhya Menon/)).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByTestId('guardian')).toHaveCount(2)
})

test('add a guardian and an important note', async () => {
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByLabel('Name').fill('Joseph')
  await dlg.getByLabel('Relationship').fill('Uncle')
  await dlg.getByLabel('Phone').fill('9000000099')
  await dlg.getByText('Call in an emergency').click()
  await dlg.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('guardian')).toHaveCount(3)
  await expect(page.getByTestId('guardian').last()).toContainText('Uncle · +91 90000 00099')

  await page.getByRole('tab', { name: /Notes/ }).click()
  await page.getByRole('button', { name: 'Add a note' }).click()
  await page.getByRole('dialog').getByLabel('Title').fill('Pick-up')
  await page.getByRole('dialog').getByLabel('Details').fill('Uncle Joseph collects on Fridays')
  await page.getByRole('dialog').getByText(/Important/).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.note.important')).toContainText('Uncle Joseph collects on Fridays')
})

test('edit details: status Graduated moves the child to the Graduated list', async () => {
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Status').selectOption('graduated')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.tag', { hasText: 'Graduated' })).toBeVisible()

  await page.getByRole('button', { name: 'Back to all students' }).click()
  await expect(page.getByText('1 active · 0 inactive · 1 graduated')).toBeVisible()
  await page.getByRole('button', { name: /Graduated · 1/ }).click()
  await expect(list().getByText('Arav Menon')).toBeVisible()
})

test('remove a student added by mistake', async () => {
  await list().getByText('Arav Menon').click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove student' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove student' }).click()
  await expect(page.getByText('Arav Menon has been removed')).toBeVisible()
  await expect(page.getByText('1 active · 0 inactive · 0 graduated')).toBeVisible()
})

test('student data cannot be read while locked', async () => {
  await menu().getByRole('button', { name: 'Lock' }).click()
  await expect(page.getByText('Enter your PIN')).toBeVisible()
  const err = await page.evaluate(() =>
    window.lh.students.list({ search: '', status: 'active', page: 0 }).then(
      () => 'allowed',
      (e: Error) => e.message
    )
  )
  expect(err).toContain('locked')
})
