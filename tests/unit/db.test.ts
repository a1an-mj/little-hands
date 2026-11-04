import Database from 'better-sqlite3'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrationsFromFiles, runMigrations } from '../../src/main/db/migrate'
import { SettingsStore } from '../../src/main/db/settings-store'

const dir = join(__dirname, '../../src/main/db/migrations')
const realMigrations = () =>
  migrationsFromFiles(Object.fromEntries(readdirSync(dir).map((f) => [`./migrations/${f}`, readFileSync(join(dir, f), 'utf8')])))

function freshDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  return db
}

describe('migrations', () => {
  it('applies every migration once and records it', () => {
    const db = freshDb()
    const migrations = realMigrations()
    expect(runMigrations(db, migrations)).toBe(migrations.length)
    expect(runMigrations(db, migrations)).toBe(0)
    const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').pluck().all()
    expect(versions).toEqual(migrations.map((m) => m.version))
  })

  it('rolls back a failing migration completely', () => {
    const db = freshDb()
    const bad = [
      { version: 1, name: 'ok', sql: 'CREATE TABLE a (x INTEGER)' },
      { version: 2, name: 'bad', sql: 'CREATE TABLE b (x INTEGER); THIS IS NOT SQL' }
    ]
    expect(() => runMigrations(db, bad)).toThrow()
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").pluck().all()
    expect(tables).toContain('a')
    expect(tables).not.toContain('b')
    expect(db.prepare('SELECT max(version) FROM schema_migrations').pluck().get()).toBe(1)
  })

  it('refuses data made by a newer app version', () => {
    const db = freshDb()
    runMigrations(db, [
      { version: 1, name: 'a', sql: 'SELECT 1' },
      { version: 2, name: 'b', sql: 'SELECT 1' }
    ])
    expect(() => runMigrations(db, [{ version: 1, name: 'a', sql: 'SELECT 1' }])).toThrow(/newer version/)
  })

  it('requires files numbered 1, 2, 3 without gaps', () => {
    expect(() => migrationsFromFiles({ './001_a.sql': '', './003_c.sql': '' })).toThrow()
    expect(() => migrationsFromFiles({ './first.sql': '' })).toThrow()
    expect(migrationsFromFiles({ './002_b.sql': 'B', './001_a.sql': 'A' }).map((m) => m.sql)).toEqual(['A', 'B'])
  })
})

describe('SettingsStore', () => {
  it('creates a device id once and keeps it', () => {
    const db = freshDb()
    runMigrations(db, realMigrations())
    const first = new SettingsStore(db)
    expect(first.deviceId).toMatch(/^[0-9a-f-]{36}$/)
    expect(new SettingsStore(db).deviceId).toBe(first.deviceId)
  })

  it('sets, updates and removes values with timestamps and device id', () => {
    const db = freshDb()
    runMigrations(db, realMigrations())
    const store = new SettingsStore(db)
    store.setMany({ theme: 'dark' })
    store.setMany({ theme: 'light' })
    expect(store.get('theme')).toBe('light')
    const row = db.prepare("SELECT * FROM app_settings WHERE key = 'theme'").get() as { device_id: string; created_at: string; updated_at: string }
    expect(row.device_id).toBe(store.deviceId)
    expect(row.created_at <= row.updated_at).toBe(true)
    store.setMany({ theme: null })
    expect(store.get('theme')).toBeUndefined()
  })
})
