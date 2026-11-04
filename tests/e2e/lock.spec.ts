import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// One fresh data folder for the whole file; tests run in order and build on each other,
// like the owner using the app for the first time.
const userData = mkdtempSync(join(tmpdir(), 'little-hands-e2e-'))
const projectDir = join(__dirname, '../..')

let app: ElectronApplication
let page: Page
let recoveryCode = ''

async function launch(extraEnv: Record<string, string> = {}) {
  app = await electron.launch({
    args: [projectDir],
    env: { ...process.env, LH_USER_DATA: userData, ...extraEnv } as Record<string, string>
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
}

async function close() {
  await app?.close()
}

const typePin = (pin: string) => page.keyboard.type(pin)
const lockScreen = () => page.getByText('Enter your PIN')
const mainMenu = () => page.getByRole('navigation', { name: 'Main menu' })

test.describe.configure({ mode: 'serial' })
test.afterAll(async () => {
  await close()
  rmSync(userData, { recursive: true, force: true })
})

test('first run: choose a PIN, see the recovery code once, then the app opens', async () => {
  await launch()
  await expect(page.getByRole('heading', { name: 'Welcome to Little Hands' })).toBeVisible()

  // Mismatched confirmation starts over.
  for (const d of '2468') await page.getByRole('button', { name: d, exact: true }).click()
  await page.getByRole('button', { name: 'Next' }).click()
  await typePin('1111')
  await page.getByRole('button', { name: 'Save PIN' }).click()
  await expect(page.getByText("The two PINs didn't match")).toBeVisible()

  await typePin('2468')
  await page.keyboard.press('Enter')
  await expect(page.getByText('Enter the same PIN again')).toBeVisible()
  await typePin('2468')
  await page.keyboard.press('Enter')

  const code = page.getByTestId('recovery-code')
  await expect(code).toHaveText(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/)
  recoveryCode = (await code.textContent())!
  const cont = page.getByRole('button', { name: 'Continue' })
  await expect(cont).toBeDisabled()
  await page.getByText('I have written the code down').click()
  await cont.click()

  await expect(mainMenu()).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Good (morning|afternoon|evening)/)
})

test('navigation rail: modules open placeholders, Reports and Settings are greyed out', async () => {
  await mainMenu().getByRole('button', { name: 'Students' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Students' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New admission' })).toBeVisible()

  await page.getByRole('button', { name: 'Record a payment' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Fees' })).toBeVisible()

  for (const name of ['Reports', 'Settings']) {
    const item = mainMenu().getByText(name, { exact: true })
    await expect(item).toHaveAttribute('aria-disabled', 'true')
    await expect(item).toHaveAttribute('title', 'Coming in a later version')
  }
})

test('theme switch changes the theme and is remembered after a restart', async () => {
  const html = page.locator('html')
  const before = await html.getAttribute('data-theme')
  const after = before === 'dark' ? 'light' : 'dark'
  await page.getByRole('switch', { name: 'Dark theme' }).click()
  await expect(html).toHaveAttribute('data-theme', after)

  await close()
  await launch()
  await expect(lockScreen()).toBeVisible() // restart always starts locked
  await expect(page.locator('html')).toHaveAttribute('data-theme', after)
})

test('wrong PIN is refused; the right PIN unlocks; Lock locks again', async () => {
  await typePin('0000')
  await page.keyboard.press('Enter')
  await expect(page.getByText("That PIN isn't right. 4 tries left.")).toBeVisible()

  await typePin('2468')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(mainMenu()).toBeVisible()

  await mainMenu().getByRole('button', { name: 'Lock' }).click()
  await expect(lockScreen()).toBeVisible()
})

test('Forgot PIN: the recovery code sets a new PIN and gives a new code', async () => {
  await page.getByRole('button', { name: 'Forgot PIN?' }).click()
  const field = page.getByLabel('Recovery code')

  await field.fill('ZZZZ-ZZZZ-ZZZZ-ZZZZ')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText("That recovery code isn't right.")).toBeVisible()

  await field.fill(recoveryCode.toLowerCase().replace(/-/g, ' '))
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Choose a new PIN' })).toBeVisible()
  await typePin('1357')
  await page.keyboard.press('Enter')
  await typePin('1357')
  await page.keyboard.press('Enter')

  await expect(page.getByRole('heading', { name: 'Your new recovery code' })).toBeVisible()
  const newCode = (await page.getByTestId('recovery-code').textContent())!
  expect(newCode).not.toBe(recoveryCode)
  await page.getByText('I have written the code down').click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(mainMenu()).toBeVisible()

  await mainMenu().getByRole('button', { name: 'Lock' }).click()
  await expect(lockScreen()).toBeVisible()
  await typePin('2468')
  await page.keyboard.press('Enter')
  await expect(page.getByText("That PIN isn't right.")).toBeVisible()
  await typePin('1357')
  await page.keyboard.press('Enter')
  await expect(mainMenu()).toBeVisible()
})

test('locks itself after the idle time (shortened to 3 s for the test)', async () => {
  await close()
  await launch({ LH_IDLE_MS: '3000' })
  await expect(lockScreen()).toBeVisible()
  await typePin('1357')
  await page.keyboard.press('Enter')
  await expect(mainMenu()).toBeVisible()
  await expect(lockScreen()).toBeVisible({ timeout: 10_000 })
})

test('five wrong PINs in a row make the owner wait', async () => {
  for (let i = 0; i < 5; i++) {
    await typePin('9999')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('alert')).not.toHaveText('')
  }
  await expect(page.getByText(/Too many wrong tries\. Please wait \d+ seconds?\./)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Unlock' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '1', exact: true })).toBeDisabled()
})
