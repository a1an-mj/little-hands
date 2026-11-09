import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  ENROLLMENTS_METHODS,
  IPC,
  STUDENTS_METHODS,
  type EnrollmentsApi,
  type LhApi,
  type LockStatus,
  type StudentsApi,
  type Theme
} from '@shared/ipc-contract'

function invokers<T>(prefix: string, methods: readonly string[]): T {
  return Object.fromEntries(
    methods.map((m) => [m, (...args: unknown[]) => ipcRenderer.invoke(`${prefix}:${m}`, ...args)])
  ) as T
}

const students = invokers<StudentsApi>('students', STUDENTS_METHODS)
const enrollments = invokers<EnrollmentsApi>('enrollments', ENROLLMENTS_METHODS)

const api: LhApi = {
  lock: {
    status: () => ipcRenderer.invoke(IPC.lockStatus),
    setup: (pin) => ipcRenderer.invoke(IPC.lockSetup, pin),
    unlock: (pin) => ipcRenderer.invoke(IPC.lockUnlock, pin),
    checkRecovery: (code) => ipcRenderer.invoke(IPC.lockCheckRecovery, code),
    resetWithRecovery: (code, pin) => ipcRenderer.invoke(IPC.lockReset, code, pin),
    lockNow: () => ipcRenderer.invoke(IPC.lockNow),
    activity: () => ipcRenderer.send(IPC.lockActivity),
    onChange: (listener) => {
      const handler = (_e: IpcRendererEvent, status: LockStatus) => listener(status)
      ipcRenderer.on(IPC.lockChanged, handler)
      return () => ipcRenderer.removeListener(IPC.lockChanged, handler)
    }
  },
  theme: {
    // Read synchronously once at start-up so the first paint already has the right colours.
    initial: ipcRenderer.sendSync(IPC.themeInitial) as Theme,
    set: (theme) => ipcRenderer.invoke(IPC.themeSet, theme),
    onChange: (listener) => {
      const handler = (_e: IpcRendererEvent, theme: Theme) => listener(theme)
      ipcRenderer.on(IPC.themeChanged, handler)
      return () => ipcRenderer.removeListener(IPC.themeChanged, handler)
    }
  },
  students,
  enrollments
}

contextBridge.exposeInMainWorld('lh', api)
