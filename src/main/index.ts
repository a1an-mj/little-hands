import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme, powerMonitor, shell } from 'electron'
import { IPC, type LockStatus } from '@shared/ipc-contract'
import { themeSchema } from '@shared/schemas'
import { openDatabase } from './db/connection'
import { SettingsStore } from './db/settings-store'
import { IDLE_LOCK_MS } from './lock/idle-timer'
import { PinAuth } from './lock/pin-auth'
import { LockSession } from './lock/session'
import { registerIpc } from './ipc/register'
import { registerStudentsIpc } from './ipc/students'
import { registerEnrollmentsIpc } from './ipc/enrollments'
import { Writer } from './db/writer'
import { StudentsRepo } from './students/repo'

// Test hooks: only honoured in development / test runs, never in the installed app.
if (!app.isPackaged && process.env.LH_USER_DATA) app.setPath('userData', process.env.LH_USER_DATA)
const idleMs = !app.isPackaged && process.env.LH_IDLE_MS ? Number(process.env.LH_IDLE_MS) : IDLE_LOCK_MS

// English (India) everywhere, whatever the laptop's language setting: dates read day/month/year.
app.commandLine.appendSwitch('lang', 'en-IN')

// Only one copy of the app may run, so two windows never write the database at once.
if (!app.requestSingleInstanceLock()) app.quit()

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Little Hands',
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0D1515' : '#F2FBFB',
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
  const db = openDatabase(join(app.getPath('userData'), 'little-hands.db'))
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
      mainWindow?.setBackgroundColor(theme === 'dark' ? '#0D1515' : '#F2FBFB')
      mainWindow?.webContents.send(IPC.themeChanged, theme)
    }
  })

  const students = new StudentsRepo(new Writer(db, settings.deviceId))
  registerStudentsIpc(students, session)
  registerEnrollmentsIpc(students.enrollments, session)

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
    db.close()
  })
})
