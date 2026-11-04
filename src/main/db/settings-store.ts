import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

/** A small key–value store. The PIN service depends only on this, so it can be tested without SQLite. */
export interface KeyValueStore {
  get(key: string): string | undefined
  /** Writes all entries in one transaction; `null` removes a key. */
  setMany(entries: Record<string, string | null>): void
}

export class SettingsStore implements KeyValueStore {
  readonly deviceId: string
  private readonly getStmt: Database.Statement<[string], string | undefined>
  private readonly upsertStmt: Database.Statement
  private readonly deleteStmt: Database.Statement

  constructor(private readonly db: Database.Database) {
    this.getStmt = db.prepare<[string], string | undefined>('SELECT value FROM app_settings WHERE key = ?').pluck()
    this.upsertStmt = db.prepare(
      `INSERT INTO app_settings (key, value, created_at, updated_at, device_id)
       VALUES (@key, @value, @now, @now, @device)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    this.deleteStmt = db.prepare('DELETE FROM app_settings WHERE key = ?')

    const existing = this.getStmt.get('device_id')
    this.deviceId = existing ?? randomUUID()
    if (!existing) this.setMany({ device_id: this.deviceId })
  }

  get(key: string): string | undefined {
    return this.getStmt.get(key)
  }

  setMany(entries: Record<string, string | null>): void {
    const now = new Date().toISOString()
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(entries)) {
        if (value === null) this.deleteStmt.run(key)
        else this.upsertStmt.run({ key, value, now, device: this.deviceId })
      }
    })()
  }
}
