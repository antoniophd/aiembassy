import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDatabase } from '../engine/db/index.ts';
import { checkAlerts, dueTimes, parseRunTimes } from '../engine/run/alerts.ts';
import { dailyBackup, KEEP } from '../engine/run/backup.ts';
import { addMeeting } from './support/world.ts';

const at = (s: string) => new Date(s);
const run = (
  db: ReturnType<typeof openDatabase>,
  id: string,
  started: string,
  finished: string | null,
  outcome: string | null,
  trigger = 'timer',
) =>
  db
    .prepare(`INSERT INTO runs (id, trigger, started_at, finished_at, outcome) VALUES (?, ?, ?, ?, ?)`)
    .run(id, trigger, started, finished, outcome);
const open = (db: ReturnType<typeof openDatabase>) =>
  (db.prepare(`SELECT kind FROM alerts WHERE resolved_at IS NULL ORDER BY kind`).all() as { kind: string }[]).map(
    (a) => a.kind,
  );

test('run times: default 06:00, 14:00, 22:00 UTC; due times are those of the last 24 hours past the grace', () => {
  assert.deepEqual(parseRunTimes(undefined), ['06:00', '14:00', '22:00']);
  assert.deepEqual(parseRunTimes('07:30, 19:00,bad'), ['07:30', '19:00']);
  const due = dueTimes(at('2026-11-14T14:10:00Z'), parseRunTimes(undefined)).map((d) => d.toISOString().slice(5, 16));
  assert.deepEqual(due, ['11-13T22:00', '11-14T06:00']); // 14:00 is still within its 20-minute grace
});

test('alerts: a missed or unfinished scheduled run, a stalled queue, too many failures; cleared conditions resolve', () => {
  const db = openDatabase(':memory:');
  const now = at('2026-11-14T15:00:00Z');
  const opts = { now, runTimes: parseRunTimes(undefined), maxMinutes: 120, scheduledSince: '2026-11-13T00:00:00Z' };
  run(db, 'r22', '2026-11-13T22:00:05Z', '2026-11-13T22:40:00Z', 'completed');
  run(db, 'r14', '2026-11-14T14:00:04Z', null, null); // still within its budget: no alert yet
  // 06:00 never started.
  assert.deepEqual(checkAlerts(db, opts), { opened: 1, resolved: 0, open: 1 });
  assert.deepEqual(open(db), ['run_missed']);
  // Re-checking does not duplicate.
  assert.equal(checkAlerts(db, opts).opened, 0);
  // The 14:00 run is past its budget without finishing.
  assert.deepEqual(open((checkAlerts(db, { ...opts, now: at('2026-11-14T16:30:00Z') }), db)), [
    'run_missed',
    'run_unfinished',
  ]);
  // A run alert resolved by hand does not reopen while its run is still in the window.
  db.prepare(`UPDATE alerts SET resolved_at = '2026-11-14T16:40:00Z' WHERE kind = 'run_unfinished'`).run();
  assert.equal(checkAlerts(db, { ...opts, now: at('2026-11-14T17:00:00Z') }).opened, 0);
  // Before the timer is installed, missing runs are not alerts.
  const fresh = openDatabase(':memory:');
  assert.equal(checkAlerts(fresh, { ...opts, scheduledSince: null }).opened, 0);
  const quiet = { ...opts, scheduledSince: null };
  // Stalled: work waiting, nothing advanced for 24 hours.
  addMeeting(fresh, 'sc/700');
  fresh.prepare(`UPDATE files SET updated_at = '2026-11-12T00:00:00Z'`).run();
  fresh.prepare(`UPDATE documents SET created_at = '2026-11-12T00:00:00Z'`).run();
  assert.deepEqual(open((checkAlerts(fresh, quiet), fresh)), ['stalled']);
  fresh.prepare(`UPDATE files SET status = 'reported'`).run();
  assert.deepEqual(checkAlerts(fresh, quiet).resolved, 1);
  // Model calls: more than 30 % failed or on the fallback in 24 hours.
  const ins = fresh.prepare(
    `INSERT INTO llm_calls (id, purpose, provider, model_requested, state, fallback, claimed_at, task) VALUES (?, 'x', 'ollama', 'm', ?, ?, ?, 'report')`,
  );
  for (let i = 0; i < 10; i++) ins.run('c' + i, i < 3 ? 'failed' : 'complete', i === 3 ? 1 : 0, '2026-11-14T10:00:00Z');
  assert.deepEqual(open((checkAlerts(fresh, quiet), fresh)), ['model_failures']);
});

test('daily backup: one copy a day, the 14 newest daily copies kept, other files untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'embassy-backup-'));
  const db = openDatabase(':memory:');
  addMeeting(db, 'sc/701');
  for (let d = 1; d <= 15; d++) writeFileSync(join(dir, `daily-202610${String(d).padStart(2, '0')}.sqlite`), '');
  writeFileSync(join(dir, 'pre-0006-1547.sqlite'), '');
  const r = dailyBackup(db, dir, at('2026-11-14T03:00:00Z'));
  assert.equal(r.created, true);
  assert.equal(dailyBackup(db, dir, at('2026-11-14T04:00:00Z')).created, false);
  const files = readdirSync(dir);
  assert.equal(files.filter((f) => f.startsWith('daily-')).length, KEEP);
  assert.ok(files.includes('daily-20261114.sqlite') && files.includes('pre-0006-1547.sqlite'));
  assert.ok(!files.includes('daily-20261001.sqlite') && !files.includes('daily-20261002.sqlite'));
  const copy = openDatabase(join(dir, 'daily-20261114.sqlite'));
  assert.equal((copy.prepare('SELECT COUNT(*) AS n FROM meetings').get() as { n: number }).n, 1);
});
