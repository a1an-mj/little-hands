import Database from 'better-sqlite3'
import { migrationsFromFiles, runMigrations } from './migrate'

const migrationFiles = import.meta.glob('./migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

/** The highest migration this app knows (a backup from a newer app can't be restored). */
export const latestSchemaVersion = () => migrationsFromFiles(migrationFiles).at(-1)?.version ?? 0

export function openDatabase(file: string): Database.Database {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  runMigrations(db, migrationsFromFiles(migrationFiles))
  return db
}
