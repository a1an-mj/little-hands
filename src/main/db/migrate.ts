import type Database from 'better-sqlite3'

export interface Migration {
  version: number
  name: string
  sql: string
}

/** Builds the migration list from files named like `001_app_settings.sql`. */
export function migrationsFromFiles(files: Record<string, string>): Migration[] {
  const list = Object.entries(files).map(([path, sql]) => {
    const file = path.split(/[\\/]/).pop() ?? path
    const match = /^(\d+)_(.+)\.sql$/.exec(file)
    if (!match) throw new Error(`Badly named migration file: ${file}`)
    return { version: Number(match[1]), name: match[2]!, sql }
  })
  list.sort((a, b) => a.version - b.version)
  list.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`Migrations must be numbered 1, 2, 3… (found ${m.version})`)
  })
  return list
}

/** Applies every migration not yet recorded, each in its own transaction. Returns how many ran. */
export function runMigrations(db: Database.Database, migrations: Migration[]): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT`)
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').pluck().all() as number[]
  )
  const latestKnown = migrations.at(-1)?.version ?? 0
  const latestApplied = Math.max(0, ...applied)
  if (latestApplied > latestKnown) {
    throw new Error('This data was made by a newer version of Little Hands. Please update the app.')
  }
  const record = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
  let count = 0
  for (const m of migrations) {
    if (applied.has(m.version)) continue
    db.transaction(() => {
      db.exec(m.sql)
      record.run(m.version, m.name, new Date().toISOString())
    })()
    count++
  }
  return count
}
