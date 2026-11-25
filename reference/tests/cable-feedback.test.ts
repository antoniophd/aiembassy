// 2026-11-23: a reopened cable is told why every earlier cable attempt of the file was rejected (all
// rounds); the assessment rejection says what the cable wrote. Length (2026-11-24): the cable aims at
// 900 words, one or two pages; the check allows 450 to 1,500.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkCable } from '../engine/check/cable.ts';
import { runOnce } from '../engine/run/run.ts';
import { recableFile } from '../engine/work/reopen.ts';
import { cablePrompt } from '../prompts/counsellor.cable.ts';
import { addMeeting, fakeLlm, goodCable, goodTriage, scripted, services, status } from './support/world.ts';

const sys = (r: { messages: { content: string }[] }) => r.messages[0]?.content ?? '';
const isCable = (r: { messages: { content: string }[] }) =>
  sys(r).includes('Write the cable with which the Permanent Mission reports');
const opts = { trigger: 'manual' as const, maxMinutes: 5, maxCalls: 300, ingest: false };

test('the assessment rejection says what the cable wrote', () => {
  const c = { ...goodCable(true), option: 'A', stands_with: ['national capacity'] };
  const f = checkCable(
    c as never,
    {
      reportText: '',
      segments: [],
      decision: { option: 'A', stands_with: ['Coastal Group', 'Meridian Group', 'Group of Nine'] },
    } as never,
  );
  assert.ok(
    f.includes(
      'cable: the assessment must keep the decision (option A, stands with Coastal Group, Meridian Group, Group of Nine); the cable said: option A, stands with national capacity',
    ),
    f.join('\n'),
  );
});

test('the cable prompt aims at 900 words, one or two pages; never more than 1,500', () => {
  const system = cablePrompt.build({
    meeting: { id: 'sc/1', body: 'Security Council', title: 't', date: '2026-11-10' },
    report: 'r',
    file: null,
    feedback: [],
  })[0]!.content;
  assert.match(system, /aim for about 900 words in all \(one or two pages\), never more than 1,500/);
  assert.doesNotMatch(system, /600 to 800/);
  assert.match(cablePrompt.version, /^1\.7\.0\+/);
});

test('the check allows 450 to 1,500 words (2026-11-24)', async () => {
  const { parseCable, CABLE_WORDS } = await import('../engine/check/cable.ts');
  assert.deepEqual(CABLE_WORDS, { min: 450, max: 1500 });
  const ctx = { reportText: 'The Council met.', segments: [], decision: null };
  // A cable of n counted words: the subject and titles count too, so the filler is measured first.
  const draft = (filler: number) =>
    parseCable({
      ...goodCable(false),
      summary: 'Summary.',
      paragraphs: [{ title: 'Topic', text: 'word '.repeat(filler).trim() }],
      assessment: ['Watch.'],
    });
  const words = (c: ReturnType<typeof draft>) =>
    Number(/length: (\d+) words/.exec(checkCable(c, ctx).join())?.[1] ?? NaN);
  const overhead = words(draft(1)) - 1;
  const length = (n: number) => checkCable(draft(n - overhead), ctx).filter((x) => x.startsWith('length:'));
  assert.deepEqual(length(450), []);
  assert.deepEqual(length(1500), []);
  assert.deepEqual(length(449), ['length: 449 words; a cable has 450 to 1,500 words']);
  assert.deepEqual(length(1501), ['length: 1501 words; a cable has 450 to 1,500 words']);
});

test('a reopened cable is told the rejections of every earlier round, each once, newest first', async () => {
  let n = 0;
  const base = scripted(() => goodTriage('full_file'));
  const llm = fakeLlm((req) => {
    const out = base(req);
    if (!isCable(req)) return out;
    n++;
    // Round 1: the assessment departs from the decision, then a segment mark; round 2 passes.
    if (n === 1) return { ...(out as object), stands_with: ['national capacity'] };
    if (n === 2) return { ...(out as object), summary: `${(out as { summary: string }).summary} [E3]` };
    return out;
  });
  const s = services(llm);
  addMeeting(s.db, 'sc/880');
  await runOnce(s, opts);
  assert.match(String(status(s.db, 'sc/880').status_reason), /No cable: it failed its checks twice/);
  recableFile(s.db, 'sc/880', 'third try');
  await runOnce(s, opts);
  const cables = llm.requests.filter(isCable);
  assert.equal(cables.length, 3);
  const told = (i: number) =>
    (JSON.parse(cables[i]!.messages[1]!.content) as { previous_attempt_rejected_for?: string[] })
      .previous_attempt_rejected_for ?? [];
  assert.deepEqual(told(0), []);
  assert.equal(told(1).length, 1);
  assert.match(told(1)[0]!, /the cable said: option A, stands with national capacity/);
  // The third attempt opens a new round and still hears both earlier reasons, the newest first.
  assert.equal(told(2).length, 2);
  assert.match(told(2)[0]!, /no segment marks/);
  assert.match(told(2)[1]!, /the cable said: option A, stands with national capacity/);
  assert.equal(status(s.db, 'sc/880').status, 'adopted');
  assert.equal(s.db.prepare(`SELECT COUNT(*) AS n FROM documents WHERE kind = 'cable'`).get()?.n, 3);
});
