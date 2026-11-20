import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// Backups and restore. Two "laptops": the owner's (A) and a new one (B), each with its own data folder.
const root = mkdtempSync(join(tmpdir(), 'little-hands-e2e-backup-'))
const laptopA = join(root, 'laptop-a')
const laptopB = join(root, 'laptop-b')
const cloud = join(root, 'OneDrive', 'Little Hands backups')
mkdirSync(cloud, { recursive: true })

let app: ElectronApplication
let page: Page

test.describe.configure({ mode: 'serial' })

const launch = async (userData: string) => {
  app = await electron.launch({
    args: [join(__dirname, '../..')],
    env: { ...process.env, LH_USER_DATA: userData, LH_NOW: '2026-11-20T10:00:00' } as Record<string, string>
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
}

/** The Windows folder / file pickers can't be clicked in a test: answer them with this path. */
const answerPickerWith = (path: string) =>
  app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog
  }, path)

const backups = () => readdirSync(cloud).filter((f) => f.endsWith('.lhbackup'))
const nav = (name: string) => page.getByRole('navigation', { name: 'Main menu' }).getByRole('button', { name, exact: true })
const snack = () => page.getByRole('status')

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

test('laptop A: not set up yet → warning on Home', async () => {
  await launch(laptopA)
  await page.evaluate(() => window.lh.lock.setup('2468'))
  const r = await page.evaluate(() =>
    window.lh.students.admit({
      fullName: 'Aadhya Menon',
      joiningDate: '2026-06-01',
      notes: '',
      homeAddress: '',
      photo: null,
      family: {
        kind: 'new',
        father: { name: 'Suresh', phone: '90000 00014' },
        mother: { name: '', phone: '' },
        emergency: { name: 'Gran', relationship: 'Grandmother', phone: '90000 00016' },
        extra: [],
        feeContact: 'father'
      },
      programs: [{ program: 'lk', startDate: '2026-06-01', schedule: { days: 31 }, fee: { periodMonths: 1, dueDay: '1', standard: '1500', concession: '', concessionReason: '', remarks: '' } }]
    } as never)
  )
  expect(r).toEqual(expect.objectContaining({ ok: true }))
  await page.reload()
  await expect(page.getByTestId('backup-chip')).toHaveText('Backups are not set up yet')
})

test('set up backups: folder, password (twice), first backup', async () => {
  await page.getByTestId('backup-chip').click()
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  await page.getByRole('button', { name: 'Set up backups' }).click()
  const d = page.getByRole('dialog')
  await d.getByRole('button', { name: 'Turn on backups' }).click()
  await expect(d.getByText('Choose a folder')).toBeVisible()

  await answerPickerWith(cloud)
  await d.getByRole('button', { name: 'Choose folder…' }).click()
  await expect(d.getByTestId('chosen-folder')).toHaveText(cloud)
  await d.getByLabel('Backup password').fill('short')
  await d.getByRole('button', { name: 'Turn on backups' }).click()
  await expect(d.getByText('Use at least 8 characters')).toBeVisible()
  await d.getByLabel('Backup password').fill('school-2026')
  await d.getByLabel('Type it again').fill('school-2025')
  await d.getByRole('button', { name: 'Turn on backups' }).click()
  await expect(d.getByText("The two passwords don't match")).toBeVisible()
  await d.getByLabel('Type it again').fill('school-2026')
  await d.getByRole('button', { name: 'Turn on backups' }).click()

  await expect(snack()).toContainText('Backups are on')
  await expect(page.getByTestId('backup-status')).toHaveText(/Last backup: Today, 10:00 AM/)
  await expect(page.getByTestId('backup-folder')).toHaveText(cloud)
  await expect(page.getByTestId('backup-file')).toHaveCount(1)
  expect(backups()).toHaveLength(1)
})

test('back up now adds another; Home shows the last backup', async () => {
  await page.waitForTimeout(1100) // backups are named to the second
  await page.getByRole('button', { name: 'Back up now' }).click()
  await expect(snack()).toContainText('Backup saved')
  await expect(page.getByTestId('backup-file')).toHaveCount(2)
  await nav('Home').click()
  await expect(page.getByTestId('backup-chip')).toHaveText(/Last backup: Today, 10:0\d AM/)
})

test('closing the app makes one more backup', async () => {
  const before = backups().length
  await app.close()
  expect(backups().length).toBe(before + 1)
})

test('laptop B (fresh install): restore from a backup on the first screen', async () => {
  await launch(laptopB)
  await expect(page.getByRole('heading', { name: 'Welcome to Little Hands' })).toBeVisible()
  const newest = join(cloud, backups().sort().at(-1)!)
  await answerPickerWith(newest)
  await page.getByRole('button', { name: 'Restore from a backup' }).click()

  const d = page.getByRole('dialog')
  await d.getByLabel('Backup password').fill('wrong-password')
  await d.getByRole('button', { name: 'Open backup' }).click()
  await expect(d.getByText('That password does not open this backup')).toBeVisible()
  await d.getByLabel('Backup password').fill('school-2026')
  await d.getByRole('button', { name: 'Open backup' }).click()
  await expect(d.getByTestId('backup-preview')).toContainText('1 student · 0 payments')

  const exited = new Promise((resolve) => app.process().once('exit', resolve))
  await d.getByRole('button', { name: 'Replace everything on this laptop' }).click()
  await expect(page.getByText('Little Hands is restarting')).toBeVisible()
  await exited // the app restarts itself (in tests it just exits)
})

test('laptop B after the restore: old PIN, the same children, backups to set up again', async () => {
  await launch(laptopB)
  await expect(page.getByText('Enter your PIN')).toBeVisible()
  await page.evaluate(() => window.lh.lock.unlock('2468'))
  await page.reload()
  await nav('Students').click()
  await expect(page.getByRole('region', { name: 'Student list' }).getByText('Aadhya Menon', { exact: true })).toBeVisible()
  await nav('Settings').click()
  await expect(page.getByTestId('backup-status')).toHaveText('Backups are not set up yet')
  // The data that was on laptop B before is kept aside.
  expect(readdirSync(laptopB).some((f) => f.startsWith('little-hands.before-restore-'))).toBe(true)
})
