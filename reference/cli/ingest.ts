// Ingests the current and previous week (or --from/--to) into the database,
// under the run lock. No model calls. Safe to run twice.
//   node cli/ingest.ts [--from YYYY-MM-DD] [--to YYYY-MM-DD]
import { parseArgs } from 'node:util';
import { databasePath, openDatabase } from '../engine/db/index.ts';
import { newYorkDate, offsetDate, weekStart } from '../engine/ingest/scope.ts';
import { ingestWindow } from '../engine/ingest/store.ts';
import { fetchIndex } from '../engine/ingest/un-transcripts.ts';
import { acquireLock, releaseLock } from '../engine/run/lock.ts';

const { values } = parseArgs({ options: { from: { type: 'string' }, to: { type: 'string' } } });
const today = newYorkDate();
const from = values.from ?? offsetDate(weekStart(today), -7);
const to = values.to ?? today;

const db = openDatabase(databasePath());
const owner = 'ingest:' + process.pid + ':' + Date.now();
if (!acquireLock(db, owner, 30)) {
  console.error('Another run holds the lock; nothing done.');
  process.exit(2);
}
try {
  const result = await ingestWindow(db, await fetchIndex(from, to), today);
  console.log(JSON.stringify({ window: { from, to }, today, ...result }, null, 2));
} finally {
  releaseLock(db, owner);
  db.close();
}
