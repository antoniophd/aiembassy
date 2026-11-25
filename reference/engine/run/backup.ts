// Daily copy of the database: data/backups/daily-YYYYMMDD.sqlite,
// a consistent snapshot by VACUUM INTO; the 14 newest daily copies are kept.
// Other files in the folder (migration backups) are never touched.
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../db/index.ts';

export const KEEP = 14;
const DAILY = /^daily-\d{8}\.sqlite$/;

export function dailyBackup(
  db: Db,
  dir: string,
  now = new Date(),
): { file: string; created: boolean; removed: string[] } {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `daily-${now.toISOString().slice(0, 10).replace(/-/g, '')}.sqlite`);
  const created = !existsSync(file);
  if (created) db.prepare('VACUUM INTO ?').run(file);
  const daily = readdirSync(dir)
    .filter((f) => DAILY.test(f))
    .sort()
    .reverse();
  const removed = daily.slice(KEEP);
  for (const f of removed) unlinkSync(join(dir, f));
  return { file, created, removed };
}
