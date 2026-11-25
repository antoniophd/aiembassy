// The run lock: one run at a time. Stored in `settings` so it survives a
// crash; an expired lock (operator gone past its deadline) may be taken over.
import { nowIso, transaction, type Db } from '../db/index.ts';

const KEY = 'run_lock';

interface LockValue {
  owner: string;
  expiresAt: string;
  /** Process id of the holder on this host; a dead holder's lock may be taken over. */
  pid?: number;
}

function alive(pid: number | undefined): boolean {
  if (!pid) return true; // unknown holder: wait for expiry
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function acquireLock(db: Db, owner: string, ttlMinutes: number, now = new Date()): boolean {
  return transaction(db, () => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined;
    if (row) {
      const held = JSON.parse(row.value) as LockValue;
      if (held.owner !== owner && held.expiresAt > now.toISOString() && alive(held.pid)) return false;
    }
    const value: LockValue = {
      owner,
      expiresAt: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
      pid: process.pid,
    };
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(KEY, JSON.stringify(value), nowIso());
    return true;
  });
}

export function releaseLock(db: Db, owner: string): void {
  transaction(db, () => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined;
    if (row && (JSON.parse(row.value) as LockValue).owner === owner)
      db.prepare('DELETE FROM settings WHERE key = ?').run(KEY);
  });
}
