import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../engine/db/index.ts';
import { ingestWindow } from '../engine/ingest/store.ts';
import {
  normaliseIndexMeeting,
  TranscriptNotReadyError,
  TranscriptRejectedError,
  type DownloadedTranscript,
  type IndexedMeeting,
} from '../engine/ingest/un-transcripts.ts';
import { acquireLock, releaseLock } from '../engine/run/lock.ts';

const m = (slug: string, hasTranscript = true): IndexedMeeting =>
  normaliseIndexMeeting({ slug, date: '2026-11-10', hasTranscript, duration: '01:00:00' })!;

const transcript = (slug: string): DownloadedTranscript => ({
  url: 'https://transcripts.un.org/en/' + slug,
  title: slug,
  language: 'en',
  statements: 1,
  characters: 5,
  speakers: [],
  segments: [{ id: 'E1', start: 0, end: 5, text: '[0s] Hello', speakers: [] }],
});

const window = (meetings: IndexedMeeting[]) => ({
  from: '2026-11-09',
  to: '2026-11-15',
  meetings,
  unrecognised: [],
  totalEntries: meetings.length,
});

test('ingest is idempotent: a second run downloads nothing', async () => {
  const db = openDatabase(':memory:');
  const calls: string[] = [];
  const download = async (x: IndexedMeeting) => (calls.push(x.id), transcript(x.id));
  const w = window([m('sc/1'), m('ga/c2/99/1'), m('sc/2', false)]);
  const first = await ingestWindow(db, w, '2026-11-12', download);
  const second = await ingestWindow(db, w, '2026-11-12', download);
  assert.deepEqual(first.ingested, ['sc/1', 'ga/c2/99/1']);
  assert.deepEqual(second.ingested, []);
  assert.deepEqual(calls, ['sc/1', 'ga/c2/99/1']);
  assert.deepEqual(
    db
      .prepare('SELECT status, COUNT(*) AS n FROM files GROUP BY status')
      .all()
      .map((r) => ({ ...r })),
    [{ status: 'queued', n: 2 }],
  );
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM meetings').get() as { n: number }).n, 3);
});

test('rejected transcripts fail the file; not-ready and network errors leave no file', async () => {
  const db = openDatabase(':memory:');
  const download = async (x: IndexedMeeting): Promise<DownloadedTranscript> => {
    if (x.id === 'sc/1') throw new TranscriptRejectedError('This transcript exceeds 24 segments.');
    if (x.id === 'sc/2') throw new TranscriptNotReadyError('no text');
    throw Error('UN source unavailable (503)');
  };
  const r = await ingestWindow(db, window([m('sc/1'), m('sc/2'), m('sc/3')]), '2026-11-12', download);
  assert.deepEqual(
    r.rejected.map((x) => x.id),
    ['sc/1'],
  );
  assert.deepEqual(r.notReady, ['sc/2']);
  assert.deepEqual(
    r.retryLater.map((x) => x.id),
    ['sc/3'],
  );
  const files = db
    .prepare('SELECT meeting_id, status FROM files')
    .all()
    .map((row) => ({ ...row }));
  assert.deepEqual(files, [{ meeting_id: 'sc/1', status: 'failed' }]);
});

test('file status accepts only the defined states', () => {
  const db = openDatabase(':memory:');
  db.prepare(
    `INSERT INTO meetings VALUES ('sc/9','security_council',NULL,9,1,'2026-11-10','t',1,1,'u','j',NULL,'a','a')`,
  ).run();
  assert.throws(() =>
    db
      .prepare(`INSERT INTO files (id, meeting_id, status, created_at, updated_at) VALUES ('f','sc/9','done','a','a')`)
      .run(),
  );
});

test('the run lock admits one operator until released or expired', () => {
  const db = openDatabase(':memory:');
  const t0 = new Date('2026-11-12T06:00:00Z');
  assert.equal(acquireLock(db, 'a', 10, t0), true);
  assert.equal(acquireLock(db, 'b', 10, t0), false);
  assert.equal(acquireLock(db, 'b', 10, new Date('2026-11-12T06:11:00Z')), true);
  releaseLock(db, 'a');
  assert.equal(acquireLock(db, 'c', 10, new Date('2026-11-12T06:12:00Z')), false);
  releaseLock(db, 'b');
  assert.equal(acquireLock(db, 'c', 10, new Date('2026-11-12T06:12:00Z')), true);
});

test('a lock held by a dead process is taken over', () => {
  const db = openDatabase(':memory:');
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('run_lock', ?, 'x')`).run(
    JSON.stringify({ owner: 'dead', expiresAt: '2999-01-01T00:00:00Z', pid: 2 ** 22 + 12345 }),
  );
  assert.equal(acquireLock(db, 'new', 10), true);
  db.prepare(`UPDATE settings SET value = ? WHERE key = 'run_lock'`).run(
    JSON.stringify({ owner: 'live', expiresAt: '2999-01-01T00:00:00Z', pid: process.pid }),
  );
  assert.equal(acquireLock(db, 'other', 10), false);
});
