import { ipcMain, nativeTheme } from 'electron'
import { IPC, type Theme } from '@shared/ipc-contract'
import { pinSchema, recoveryCodeInputSchema, themeSchema } from '@shared/schemas'
import type { SettingsStore } from '../db/settings-store'
import type { PinAuth } from '../lock/pin-auth'
import type { LockSession } from '../lock/session'

interface Deps {
  auth: PinAuth
  session: LockSession
  settings: SettingsStore
  sendTheme: (theme: Theme) => void
}

/** Runs PIN checks one at a time so parallel calls can't race the wrong-try counter. */
function serial() {
  let chain: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task, task)
    chain = next.catch(() => undefined)
    return next
  }
}

export function registerIpc({ auth, session, settings, sendTheme }: Deps): void {
  const queue = serial()

  ipcMain.handle(IPC.lockStatus, () => session.status())

  ipcMain.handle(IPC.lockSetup, (_e, pin: unknown) =>
    queue(async () => {
      const recoveryCode = await auth.setup(pinSchema.parse(pin))
      session.setUnlocked({ announce: false })
      return { recoveryCode }
    })
  )

  ipcMain.handle(IPC.lockUnlock, (_e, pin: unknown) =>
    queue(async () => {
      const result = await auth.unlock(pinSchema.parse(pin))
      if (result.ok) session.setUnlocked()
      return result
    })
  )

  ipcMain.handle(IPC.lockCheckRecovery, (_e, code: unknown) =>
    queue(() => auth.checkRecovery(recoveryCodeInputSchema.parse(code)))
  )

  ipcMain.handle(IPC.lockReset, (_e, code: unknown, pin: unknown) =>
    queue(async () => {
      const result = await auth.resetWithRecovery(recoveryCodeInputSchema.parse(code), pinSchema.parse(pin))
      if (result.ok) session.setUnlocked({ announce: false })
      return result
    })
  )

  ipcMain.handle(IPC.lockNow, () => session.lock())
  ipcMain.on(IPC.lockActivity, () => session.activity())

  // nativeTheme.themeSource holds the saved choice ('system' until the owner uses the switch).
  ipcMain.on(IPC.themeInitial, (e) => {
    e.returnValue = currentTheme()
  })
  ipcMain.handle(IPC.themeSet, (_e, theme: unknown) => {
    const value = themeSchema.parse(theme)
    settings.setMany({ theme: value })
    nativeTheme.themeSource = value
  })
  nativeTheme.on('updated', () => sendTheme(currentTheme()))
}

export function currentTheme(): Theme {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}
