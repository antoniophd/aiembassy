// cli/reopen shows, before acting, which other files of the dossier lose their position or wait (
// 2026-11-25). Invented data, in memory.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runOnce } from '../engine/run/run.ts';
import { dossierImpact, impactLines } from '../engine/work/reopen-impact.ts';
import { addMeeting, fakeLlm, goodTriage, scripted, services, status } from './support/world.ts';

const opts = { trigger: 'manual' as const, maxMinutes: 5, maxCalls: 400, ingest: false };

test('reopening an earlier meeting: later files with a position lose it, later files in work wait', async () => {
  const s = services(fakeLlm(scripted(() => goodTriage('full_file'))));
  for (const [id, date] of [
    ['ga/c3/99/40', '2026-11-10'],
    ['ga/c3/99/41', '2026-11-11'],
    ['ga/c3/99/42', '2026-11-12'],
  ] as const)
    addMeeting(s.db, id, { date });
  await runOnce(s, opts);
  assert.equal(status(s.db, 'ga/c3/99/40').status, 'adopted');
  const dossier = (
    s.db.prepare(`SELECT dossier_id FROM files WHERE meeting_id = 'ga/c3/99/40'`).get() as { dossier_id: string }
  ).dossier_id;
  assert.ok(dossier);
  // The same dossier for the two later meetings: 41 with a position (an event like 40's), 42 still in work.
  const later = (id: string) => `(SELECT id FROM files WHERE meeting_id = '${id}')`;
  for (const id of ['ga/c3/99/41', 'ga/c3/99/42'])
    s.db.prepare(`UPDATE files SET dossier_id = ?, status = 'in_progress' WHERE meeting_id = ?`).run(dossier, id);
  s.db.prepare(`DELETE FROM dossier_events WHERE file_id IN (${later('ga/c3/99/41')}, ${later('ga/c3/99/42')})`).run();
  const cols = (s.db.prepare('PRAGMA table_info(dossier_events)').all() as { name: string }[])
    .map((c) => c.name)
    .filter((c) => c !== 'id' && c !== 'file_id');
  s.db
    .prepare(
      `INSERT INTO dossier_events (id, file_id, ${cols.join(', ')}) SELECT 'ev-41', ${later('ga/c3/99/41')}, ${cols.join(', ')}
       FROM dossier_events WHERE file_id = ${later('ga/c3/99/40')}`,
    )
    .run();
  s.db.prepare(`UPDATE files SET status = 'adopted' WHERE meeting_id = 'ga/c3/99/41'`).run();
  const impact = dossierImpact(s.db, ['ga/c3/99/40']);
  assert.deepEqual(impact, [
    { meetingId: 'ga/c3/99/40', dossierId: dossier, losePosition: ['ga/c3/99/41'], wait: ['ga/c3/99/42'] },
  ]);
  assert.match(impactLines(impact).join('\n'), /lose their position and decide again: ga\/c3\/99\/41/);
  // The last meeting of a dossier affects no one; meetings reopened together are not listed for each other.
  assert.deepEqual(dossierImpact(s.db, ['ga/c3/99/42']), []);
  assert.deepEqual(dossierImpact(s.db, ['ga/c3/99/40', 'ga/c3/99/41', 'ga/c3/99/42']), []);
});
