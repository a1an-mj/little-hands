import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

/** Tables written through the Writer. Every one gets id/created_at/updated_at/device_id/deleted_at. */
export type SyncedTable = 'students' | 'student_photos' | 'guardians' | 'student_guardians' | 'student_notes'

type Row = Record<string, unknown>

const SAFE_NAME = /^[a-z_]+$/

function auditValue(v: unknown): unknown {
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return '[image]'
  return v
}

/**
 * Inserts, updates and soft-deletes rows, filling in the sync columns and writing the
 * change history in the same transaction. Callers wrap a whole operation in `transaction()`.
 */
export class Writer {
  constructor(
    readonly db: Database.Database,
    readonly deviceId: string,
    private readonly clock: () => Date = () => new Date()
  ) {}

  now(): string {
    return this.clock().toISOString()
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  insert(table: SyncedTable, values: Row): string {
    const id = randomUUID()
    const now = this.now()
    const row: Row = { id, ...values, created_at: now, updated_at: now, device_id: this.deviceId }
    const cols = Object.keys(row)
    cols.forEach(assertSafe)
    this.db
      .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})`)
      .run(row)
    const changes: Row = {}
    for (const [k, v] of Object.entries(values)) changes[k] = [null, auditValue(v)]
    this.audit(table, id, 'insert', changes, now)
    return id
  }

  /** Updates the given columns; only real changes are written and logged. Returns true if anything changed. */
  update(table: SyncedTable, id: string, patch: Row): boolean {
    const before = this.db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(id) as Row | undefined
    if (!before) throw new Error(`${table} row not found`)
    const changed: Row = {}
    const changes: Row = {}
    for (const [k, v] of Object.entries(patch)) {
      assertSafe(k)
      if (!sameValue(before[k], v)) {
        changed[k] = v
        changes[k] = [auditValue(before[k]), auditValue(v)]
      }
    }
    if (Object.keys(changed).length === 0) return false
    const now = this.now()
    const sets = Object.keys(changed).map((c) => `${c} = @${c}`)
    this.db
      .prepare(`UPDATE ${table} SET ${sets.join(', ')}, updated_at = @__now WHERE id = @__id`)
      .run({ ...changed, __now: now, __id: id })
    this.audit(table, id, 'update', changes, now)
    return true
  }

  softDelete(table: SyncedTable, id: string): void {
    const now = this.now()
    const res = this.db
      .prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`)
      .run(now, now, id)
    if (res.changes === 0) throw new Error(`${table} row not found`)
    this.audit(table, id, 'delete', {}, now)
  }

  private audit(table: string, rowId: string, action: 'insert' | 'update' | 'delete', changes: Row, now: string) {
    this.db
      .prepare(
        `INSERT INTO audit_log (id, table_name, row_id, action, changes, created_at, updated_at, device_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), table, rowId, action, JSON.stringify(changes), now, now, this.deviceId)
  }
}

function assertSafe(name: string) {
  if (!SAFE_NAME.test(name)) throw new Error(`Bad column name: ${name}`)
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Buffer.isBuffer(a) && Buffer.isBuffer(b)) return a.equals(b)
  return (a ?? null) === (b ?? null)
}
