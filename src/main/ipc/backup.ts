import { BrowserWindow, dialog, shell } from 'electron'
import type { BackupApi } from '@shared/ipc-contract'
import { BACKUP_EXT } from '@shared/backup'
import type { BackupService } from '../backup/service'
import type { LockSession } from '../lock/session'
import { UserError } from '../errors'
import { handleAll, type Impl } from './handle'

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** Registers `backup:<method>` handlers. Restoring also works on a fresh install, before a PIN is chosen. */
export function registerBackupIpc(service: BackupService, session: LockSession, afterRestore: () => void, closeLive: () => void): void {
  const window = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]!
  const impl: Impl<BackupApi> = {
    status: () => service.status(),
    pickFolder: async () => {
      const r = await dialog.showOpenDialog(window(), {
        title: 'Choose where to keep backups',
        buttonLabel: 'Use this folder',
        properties: ['openDirectory', 'createDirectory']
      })
      return r.canceled ? null : (r.filePaths[0] ?? null)
    },
    setUp: (folder, password) => service.setUp(str(folder), str(password)),
    changeFolder: (folder) => service.changeFolder(str(folder)),
    changePassword: (password) => service.changePassword(str(password)),
    backupNow: () => service.backupNow(),
    openFolder: async () => {
      const folder = service.status().folder
      if (!folder) throw new UserError('Set up backups first.')
      const err = await shell.openPath(folder)
      if (err) throw new UserError(`The folder can't be opened: ${err}`)
    },
    pickFile: async () => {
      const r = await dialog.showOpenDialog(window(), {
        title: 'Choose a Little Hands backup',
        defaultPath: service.status().folder ?? undefined,
        filters: [{ name: 'Little Hands backup', extensions: [BACKUP_EXT.slice(1)] }],
        properties: ['openFile']
      })
      return r.canceled ? null : (r.filePaths[0] ?? null)
    },
    inspect: (path, password) => service.inspect(str(path), str(password)),
    restore: async (path, password) => {
      await service.restore(str(path), str(password), closeLive)
      // Give the UI a moment to receive the answer, then restart with the restored data.
      setTimeout(afterRestore, 300)
    }
  }
  handleAll('backup', impl, session, ['pickFile', 'inspect', 'restore'])
}
