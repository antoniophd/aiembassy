import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runOnce } from '../engine/run/run.ts';
import {
  addMeeting,
  fakeLlm,
  goodReport,
  goodTriage,
  providerDown,
  scripted,
  services,
  status,
} from './support/world.ts';

const opts = { trigger: 'manual' as const, maxMinutes: 5, maxCalls: 100, ingest: false };
const system = (r: { messages: { content: string }[] }) => r.messages[0]?.content ?? '';
const docs = (db: import('node:sqlite').DatabaseSync, kind: string) =>
  db.prepare(`SELECT * FROM documents WHERE kind = ?`).all(kind) as Record<string, unknown>[];

test('a report-level meeting: triage, one summary per segment, report, source check, reported', async () => {
  const llm = fakeLlm(scripted());
  const s = services(llm);
  addMeeting(s.db, 'sc/100');
  const r = await runOnce(s, opts);
  assert.equal(r.outcome, 'completed');
  assert.equal(r.calls, 5); // triage + 2 summaries + report + cable (every Council report, 2026-11-23)
  assert.equal(status(s.db, 'sc/100').status, 'reported');
  const check = JSON.parse(String(docs(s.db, 'check')[0]?.body_json));
  assert.equal(check.pass, true);
  const report = docs(s.db, 'report')[0]!;
  assert.equal(report.prompt_id, 'counsellor.report');
  assert.equal(report.model, 'w');
  assert.equal(report.input_tokens, 10);
  assert.equal(llm.requests.find((q) => system(q).includes('triage'))?.reasoning, true);
});

test('a second run repeats nothing', async () => {
  const llm = fakeLlm(scripted());
  const s = services(llm);
  addMeeting(s.db, 'sc/100');
  await runOnce(s, opts);
  const before = llm.requests.length;
  const r = await runOnce(s, opts);
  assert.equal(r.calls, 0);
  assert.equal(llm.requests.length, before);
});

test('a note-level meeting gets one note and is noted', async () => {
  const s = services(fakeLlm(scripted(() => goodTriage('note'))));
  addMeeting(s.db, 'sc/101', { duration: '00:03:00' });
  await runOnce(s, opts);
  assert.equal(status(s.db, 'sc/101').status, 'noted');
  assert.equal(docs(s.db, 'note').length, 1);
});

test('a provider failure moves the call to the fallback model in the next step', async () => {
  let failed = false;
  const base = scripted();
  const llm = fakeLlm((req) => {
    if (!failed && system(req).includes('Summarise')) {
      failed = true;
      return providerDown();
    }
    return base(req);
  });
  const s = services(llm);
  addMeeting(s.db, 'sc/102');
  await runOnce(s, opts);
  assert.equal(status(s.db, 'sc/102').status, 'reported');
  const calls = s.db
    .prepare(`SELECT task, fallback, state, model_requested FROM llm_calls WHERE task = 'summary' ORDER BY rowid`)
    .all();
  assert.deepEqual(calls.map((c) => ({ ...c })).slice(0, 2), [
    { task: 'summary', fallback: 0, state: 'failed', model_requested: 'w' },
    { task: 'summary', fallback: 1, state: 'complete', model_requested: 'f' },
  ]);
});

test('a corrupted report is regenerated, then on the fallback, then gets its second chance on the next run, then is not adopted', async () => {
  const base = scripted();
  const llm = fakeLlm((req) => {
    if (system(req).includes('Write the meeting report')) {
      const r = goodReport();
      r.outcome.text = 'The draft was adopted by 14 votes.'; // altered figure
      r.positions[0]!.delegation = 'Corvalia'; // wrong speaker
      return r;
    }
    return base(req);
  });
  const s = services(llm);
  addMeeting(s.db, 'sc/103');
  await runOnce(s, opts);
  // After the fallback the file waits, in preparation, for its second chance (2026-11-25).
  assert.equal(status(s.db, 'sc/103').status, 'in_progress');
  await runOnce(s, opts);
  const f = status(s.db, 'sc/103');
  assert.equal(f.status, 'not_adopted');
  assert.match(String(f.status_reason), /second chance/);
  // The second chance is on the writer and hears every rejection of the epoch.
  const last = llm.requests.filter((q) => system(q).includes('Write the meeting report')).at(-1)!;
  assert.equal(last.model, 'w');
  const reports = s.db
    .prepare(
      `SELECT d.attempt, c.fallback, c.error_kind FROM documents d JOIN llm_calls c ON c.id = d.llm_call_id WHERE d.kind = 'report' ORDER BY d.attempt`,
    )
    .all();
  assert.deepEqual(
    reports.map((x) => ({ ...x })),
    [
      { attempt: 1, fallback: 0, error_kind: 'check' },
      { attempt: 2, fallback: 0, error_kind: 'check' },
      { attempt: 3, fallback: 1, error_kind: 'check' },
      { attempt: 4, fallback: 0, error_kind: 'check' },
    ],
  );
  const regen = llm.requests.filter((q) => system(q).includes('Write the meeting report'))[1];
  assert.match(regen?.messages[1]?.content ?? '', /previous_attempt_rejected_for/);
});

test('a resumed part joins the first part: duplicate_of, report stored in the first file', async () => {
  const llm = fakeLlm(
    scripted((req) => {
      const input = req.messages[1]?.content ?? '';
      return input.includes('"duplicate_candidates":[{')
        ? goodTriage('report', { duplicate_of: 'sc/104' })
        : goodTriage('report');
    }),
  );
  const s = services(llm);
  addMeeting(s.db, 'sc/104', { date: '2026-11-09' });
  addMeeting(s.db, 'sc/104/2', { date: '2026-11-10' });
  await runOnce(s, opts);
  assert.deepEqual(status(s.db, 'sc/104/2'), {
    status: 'reported',
    level: 'report',
    duplicate_of: 'sc/104',
    low_confidence: 0,
    status_reason: 'Resumed part of sc/104; documents in that file.',
  });
  const reports = s.db
    .prepare(`SELECT file_id, meeting_id FROM documents WHERE kind = 'report'`)
    .all()
    .map((x) => ({ ...x }));
  assert.deepEqual(reports, [
    { file_id: 'file:sc/104', meeting_id: 'sc/104' },
    { file_id: 'file:sc/104', meeting_id: 'sc/104/2' },
  ]);
});

test('a suspect transcript is processed with low confidence and every document says so in one line', async () => {
  const s = services(fakeLlm(scripted()));
  addMeeting(s.db, 'sc/105', { duration: '02:00:00', chars: 8400 });
  await runOnce(s, opts);
  const f = status(s.db, 'sc/105');
  assert.equal(f.status, 'reported');
  assert.equal(f.low_confidence, 1);
  for (const kind of ['triage', 'report']) {
    const first = String(docs(s.db, kind)[0]?.text).split('\n')[0] ?? '';
    assert.match(
      first,
      /^Low confidence: the transcript is short for the meeting’s length \(8,400 characters for 2 h 00 min\)/,
    );
  }
});

test('the call budget stops the run; the next run continues', async () => {
  const s = services(fakeLlm(scripted()));
  addMeeting(s.db, 'sc/106');
  const first = await runOnce(s, { ...opts, maxCalls: 2 });
  assert.equal(first.outcome, 'budget');
  assert.equal(status(s.db, 'sc/106').status, 'in_progress');
  const second = await runOnce(s, opts);
  assert.equal(second.calls, 3); // summary, report, cable
  assert.equal(status(s.db, 'sc/106').status, 'reported');
});

test('a rejected key halts the run without touching other files', async () => {
  const { ModelCallError } = await import('../engine/llm/index.ts');
  const s = services(fakeLlm(() => new ModelCallError('Ollama rejected the key.', 'config', 401)));
  addMeeting(s.db, 'sc/107');
  addMeeting(s.db, 'sc/108');
  const r = await runOnce(s, opts);
  assert.equal(r.outcome, 'failed');
  assert.match(String(r.halted), /configuration/);
  assert.equal(r.calls, 1);
  assert.equal(status(s.db, 'sc/108').status, 'queued');
});

test('a third part linked to the second is re-linked to the first part', async () => {
  const llm = fakeLlm(
    scripted((req) => {
      const input = req.messages[1]?.content ?? '';
      if (input.includes('"id":"sc/200/3"')) return goodTriage('report', { duplicate_of: 'sc/200/2' });
      if (input.includes('"id":"sc/200/2"')) return goodTriage('report', { duplicate_of: 'sc/200' });
      return goodTriage('report');
    }),
  );
  const s = services(llm);
  addMeeting(s.db, 'sc/200', { date: '2026-11-09' });
  addMeeting(s.db, 'sc/200/2', { date: '2026-11-10' });
  addMeeting(s.db, 'sc/200/3', { date: '2026-11-11' });
  await runOnce(s, opts);
  assert.equal(status(s.db, 'sc/200/3').duplicate_of, 'sc/200');
  assert.equal(status(s.db, 'sc/200/3').status, 'reported');
  const parts = s.db
    .prepare(`SELECT meeting_id FROM documents WHERE kind = 'report' AND file_id = 'file:sc/200' ORDER BY meeting_id`)
    .all();
  assert.deepEqual(
    parts.map((p) => p.meeting_id),
    ['sc/200', 'sc/200/2', 'sc/200/3'],
  );
});

test('a not-adopted file reopens: summaries are reused, attempts count on, no call is resent', async () => {
  const { reopenFiles } = await import('../engine/work/reopen.ts');
  let corrupt = true;
  const base = scripted();
  const llm = fakeLlm((req) => {
    if (corrupt && system(req).includes('Write the meeting report')) {
      const r = goodReport();
      r.outcome.text = 'The draft was adopted by 14 votes.';
      return r;
    }
    return base(req);
  });
  const s = services(llm);
  addMeeting(s.db, 'sc/300');
  await runOnce(s, opts);
  await runOnce(s, opts); // the second chance fails too
  assert.equal(status(s.db, 'sc/300').status, 'not_adopted');
  const summariesBefore = llm.requests.filter((q) => system(q).includes('Summarise')).length;
  corrupt = false;
  const r = reopenFiles(s.db, ['sc/300'], 'test: check fixed');
  assert.deepEqual(r, [{ meetingId: 'sc/300', from: 'not_adopted', to: 'in_progress', epoch: 1 }]);
  await runOnce(s, opts);
  assert.equal(status(s.db, 'sc/300').status, 'reported');
  assert.equal(llm.requests.filter((q) => system(q).includes('Summarise')).length, summariesBefore);
  const attempts = s.db
    .prepare(`SELECT attempt, epoch FROM llm_calls WHERE task = 'report' ORDER BY rowid`)
    .all()
    .map((x) => ({ ...x }));
  assert.deepEqual(attempts, [
    { attempt: 1, epoch: 0 },
    { attempt: 2, epoch: 0 },
    { attempt: 3, epoch: 0 },
    { attempt: 4, epoch: 0 }, // the second chance
    { attempt: 5, epoch: 1 },
  ]);
  assert.throws(() => reopenFiles(s.db, ['sc/300'], 'again'), /only not_adopted or failed/);
});

test('a document written by the fallback model is low confidence, and so is its file', async () => {
  let down = true;
  const base = scripted();
  const llm = fakeLlm((req) => {
    if (down && system(req).includes('Write the meeting report') && req.model === 'w') {
      down = false;
      return providerDown();
    }
    return base(req);
  });
  const s = services(llm);
  addMeeting(s.db, 'sc/301');
  await runOnce(s, opts);
  const f = status(s.db, 'sc/301');
  assert.equal(f.status, 'reported');
  // The document keeps its line (never rewritten); the file loses it once the second checker passed every claim
  // (2026-11-23).
  assert.equal(f.low_confidence, 0);
  const report = docs(s.db, 'report')[0]!;
  assert.equal(report.low_confidence, 1);
  assert.equal(report.model, 'f');
  assert.match(
    String(report.text).split('\n')[0] ?? '',
    /^Low confidence: written by the fallback model, of the same family as the checker\./,
  );
  assert.equal(docs(s.db, 'triage')[0]?.low_confidence, 0);
});

test('a figure cited to the wrong segment is rejected and the writer redoes it with the right segment', async () => {
  const base = scripted();
  let first = true;
  const llm = fakeLlm((req) => {
    if (system(req).includes('Write the meeting report')) {
      const r = goodReport();
      if (first) r.issues[0]!.cites = ['E2']; // 9901 and 15 are in E1
      first = false;
      return r;
    }
    return base(req);
  });
  const s = services(llm);
  addMeeting(s.db, 'sc/302');
  await runOnce(s, opts);
  assert.equal(status(s.db, 'sc/302').status, 'reported');
  const checks = docs(s.db, 'check').map((c) => JSON.parse(String(c.body_json)).pass);
  assert.deepEqual(checks, [false, true]);
  const second = llm.requests.filter((q) => system(q).includes('Write the meeting report'))[1];
  assert.match(second?.messages[1]?.content ?? '', /not in E2; it appears in E1/);
});

test('a restarted file is worked again from triage; old documents stay stored but no longer count', async () => {
  const { restartFile } = await import('../engine/work/reopen.ts');
  const llm = fakeLlm(scripted());
  const s = services(llm);
  addMeeting(s.db, 'sc/303');
  await runOnce(s, opts);
  const before = llm.requests.length;
  assert.deepEqual(restartFile(s.db, 'sc/303', 'test'), {
    meetingId: 'sc/303',
    from: 'reported',
    to: 'queued',
    epoch: 1,
  });
  await runOnce(s, opts);
  assert.equal(status(s.db, 'sc/303').status, 'reported');
  assert.equal(llm.requests.length - before, 5); // triage + 2 summaries + report + cable, again
  assert.equal(docs(s.db, 'triage').length, 2);
  const epochs = s.db.prepare(`SELECT DISTINCT epoch FROM llm_calls WHERE task = 'triage' ORDER BY epoch`).all();
  assert.deepEqual(
    epochs.map((e) => e.epoch),
    [0, 1],
  );
});

test('a triage written by the fallback model leaves its file low confidence', async () => {
  let down = true;
  const base = scripted();
  const llm = fakeLlm((req) => {
    if (down && system(req).includes('You triage every completed meeting')) {
      down = false;
      return providerDown();
    }
    return base(req);
  });
  const s = services(llm);
  addMeeting(s.db, 'sc/304');
  await runOnce(s, opts);
  const f = status(s.db, 'sc/304');
  assert.equal(f.low_confidence, 1);
  assert.equal(f.status, 'reported');
  const reason = (
    s.db.prepare(`SELECT low_confidence_reason AS r FROM files WHERE meeting_id = 'sc/304'`).get() as { r: string }
  ).r;
  assert.match(reason, /written by the fallback model/);
});

test('a suspect transcript and a fallback triage keep both reasons', async () => {
  let down = true;
  const base = scripted();
  const llm = fakeLlm((req) => {
    if (down && system(req).includes('You triage every completed meeting')) {
      down = false;
      return providerDown();
    }
    return base(req);
  });
  const s = services(llm);
  addMeeting(s.db, 'sc/305', { duration: '02:00:00', chars: 8400 });
  await runOnce(s, opts);
  const reason = (
    s.db.prepare(`SELECT low_confidence_reason AS r FROM files WHERE meeting_id = 'sc/305'`).get() as { r: string }
  ).r;
  assert.match(reason, /transcript is short/);
  assert.match(reason, /fallback model/);
});
