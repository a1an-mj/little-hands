// Types shared by the backup module (main process ⇄ UI).

/** Backups older than this show a warning (CLAUDE.md: "warn if older than 2 days"). */
export const BACKUP_WARN_DAYS = 2
/** How many backups are kept in the folder; older ones are deleted. */
export const BACKUPS_KEPT = 30
export const BACKUP_EXT = '.lhbackup'
export const MIN_PASSWORD = 8

export interface BackupFileInfo {
  path: string
  name: string
  /** Local "YYYY-MM-DDTHH:MM", read from the file name. */
  createdAt: string
  sizeBytes: number
}

export type BackupWarning = 'not-set-up' | 'never' | 'old' | 'failed' | null

export interface BackupStatus {
  configured: boolean
  folder: string | null
  /** Local "YYYY-MM-DDTHH:MM" */
  lastBackupAt: string | null
  lastError: string | null
  warning: BackupWarning
  /** Newest first. Empty if the folder can't be read (e.g. the USB drive isn't plugged in). */
  recent: BackupFileInfo[]
  /** Today on this laptop, "YYYY-MM-DD" (for "Today, 9:30 AM"). */
  today: string
}

/** What is inside a backup, shown before restoring. */
export interface BackupPreview {
  path: string
  createdAt: string
  appVersion: string
  students: number
  payments: number
  lastPaymentNo: string | null
}

/** "1.2 MB" */
export function sizeText(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
