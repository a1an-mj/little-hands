import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { admissionSchema } from '@shared/schemas'
import { decryptBackup, deriveKey, encryptBackup, newSalt, readHeader, WrongPasswordError, NotABackupError } from '../../src/main/backup/crypto'
import { BackupService, type KeyProtector } from '../../src/main/backup/service'
import { migrationsFromFiles, runMigrations } from '../../src/main/db/migrate'
import { SettingsStore } from '../../src/main/db/settings-store'
import { Writer } from '../../src/main/db/writer'
import { StudentsRepo } from '../../src/main/students/repo'
import { newFamilyAdmission } from './fixtures'

const fast = { N: 2 ** 10, r: 8, p: 1 } // quick scrypt for tests

describe('backup encryption', () => {
  const meta = { createdAt: '2026-11-20T04:00:00.000Z', appVersion: '1.0.0' }
  const data = Buffer.from('SQLite format 3\0 … pretend database '.repeat(100))

  it('round trip with the right password', () => {
    const salt = newSalt()
    const file = encryptBackup(data, deriveKey('correct horse', salt, fast), salt, meta, fast)
    const { db, header } = decryptBackup(file, 'correct horse')
    expect(db.equals(data)).toBe(true)
    expect(header).toMatchObject({ v: 1, appVersion: '1.0.0', createdAt: meta.createdAt })
    expect(file.includes(Buffer.from('pretend database'))).toBe(false) // nothing readable inside
  })

  it('the wrong password, a damaged file, an altered header, or another file all fail', () => {
    const salt = newSalt()
    const file = encryptBackup(data, deriveKey('correct horse', salt, fast), salt, meta, fast)
    expect(() => decryptBackup(file, 'wrong horse')).toThrow(WrongPasswordError)

    const damaged = Buffer.from(file)
    damaged[damaged.length - 40]! ^= 1
    expect(() => decryptBackup(damaged, 'correct horse')).toThrow(WrongPasswordError)

    const { headerBytes } = readHeader(file)
    const altered = Buffer.from(file.toString('latin1').replace('"appVersion":"1.0.0"', '"appVersion":"9.0.0"'), 'latin1')
    expect(altered.length).toBe(file.length)
    expect(headerBytes.length).toBeGreaterThan(0)
    expect(() => decryptBackup(altered, 'correct horse')).toThrow(WrongPasswordError)

    expect(() => decryptBackup(Buffer.from('hello, this is a photo'), 'x')).toThrow(NotABackupError)
  })

  it('each backup uses a fresh IV, so two backups of the same data differ', () => {
    const salt = newSalt()
    const key = deriveKey('pw-12345', salt, fast)
    expect(encryptBackup(data, key, salt, meta, fast).equals(encryptBackup(data, key, salt, meta, fast))).toBe(false)
  })
})

// ---------- The service, with a real database on disk ----------

const dir = join(__dirname, '../../src/main/db/migrations')
const migrations = migrationsFromFiles(
  Object.fromEntries(readdirSync(dir).map((f) => [`./migrations/${f}`, readFileSync(join(dir, f), 'utf8')]))
)

/** Stand-in for Windows' protection: reversible, but not the plain key. */
const protector: KeyProtector = {
  protect: (s) => 'locked:' + Buffer.from(s).toString('hex'),
  unprotect: (s) => Buffer.from(s.slice('locked:'.length), 'hex').toString()
}

let root: string
let appDir: string
let folder: string
let db: Database.Database
let settings: SettingsStore
let now: Date
let service: BackupService

const open = () => {
  db = new Database(join(appDir, 'little-hands.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db, migrations)
  settings = new SettingsStore(db)
  service = new BackupService({
    dbFile: join(appDir, 'little-hands.db'),
    db: () => db,
    settings,
    protector,
    appVersion: '1.0.0',
    latestSchema: migrations.length,
    clock: () => now
  })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lh-backup-test-'))
  appDir = join(root, 'app')
  folder = join(root, 'OneDrive', 'Little Hands backups')
  mkdirSync(appDir, { recursive: true })
  mkdirSync(folder, { recursive: true })
  now = new Date(2026, 10, 20, 9, 30, 0)
  open()
})

afterEach(() => {
  try {
    db.close()
  } catch {
    /* already closed by a restore */
  }
  rmSync(root, { recursive: true, force: true })
})

const admit = (name: string) =>
  new StudentsRepo(new Writer(db, settings.deviceId, () => now)).admit(admissionSchema.parse(newFamilyAdmission({ fullName: name })), null)

describe('backing up', () => {
  it('not set up: a warning, and nothing happens daily', async () => {
    expect(service.status()).toMatchObject({ configured: false, warning: 'not-set-up', recent: [] })
    expect(await service.daily()).toBeNull()
  })

  it('setting up makes the first backup; the key is stored locked, never the password', async () => {
    const file = await service.setUp(folder, 'school-2026')
    expect(file).toBe(join(folder, 'Little Hands 2026-11-20 09.30.00.lhbackup'))
    const st = service.status()
    expect(st).toMatchObject({ configured: true, folder, lastBackupAt: '2026-11-20T09:30', warning: null, lastError: null })
    expect(st.recent.map((r) => r.name)).toEqual(['Little Hands 2026-11-20 09.30.00'])
    const stored = db.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'backup_%'").all() as { key: string; value: string }[]
    expect(stored.map((r) => r.key).sort()).toEqual(['backup_folder', 'backup_key', 'backup_salt'])
    expect(JSON.stringify(stored)).not.toContain('school-2026')
    expect(stored.find((r) => r.key === 'backup_key')!.value.startsWith('locked:')).toBe(true)
    expect(readdirSync(folder).filter((f) => f.endsWith('.partial'))).toEqual([])
  })

  it('refuses a short password, a missing folder, and the app’s own folder', async () => {
    await expect(service.setUp(folder, 'short')).rejects.toThrow('at least 8 characters')
    await expect(service.setUp(join(root, 'nope'), 'school-2026')).rejects.toThrow("can't be found")
    await expect(service.setUp(appDir, 'school-2026')).rejects.toThrow("holds the app's own data")
    await expect(service.setUp(root, 'school-2026')).rejects.toThrow("holds the app's own data") // contains it
  })

  it('daily: once a day; warns after 2 days; records a failure (e.g. USB unplugged)', async () => {
    await service.setUp(folder, 'school-2026')
    expect(await service.daily()).toBeNull() // already today
    now = new Date(2026, 10, 23, 8, 0, 0)
    expect(service.status().warning).toBe('old')
    expect(await service.daily()).toContain('2026-11-23 08.00.00')
    expect(service.status().warning).toBeNull()

    rmSync(folder, { recursive: true })
    now = new Date(2026, 10, 24, 8, 0, 0)
    expect(await service.daily()).toBeNull()
    expect(service.status()).toMatchObject({ warning: 'failed', lastBackupAt: '2026-11-23T08:00' })
    expect(service.status().lastError).toContain('Is the drive plugged in?')
  })

  it('two backups in the same second both keep their file', async () => {
    await service.setUp(folder, 'school-2026')
    const second = await service.backupNow()
    expect(second).toContain('2026-11-20 09.30.01')
    expect(service.status().recent).toHaveLength(2)
  })

  it('keeps the newest 30 backups and never touches other files', async () => {
    await service.setUp(folder, 'school-2026')
    writeFileSync(join(folder, 'notes.txt'), 'keep me')
    for (let i = 1; i <= 31; i++) {
      now = new Date(2026, 10, 20, 10, i, 0)
      await service.backupNow()
    }
    const st = service.status()
    expect(st.recent).toHaveLength(30)
    expect(st.recent[0]!.name).toBe('Little Hands 2026-11-20 10.31.00')
    expect(st.recent.at(-1)!.name).toBe('Little Hands 2026-11-20 10.02.00')
    expect(readdirSync(folder)).toContain('notes.txt')
  })
})

describe('restoring', () => {
  it('inspect shows what is inside; restore replaces the data and keeps the old copy aside', async () => {
    admit('Aadhya Menon')
    admit('Dev Krishna')
    const file = await service.setUp(folder, 'school-2026')
    await expect(service.inspect(file, 'wrong-password')).rejects.toThrow('That password does not open this backup')
    expect(await service.inspect(file, 'school-2026')).toMatchObject({ students: 2, payments: 0, lastPaymentNo: null, appVersion: '1.0.0' })

    // Later, a third child is added; then the backup is restored.
    admit('Neha Varghese')
    const oldDevice = settings.deviceId
    now = new Date(2026, 10, 21, 12, 0, 0)
    await service.restore(file, 'school-2026', () => db.close())
    expect(readdirSync(appDir).some((f) => f.startsWith('little-hands.before-restore-2026-11-21-120000'))).toBe(true)

    open() // what the app does after restarting
    expect(db.prepare('SELECT count(*) FROM students').pluck().get()).toBe(2)
    expect(settings.deviceId).not.toBe(oldDevice) // a new device
    expect(service.status().configured).toBe(false) // set up backups again on this laptop

    const aside = new Database(join(appDir, readdirSync(appDir).find((f) => f.startsWith('little-hands.before-restore'))!), { readonly: true })
    expect(aside.prepare('SELECT count(*) FROM students').pluck().get()).toBe(3)
    aside.close()
  })

  it('refuses a damaged file, something that is not a backup, and a backup from a newer app', async () => {
    const file = await service.setUp(folder, 'school-2026')
    const bad = join(root, 'bad.lhbackup')
    const bytes = readFileSync(file)
    bytes[bytes.length - 100]! ^= 1
    writeFileSync(bad, bytes)
    await expect(service.inspect(bad, 'school-2026')).rejects.toThrow('That password does not open this backup')
    writeFileSync(bad, 'just a text file')
    await expect(service.inspect(bad, 'school-2026')).rejects.toThrow('not a Little Hands backup')

    db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (999, 'future', 'x')").run()
    const future = await service.backupNow()
    await expect(service.inspect(future, 'school-2026')).rejects.toThrow('newer version of Little Hands')
  })
})
