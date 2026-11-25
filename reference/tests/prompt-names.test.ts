// 2026-11-23: no real value in the cable's answer example (the model copied "national capacity"); the
// report is given the meeting's own name ("Third Committee, 41st meeting") and uses it in its title.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runOnce } from '../engine/run/run.ts';
import { cablePrompt } from '../prompts/counsellor.cable.ts';
import { reportPrompt } from '../prompts/counsellor.report.ts';
import { addMeeting, fakeLlm, goodTriage, scripted, services } from './support/world.ts';

const input = (file: boolean) => ({
  meeting: { id: 'ga/c3/99/41', body: 'Third Committee', title: 't', date: '2026-11-10' },
  report: 'r',
  file: file ? { opinions: [], memo: '', decision: {}, next_step: null } : null,
  feedback: [],
});

test('the cable answer example carries placeholders, not a real option or group', () => {
  const full = cablePrompt.build(input(true))[0]!.content;
  const example = full.slice(full.lastIndexOf('Return:'));
  assert.doesNotMatch(example, /national capacity|"A"|European Union|G77/);
  assert.match(example, /"option":"<the decision's option>"/);
  assert.match(example, /"stands_with":\["<each entry of the decision's stands_with>"\]/);
  assert.match(cablePrompt.build(input(false))[0]!.content, /"option":null,"stands_with":null/);
  assert.match(cablePrompt.version, /^1\.7\.0\+/);
});

test('the report prompt names the meeting by its body and asks the title to use that name', () => {
  const msgs = reportPrompt.build({
    profile: { interests: [], red_lines: [] } as never,
    council: false,
    decisionPoint: null,
    decisionStatus: null,
    meeting: {
      id: 'ga/c3/99/41',
      body: 'Third Committee',
      title: 'Third Committee, 41st plenary meeting - General Assembly, 99th session',
      name: 'Third Committee, 41st meeting',
      date: '2026-11-10',
      duration: '01:00:00',
      part: 1,
    },
    speakers: [],
    summaries: [],
    maxWords: 900,
    lowConfidence: null,
    feedback: [],
  });
  assert.match(msgs[0]!.content, /"title": the meeting's name exactly as in "meeting.name"/);
  assert.equal(
    (JSON.parse(msgs[1]!.content) as { meeting: { name: string } }).meeting.name,
    'Third Committee, 41st meeting',
  );
  assert.match(reportPrompt.version, /^2\.8\.0\+/);
});

test('a committee report is sent "Third Committee, 741st meeting", without "plenary"', async () => {
  const llm = fakeLlm(scripted(() => goodTriage('report')));
  const s = services(llm);
  addMeeting(s.db, 'ga/c3/99/741', { date: '2026-11-10' });
  s.db
    .prepare('UPDATE meetings SET title = ? WHERE id = ?')
    .run('Third Committee, 741st plenary meeting - General Assembly, 99th session', 'ga/c3/99/741');
  addMeeting(s.db, 'ga/99/742', { date: '2026-11-10' });
  s.db
    .prepare('UPDATE meetings SET title = ? WHERE id = ?')
    .run('General Assembly: 742nd plenary meeting, 99th session', 'ga/99/742');
  await runOnce(s, { trigger: 'manual', maxMinutes: 5, maxCalls: 200, ingest: false });
  const names = llm.requests
    .filter((r) => (r.messages[0]?.content ?? '').includes('Write the meeting report'))
    .map((r) => (JSON.parse(r.messages[1]!.content) as { meeting: { name: string } }).meeting.name)
    .sort();
  assert.deepEqual(names, ['General Assembly, 742nd plenary meeting', 'Third Committee, 741st meeting']);
});
