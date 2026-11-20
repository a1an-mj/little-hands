import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, promises as fs, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { BACKUPS_KEPT, BACKUP_EXT, BACKUP_WARN_DAYS, MIN_PASSWORD, type BackupFileInfo, type BackupPreview, type BackupStatus } from '@shared/backup'
import { localIsoDate, localTime } from '@shared/dates'
import { paymentNo } from '@shared/payments'
import { daysBetween } from '@shared/periods'
import type { KeyValueStore } from '../db/settings-store'
import { UserError } from '../errors'
import { decryptBackup, deriveKey, encryptBackup, newSalt, WrongPasswordError, NotABackupError } from './crypto'

/** Keeps the backup key on this laptop, locked by the operating system (Electron safeStorage / Windows DPAPI). */
export interface KeyProtector {
  protect(secret: string): string
  unprotect(stored: string): string
}

export interface BackupDeps {
  /** The live database file and connection. */
  dbFile: string
  db: () => Database.Database
  settings: KeyValueStore
  protector: KeyProtector
  appVersion: string
  /** Highest migration this app knows (a backup from a newer app can't be restored). */
  latestSchema: number
  clock?: () => Date
}

const K = {
  folder: 'backup_folder',
  salt: 'backup_salt',
  key: 'backup_key',
  at: 'last_backup_at',
  file: 'last_backup_file',
  error: 'last_backup_error'
} as const

/** "Little Hands 2026-11-20 09.30.15.lhbackup" */
const NAME = /^Little Hands (\d{4}-\d{2}-\d{2}) (\d{2})\.(\d{2})\.(\d{2})\.lhbackup$/

const pad = (n: number) => String(n).padStart(2, '0')

export class BackupService {
  private readonly clock: () => Date
  private running: Promise<string> | null = null

  constructor(private readonly d: BackupDeps) {
    this.clock = d.clock ?? (() => new Date())
  }

  // ---------- Status ----------

  status(): BackupStatus {
    const s = this.d.settings
    const folder = s.get(K.folder) ?? null
    const configured = !!folder && !!s.get(K.key)
    const lastBackupAt = s.get(K.at) ?? null
    const lastError = s.get(K.error) ?? null
    const today = localIsoDate(this.clock())
    let warning: BackupStatus['warning'] = null
    if (!configured) warning = 'not-set-up'
    else if (lastError) warning = 'failed'
    else if (!lastBackupAt) warning = 'never'
    else if (daysBetween(lastBackupAt.slice(0, 10), today) > BACKUP_WARN_DAYS) warning = 'old'
    return { configured, folder, lastBackupAt, lastError, warning, recent: folder ? this.list(folder) : [], today }
  }

  /** Little Hands backups in a folder, newest first. Other files are never touched. */
  list(folder: string): BackupFileInfo[] {
    let names: string[]
    try {
      names = readdirSync(folder)
    } catch {
      return []
    }
    return names
      .map((name) => ({ name, m: NAME.exec(name) }))
      .filter((x): x is { name: string; m: RegExpExecArray } => !!x.m)
      .map(({ name, m }) => {
        const path = join(folder, name)
        let sizeBytes = 0
        try {
          sizeBytes = statSync(path).size
        } catch {
          /* removed meanwhile */
        }
        return { path, name: name.slice(0, -BACKUP_EXT.length), createdAt: `${m[1]}T${m[2]}:${m[3]}`, sizeBytes, sort: `${m[1]} ${m[2]}${m[3]}${m[4]}` }
      })
      .sort((a, b) => b.sort.localeCompare(a.sort))
      .map(({ sort: _sort, ...f }) => f)
  }

  // ---------- Setting up ----------

  /** Chooses the folder and the backup password, then makes the first backup. */
  async setUp(folder: string, password: string): Promise<string> {
    this.checkFolder(folder)
    this.checkPassword(password)
    this.storeKey(password)
    this.d.settings.setMany({ [K.folder]: resolve(folder), [K.error]: null })
    return this.backupNow()
  }

  async changeFolder(folder: string): Promise<string> {
    if (!this.d.settings.get(K.key)) throw new UserError('Set up backups first.')
    this.checkFolder(folder)
    this.d.settings.setMany({ [K.folder]: resolve(folder), [K.error]: null })
    return this.backupNow()
  }

  /** New password for future backups. Older backups still need the password they were made with. */
  async changePassword(password: string): Promise<string> {
    if (!this.d.settings.get(K.folder)) throw new UserError('Set up backups first.')
    this.checkPassword(password)
    this.storeKey(password)
    return this.backupNow()
  }

  // ---------- Backing up ----------

  /** Makes a backup now. Returns the file path. Only one runs at a time. */
  backupNow(): Promise<string> {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null
      })
    }
    return this.running
  }

  /** The first time the app opens each day (does nothing if not set up or already done today). */
  async daily(): Promise<string | null> {
    const st = this.status()
    if (!st.configured) return null
    if (st.lastBackupAt?.slice(0, 10) === st.today && !st.lastError) return null
    try {
      return await this.backupNow()
    } catch {
      return null // recorded in last_backup_error and shown as a warning
    }
  }

  private async run(): Promise<string> {
    const s = this.d.settings
    try {
      const folder = s.get(K.folder)
      const stored = s.get(K.key)
      const salt = s.get(K.salt)
      if (!folder || !stored || !salt) throw new UserError('Backups are not set up yet.')
      if (!existsSync(folder)) throw new UserError(`The backup folder can't be found: ${folder}. Is the drive plugged in?`)
      const key = Buffer.from(this.d.protector.unprotect(stored), 'base64')

      // A consistent copy of the live database (SQLite online backup), in this app's own folder.
      const now = this.clock()
      const tmp = join(dirname(this.d.dbFile), `backup-${randomUUID()}.db`)
      let bytes: Buffer
      try {
        await this.d.db().backup(tmp)
        bytes = await fs.readFile(tmp)
      } finally {
        rmSync(tmp, { force: true })
      }
      const file = encryptBackup(bytes, key, Buffer.from(salt, 'base64'), { createdAt: now.toISOString(), appVersion: this.d.appVersion })

      // Named to the second; two backups in the same second get the next free second.
      let target = ''
      for (let i = 0; i < 60 && (!target || existsSync(target)); i++) {
        const t = new Date(now.getTime() + i * 1000)
        const stamp = `${localIsoDate(t)} ${pad(t.getHours())}.${pad(t.getMinutes())}.${pad(t.getSeconds())}`
        target = join(folder, `Little Hands ${stamp}${BACKUP_EXT}`)
      }
      // Written under another name first, so a cloud folder never uploads a half-written backup.
      const partial = `${target}.partial`
      await fs.writeFile(partial, file)
      await fs.rename(partial, target)
      this.prune(folder)
      s.setMany({ [K.at]: `${localIsoDate(now)}T${localTime(now)}`, [K.file]: target, [K.error]: null })
      return target
    } catch (err) {
      const message = err instanceof UserError ? err.message : `The backup could not be saved (${(err as Error).message}).`
      s.setMany({ [K.error]: message })
      throw new UserError(message)
    }
  }

  /** Keeps the newest BACKUPS_KEPT backups in the folder. */
  private prune(folder: string) {
    for (const f of this.list(folder).slice(BACKUPS_KEPT)) rmSync(f.path, { force: true })
  }

  // ---------- Restoring ----------

  /** Opens a backup with its password and says what's inside, without changing anything. */
  async inspect(path: string, password: string): Promise<BackupPreview> {
    const { header, file } = await this.decryptToTemp(path, password)
    try {
      const db = new Database(file, { readonly: true })
      try {
        const students = db.prepare('SELECT count(*) FROM students WHERE deleted_at IS NULL').pluck().get() as number
        let payments = 0
        let last: number | null = null
        const hasPayments = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'payments'").get()
        if (hasPayments) {
          payments = db.prepare("SELECT count(*) FROM payments WHERE deleted_at IS NULL AND kind = 'payment'").pluck().get() as number
          last = db.prepare('SELECT max(payment_seq) FROM payments').pluck().get() as number | null
        }
        return { path, createdAt: header.createdAt, appVersion: header.appVersion, students, payments, lastPaymentNo: last ? paymentNo(last) : null }
      } finally {
        db.close()
      }
    } finally {
      rmSync(file, { force: true })
    }
  }

  /**
   * Replaces this laptop's data with a backup. The current database is kept aside first
   * ("little-hands.before-restore-<time>.db"). `closeLive` must close the live connection;
   * afterwards the app has to restart.
   */
  async restore(path: string, password: string, closeLive: () => void): Promise<void> {
    const { file } = await this.decryptToTemp(path, password)
    try {
      // This laptop is a different device, and the old laptop's backup key can't be unlocked here.
      const db = new Database(file)
      try {
        db.prepare("UPDATE app_settings SET value = ? WHERE key = 'device_id'").run(randomUUID())
        db.prepare(`DELETE FROM app_settings WHERE key IN (${Object.values(K).map(() => '?').join(', ')})`).run(...Object.values(K))
        db.pragma('journal_mode = DELETE')
      } finally {
        db.close()
      }

      const live = this.d.dbFile
      const now = this.clock()
      const aside = join(dirname(live), `little-hands.before-restore-${localIsoDate(now)}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.db`)
      // A consistent copy of the current data, in case the restore was a mistake.
      await this.d.db().backup(aside)
      closeLive()
      for (const ext of ['', '-wal', '-shm']) rmSync(live + ext, { force: true })
      await fs.copyFile(file, live)
    } finally {
      rmSync(file, { force: true })
    }
  }

  // ---------- Internals ----------

  /** Decrypts a backup to a temporary database file and checks it can be used. */
  private async decryptToTemp(path: string, password: string) {
    let bytes: Buffer
    try {
      bytes = await fs.readFile(path)
    } catch {
      throw new UserError("That file can't be opened.")
    }
    let result
    try {
      result = decryptBackup(bytes, password)
    } catch (err) {
      if (err instanceof WrongPasswordError || err instanceof NotABackupError) throw new UserError(err.message)
      if (err instanceof Error && /newer version/.test(err.message)) throw new UserError(err.message)
      throw new UserError('This backup file is damaged and cannot be read.')
    }
    const file = join(dirname(this.d.dbFile), `restore-${randomUUID()}.db`)
    writeFileSync(file, result.db)
    try {
      const db = new Database(file, { readonly: true })
      try {
        const ok = db.pragma('integrity_check', { simple: true })
        if (ok !== 'ok') throw new UserError('This backup file is damaged and cannot be read.')
        const version = db.prepare('SELECT max(version) FROM schema_migrations').pluck().get() as number
        if (version > this.d.latestSchema) throw new UserError('This backup was made by a newer version of Little Hands. Please update the app first.')
      } finally {
        db.close()
      }
    } catch (err) {
      rmSync(file, { force: true })
      if (err instanceof UserError) throw err
      throw new UserError('This backup file is damaged and cannot be read.')
    }
    return { header: result.header, file }
  }

  private checkFolder(folder: string) {
    const abs = resolve(folder)
    let ok = false
    try {
      ok = statSync(abs).isDirectory()
    } catch {
      /* missing */
    }
    if (!ok) throw new UserError("That folder can't be found.")
    // The live database must never be inside the backup (cloud) folder, nor the other way round.
    const appDir = resolve(dirname(this.d.dbFile))
    /** Is `a` the folder `b` or inside it? */
    const inside = (a: string, b: string) => {
      const r = relative(b, a)
      return !r.startsWith('..') && !isAbsolute(r)
    }
    if (inside(abs, appDir) || inside(appDir, abs)) throw new UserError("Choose a different folder: that one holds the app's own data.")
    const probe = join(abs, `.little-hands-write-test-${randomUUID()}`)
    try {
      mkdirSync(abs, { recursive: true })
      writeFileSync(probe, 'ok')
      rmSync(probe, { force: true })
    } catch {
      throw new UserError("Little Hands can't save files in that folder. Choose another one.")
    }
  }

  private checkPassword(password: string) {
    if (password.length < MIN_PASSWORD) throw new UserError(`Use at least ${MIN_PASSWORD} characters for the backup password.`)
  }

  private storeKey(password: string) {
    const salt = newSalt()
    const key = deriveKey(password, salt)
    this.d.settings.setMany({ [K.salt]: salt.toString('base64'), [K.key]: this.d.protector.protect(key.toString('base64')) })
  }
}

