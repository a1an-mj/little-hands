import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme, powerMonitor, safeStorage, shell } from 'electron'
import { IPC, type LockStatus } from '@shared/ipc-contract'
import { themeSchema } from '@shared/schemas'
import { latestSchemaVersion, openDatabase } from './db/connection'
import { BackupService, type KeyProtector } from './backup/service'
import { registerBackupIpc } from './ipc/backup'
import { SettingsStore } from './db/settings-store'
import { IDLE_LOCK_MS } from './lock/idle-timer'
import { PinAuth } from './lock/pin-auth'
import { LockSession } from './lock/session'
import { registerIpc } from './ipc/register'
import { registerPlannerIpc } from './ipc/planner'
import { registerStudentsIpc } from './ipc/students'
import { PlannerRepo } from './planner/repo'
import { registerEnrollmentsIpc } from './ipc/enrollments'
import { registerAttendanceIpc } from './ipc/attendance'
import { AttendanceRepo } from './attendance/repo'
import { registerPaymentsIpc } from './ipc/payments'
import { PaymentsRepo } from './payments/repo'
import { Writer } from './db/writer'
import { StudentsRepo } from './students/repo'

// Test hooks: only honoured in development / test runs, never in the installed app.
if (!app.isPackaged && process.env.LH_USER_DATA) app.setPath('userData', process.env.LH_USER_DATA)
const idleMs = !app.isPackaged && process.env.LH_IDLE_MS ? Number(process.env.LH_IDLE_MS) : IDLE_LOCK_MS
// Pretend the laptop's clock says this (local time, e.g. "2026-11-02T10:15"); the clock keeps running from there.
const clockOffset = !app.isPackaged && process.env.LH_NOW ? new Date(process.env.LH_NOW).getTime() - Date.now() : 0
const clock = () => new Date(Date.now() + clockOffset)

// English (India) everywhere, whatever the laptop's language setting: dates read day/month/year.
app.commandLine.appendSwitch('lang', 'en-IN')

// Only one copy of the app may run, so two windows never write the database at once.
if (!app.requestSingleInstanceLock()) app.quit()

let mainWindow: BrowserWindow | null = null

/**
 * The backup key is kept locked by the operating system (Windows DPAPI via safeStorage), so daily
 * backups run without asking for the password, and the key can't be used on another laptop.
 * Where no system keyring exists (some Linux test machines) it falls back to plain storage.
 */
const protector: KeyProtector = {
  protect: (secret) =>
    safeStorage.isEncryptionAvailable() ? 'os:' + safeStorage.encryptString(secret).toString('base64') : 'plain:' + secret,
  unprotect: (stored) => {
    if (stored.startsWith('plain:')) return stored.slice('plain:'.length)
    if (!safeStorage.isEncryptionAvailable()) throw new Error('This laptop cannot unlock the saved backup key')
    return safeStorage.decryptString(Buffer.from(stored.slice('os:'.length), 'base64'))
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Little Hands',
    // The installed app takes its icon from the installer (build/icon.png); this covers development runs.
    icon: app.isPackaged ? undefined : join(app.getAppPath(), 'build/icon.png'),
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0F1417' : '#F5FAFF',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // The app never opens other pages or new windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

app.whenReady().then(() => {
  const dbFile = join(app.getPath('userData'), 'little-hands.db')
  const db = openDatabase(dbFile)
  const settings = new SettingsStore(db)

  const savedTheme = themeSchema.safeParse(settings.get('theme'))
  if (savedTheme.success) nativeTheme.themeSource = savedTheme.data

  const auth = new PinAuth(settings)
  const session = new LockSession(auth, idleMs, (status: LockStatus) =>
    mainWindow?.webContents.send(IPC.lockChanged, status)
  )
  registerIpc({
    auth,
    session,
    settings,
    sendTheme: (theme) => {
      mainWindow?.setBackgroundColor(theme === 'dark' ? '#0F1417' : '#F5FAFF')
      mainWindow?.webContents.send(IPC.themeChanged, theme)
    }
  })

  const writer = new Writer(db, settings.deviceId, clock)
  const students = new StudentsRepo(writer)
  const planner = new PlannerRepo(writer)
  registerStudentsIpc(students, planner, session)
  registerEnrollmentsIpc(students.enrollments, session)
  registerAttendanceIpc(new AttendanceRepo(writer), session)
  registerPaymentsIpc(new PaymentsRepo(writer), session)
  registerPlannerIpc(planner, session)

  const backup = new BackupService({ dbFile, db: () => db, settings, protector, appVersion: app.getVersion(), latestSchema: latestSchemaVersion(), clock })
  let restored = false
  registerBackupIpc(
    backup,
    session,
    () => {
      // Test runs restart the app themselves.
      if (!(!app.isPackaged && process.env.LH_USER_DATA)) app.relaunch()
      app.exit(0)
    },
    () => {
      restored = true
      session.dispose()
      if (db.open) db.close()
    }
  )
  // First launch of the day: a backup a few seconds after start (if backups are set up).
  setTimeout(() => void backup.daily(), 5_000)
  // And one when the app is closed.
  let closingBackupDone = false
  app.on('before-quit', (e) => {
    if (closingBackupDone || restored || !backup.status().configured) return
    e.preventDefault()
    closingBackupDone = true
    void backup
      .backupNow()
      .catch(() => undefined) // recorded as last_backup_error; shown next time
      .finally(() => app.quit())
  })

  // Lock when the laptop sleeps or Windows locks the screen.
  powerMonitor.on('suspend', () => session.lock())
  powerMonitor.on('lock-screen', () => session.lock())

  mainWindow = createWindow()

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => {
    session.dispose()
    if (db.open) db.close()
  })
})
