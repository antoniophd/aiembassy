// Public pages after the rule of 2026-11-25: no "Not adopted" and no "Low confidence" on them. A file
// that failed for good is shown up to its last accepted document: with an accepted report as a report (its
// cable if any), without one as its triage, a note; rejected documents and the reason stay in Metrics.
// Committee meetings are not "plenary meetings" in the header.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runOnce } from '../engine/run/run.ts';
import { meeting, meetingNumber } from '../web/data.ts';
import { meetingPage } from '../web/pages/meeting.ts';
import { describe, meetingsPage } from '../web/pages/meetings.ts';
import { metricsPage } from '../web/pages/metrics.ts';
import { addMeeting, fakeLlm, goodReport, scripted, services, status } from './support/world.ts';

const opts = { trigger: 'manual' as const, maxMinutes: 5, maxCalls: 200, ingest: false };
const system = (r: { messages: { content: string }[] }) => r.messages[0]?.content ?? '';
const page = (db: Parameters<typeof meetingPage>[0], id: string) => meetingPage(db, id, null)!.body.value;
const FORBIDDEN = /Not adopted|Low confidence|did not pass|internal check|backup writer|fallback/i;

async function world() {
  const base = scripted();
  // sc/301's report always fails its source check: the file fails for good with no accepted report.
  const llm = fakeLlm((req) => {
    if (system(req).includes('Write the meeting report') && JSON.stringify(req.messages).includes('sc/301')) {
      const r = goodReport();
      r.outcome.text = 'The draft was adopted by 14 votes.';
      return r;
    }
    return base(req);
  });
  const s = services(llm);
  addMeeting(s.db, 'sc/300', { date: '2026-11-24' });
  addMeeting(s.db, 'sc/301', { date: '2026-11-24' });
  addMeeting(s.db, 'sc/302', { date: '2026-11-24' });
  await runOnce(s, opts);
  // While its report waits for the second chance, sc/301 is in preparation, with no word of the failure.
  const waiting = meeting(s.db, 'sc/301')!;
  assert.equal(describe(s.db, waiting).state, 'In preparation');
  await runOnce(s, opts); // the second chance, which fails too
  return s;
}

test('a file that failed for good after its report is shown as a report, without the failure', async () => {
  const s = await world();
  assert.equal(status(s.db, 'sc/300').status, 'reported');
  // As a full file that failed at its decision: the accepted report stays, the rest is not shown.
  s.db
    .prepare(
      `UPDATE files SET status = 'not_adopted', level = 'full_file', opinions_json = '["legal"]', low_confidence = 1,
         status_reason = 'decision A: Document failed after regeneration on the fallback model',
         low_confidence_reason = 'Low confidence: written by the fallback model, of the same family as the checker.'
       WHERE meeting_id = 'sc/300'`,
    )
    .run();
  const m = meeting(s.db, 'sc/300')!;
  assert.equal(m.level, 'report');
  assert.equal(describe(s.db, m).state, 'Report');
  const html = page(s.db, 'sc/300');
  assert.doesNotMatch(html, FORBIDDEN);
  assert.match(html, /Meeting report/);
  assert.doesNotMatch(html, />Decision<|Options memo|Opinion/);
  assert.match(html, /class="file plain"/);
  assert.doesNotMatch(meetingsPage(s.db, '2026-11-23').value, FORBIDDEN);
  // Metrics keeps the technical reason, the low confidence and says how the file is shown.
  const metrics = metricsPage(s.db).value;
  assert.match(metrics, /decision A: Document failed after regeneration on the fallback model · Report/);
  assert.match(metrics, /written by the fallback model/);
});

test('a file that failed for good before an accepted report is shown as its triage, a note', async () => {
  const s = await world();
  assert.equal(status(s.db, 'sc/301').status, 'not_adopted');
  const m = meeting(s.db, 'sc/301')!;
  assert.equal(m.level, 'note');
  assert.deepEqual(describe(s.db, m), { cls: '', what: 'Substantive debate.', state: 'Note' });
  const html = page(s.db, 'sc/301');
  assert.doesNotMatch(html, FORBIDDEN);
  assert.match(html, /Substantive debate\./);
  assert.doesNotMatch(html, /Meeting report|Triage/);
  assert.match(metricsPage(s.db).value, /report : Document failed after its second chance · Note \(triage\)/);
});

test('low confidence is not shown on an accepted file; Metrics keeps it', async () => {
  const s = await world();
  s.db
    .prepare(
      `UPDATE files SET low_confidence = 1,
         low_confidence_reason = 'Low confidence: the transcript is short for the meeting’s length.' WHERE meeting_id = 'sc/302'`,
    )
    .run();
  assert.doesNotMatch(page(s.db, 'sc/302'), FORBIDDEN);
  assert.doesNotMatch(meetingsPage(s.db, '2026-11-23').value, FORBIDDEN);
  assert.match(metricsPage(s.db).value, /the transcript is short/);
});

test('the header names the real body: a committee meeting is not a plenary meeting', () => {
  const t = (title: string, body: string) => meetingNumber({ title, id: 'x', body } as never);
  assert.equal(t('Second Committee, 22nd plenary meeting - General Assembly, 99th session', 'ga_c2'), '22nd meeting');
  assert.equal(t('General Assembly: 30th plenary meeting, 99th session', 'ga_plenary'), '30th plenary meeting');
  assert.equal(
    t('The situation in the test region - Security Council, 990th meeting', 'security_council'),
    '990th meeting',
  );
});
