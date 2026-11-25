// SQLite access: one file, WAL mode, ordered SQL migrations from db/migrations.
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS_DIR = new URL('../../db/migrations/', import.meta.url);

export type Db = DatabaseSync;

export const nowIso = (): string => new Date().toISOString();

/** Default location: $DATA_DIR/embassy.sqlite, DATA_DIR defaulting to ./data. */
export function databasePath(env: Record<string, string | undefined> = process.env): string {
  return join(env.DATA_DIR || 'data', 'embassy.sqlite');
}

/** Opens (creating if needed) the database and applies pending migrations. */
export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  migrate(db);
  return db;
}

/** Opens an existing database read-only, without migrating. */
export function openReadOnly(path: string): Db {
  const db = new DatabaseSync(path, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

export function migrate(db: Db): string[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(
    (db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map((r) => r.name),
  );
  const applied: string[] = [];
  for (const name of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    if (done.has(name)) continue;
    const sql = readFileSync(new URL(name, MIGRATIONS_DIR), 'utf8');
    // A table rebuild (SQLite's procedure for a changed constraint) runs with foreign keys off and
    // checks them before committing.
    const rebuild = sql.startsWith('-- foreign_keys: off');
    if (rebuild) db.exec('PRAGMA foreign_keys = OFF');
    try {
      transaction(db, () => {
        db.exec(sql);
        if (rebuild && db.prepare('PRAGMA foreign_key_check').all().length)
          throw Error(`Migration ${name} leaves foreign key violations`);
        db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(name, nowIso());
      });
    } finally {
      if (rebuild) db.exec('PRAGMA foreign_keys = ON');
    }
    applied.push(name);
  }
  return applied;
}

/** Runs `work` in an immediate transaction; rolls back on any error. */
export function transaction<T>(db: Db, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
