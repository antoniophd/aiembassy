// Reprocessing past weeks (2026-11-13): held after the new triage,
// positions decided in meeting order (also when an earlier meeting joins a
// dossier later), a missing cable added on reopening.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runOnce } from '../engine/run/run.ts';
import { reworkFile } from '../engine/work/reopen.ts';
import { addMeeting, fakeLlm, goodDecision, goodTriage, scripted, services, status } from './support/world.ts';

const sys = (r: { messages: { content: string }[] }) => r.messages[0]?.content ?? '';
const opts = { trigger: 'manual' as const, maxMinutes: 5, maxCalls: 300, ingest: false };

test('reprocess: held after the new triage; positions decided in meeting order', async () => {
  const { recableFile } = await import('../engine/work/reopen.ts');
  const base = scripted(() => goodTriage('full_file', { dossier: { id: null, new_title: 'Test situation' } }));
  // The decision follows the dossier it is given: "first" without a standing position, else "maintains".
  const llm = fakeLlm((req) =>
    sys(req).includes('you take the decision on this file')
      ? goodDecision({
          change: (JSON.parse(req.messages[1]?.content ?? '{}') as { dossier?: { standing_position?: string } }).dossier
            ?.standing_position
            ? 'maintains'
            : 'first',
        })
      : base(req),
  );
  const s = services(llm);
  addMeeting(s.db, 'sc/450', { date: '2026-11-02' });
  addMeeting(s.db, 'sc/451', { date: '2026-11-03' });
  await runOnce(s, opts);
  assert.deepEqual([status(s.db, 'sc/450').status, status(s.db, 'sc/451').status], ['adopted', 'adopted']);
  // Rework both, held after triage: only the two triages run.
  reworkFile(s.db, 'sc/451', 'reprocess', true);
  reworkFile(s.db, 'sc/450', 'reprocess', true);
  const before = llm.requests.length;
  await runOnce(s, opts);
  assert.deepEqual(
    llm.requests.slice(before).map((q) => (sys(q).includes('You triage every completed meeting') ? 'triage' : 'other')),
    ['triage', 'triage'],
  );
  assert.equal(status(s.db, 'sc/450').status, 'triaged');
  // Released: the earlier meeting decides first; the dossier reads first, then maintains.
  s.db.prepare('UPDATE files SET hold_after_triage = 0').run();
  await runOnce(s, opts);
  const events = s.db
    .prepare(
      `SELECT f.meeting_id, e.change FROM dossier_events e JOIN files f ON f.id = e.file_id ORDER BY e.created_at`,
    )
    .all()
    .map((e) => `${e.meeting_id}:${e.change}`);
  assert.deepEqual(events, ['sc/450:first', 'sc/451:maintains']);
});

test('a file adopted without its cable (two failures) gets it on reopening; nothing else is redone', async () => {
  const { recableFile } = await import('../engine/work/reopen.ts');
  const { goodCable } = await import('./support/world.ts');
  let cableOk = false;
  const base = scripted(() => goodTriage('full_file'));
  const llm = fakeLlm((req) =>
    sys(req).includes('Write the cable with which')
      ? cableOk
        ? { ...goodCable(true) }
        : { ...goodCable(true), paragraphs: [{ title: 'Short', text: 'Too short.' }] }
      : base(req),
  );
  const s = services(llm);
  addMeeting(s.db, 'sc/452');
  await runOnce(s, opts);
  assert.equal(status(s.db, 'sc/452').status, 'adopted');
  assert.match(String(status(s.db, 'sc/452').status_reason), /No cable: it failed its checks twice/);
  cableOk = true;
  const n = llm.requests.length;
  recableFile(s.db, 'sc/452', 'missing cable');
  await runOnce(s, opts);
  assert.deepEqual(
    llm.requests.slice(n).map((q) => sys(q).includes('Write the cable with which')),
    [true],
  );
  assert.equal(status(s.db, 'sc/452').status, 'adopted');
  assert.equal(s.db.prepare(`SELECT COUNT(*) AS n FROM documents WHERE kind = 'cable'`).get()?.n, 3);
});

test('an earlier meeting joining a dossier with later decisions: those decide again, in meeting order', async () => {
  const base = scripted(() => goodTriage('full_file', { dossier: { id: null, new_title: 'Test situation' } }));
  const llm = fakeLlm((req) =>
    sys(req).includes('you take the decision on this file')
      ? goodDecision({
          change: (JSON.parse(req.messages[1]?.content ?? '{}') as { dossier?: { standing_position?: string } }).dossier
            ?.standing_position
            ? 'maintains'
            : 'first',
        })
      : base(req),
  );
  const s = services(llm);
  addMeeting(s.db, 'sc/461', { date: '2026-11-03' });
  await runOnce(s, opts);
  addMeeting(s.db, 'sc/460', { date: '2026-11-02' }); // arrives later, happened earlier
  await runOnce(s, opts);
  const events = s.db
    .prepare(
      `SELECT f.meeting_id, e.change FROM dossier_events e JOIN files f ON f.id = e.file_id ORDER BY e.created_at`,
    )
    .all()
    .map((e) => `${e.meeting_id}:${e.change}`);
  assert.deepEqual(events, ['sc/460:first', 'sc/461:maintains']);
  assert.equal(status(s.db, 'sc/461').status, 'adopted');
  assert.ok(s.db.prepare(`SELECT 1 FROM settings WHERE key LIKE 'dossier-log:%'`).get());
});

test('replacing an accepted cable: the old one is kept but no longer counts; only the cable is redone', async () => {
  const { recableFile } = await import('../engine/work/reopen.ts');
  const llm = fakeLlm(scripted(() => goodTriage('full_file')));
  const s = services(llm);
  addMeeting(s.db, 'sc/470');
  await runOnce(s, opts);
  const n = llm.requests.length;
  recableFile(s.db, 'sc/470', 'ambiguous figures', true);
  await runOnce(s, opts);
  assert.deepEqual(
    llm.requests.slice(n).map((q) => sys(q).includes('Write the cable with which')),
    [true],
  );
  assert.equal(status(s.db, 'sc/470').status, 'adopted');
  assert.equal(s.db.prepare(`SELECT COUNT(*) AS n FROM documents WHERE kind = 'cable'`).get()?.n, 2);
});

test('reworking from the report keeps the triage and the summaries, waits while held, then redoes the rest', async () => {
  const { reworkFromReport } = await import('../engine/work/reopen.ts');
  const llm = fakeLlm(scripted(() => goodTriage('full_file')));
  const s = services(llm);
  addMeeting(s.db, 'sc/480');
  await runOnce(s, opts);
  reworkFromReport(s.db, 'sc/480', 'misread figures', true);
  const n = llm.requests.length;
  await runOnce(s, opts);
  assert.equal(llm.requests.length, n); // held: nothing
  s.db.prepare('UPDATE files SET hold_after_triage = 0').run();
  await runOnce(s, opts);
  const redone = llm.requests.slice(n).map(sys);
  assert.equal(redone.filter((x) => x.includes('You triage every completed meeting')).length, 0);
  assert.equal(redone.filter((x) => x.includes('Summarise one segment')).length, 0);
  assert.equal(redone.filter((x) => x.includes('Write the meeting report')).length, 1);
  assert.equal(redone.filter((x) => x.includes('Write the cable with which')).length, 1);
  assert.equal(status(s.db, 'sc/480').status, 'adopted');
});

test('dossier timelines: stale events are found and removed; first must be first; the cascade skips stale events', async () => {
  const { dossierIssues, removeStaleEvents } = await import('../engine/work/dossier-check.ts');
  const llm = fakeLlm(scripted(() => goodTriage('full_file', { dossier: { id: null, new_title: 'Test situation' } })));
  const s = services(llm);
  addMeeting(s.db, 'sc/490', { date: '2026-11-02' });
  await runOnce(s, opts);
  assert.deepEqual(dossierIssues(s.db), []);
  // The file moves to another dossier; its old event stays behind (as after the re-decision of 2026-11-12).
  s.db
    .prepare(`INSERT INTO dossiers (id, title, created_at, updated_at) VALUES ('dossier:other', 'Other', 'x', 'x')`)
    .run();
  s.db.prepare(`UPDATE files SET dossier_id = 'dossier:other' WHERE meeting_id = 'sc/490'`).run();
  assert.deepEqual(
    dossierIssues(s.db).map((i) => i.issue),
    ['stale'],
  );
  assert.equal(removeStaleEvents(s.db), 1);
  assert.deepEqual(dossierIssues(s.db), []);
  assert.equal(s.db.prepare(`SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'dossier-log:%:stale'`).get()?.n, 1);
});
