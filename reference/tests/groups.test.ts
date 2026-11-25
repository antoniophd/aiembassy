import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDecision } from '../engine/check/decision.ts';
import { checkStandsWith, groupsInMeeting, type SegmentLike } from '../engine/check/groups.ts';
import { runOnce } from '../engine/run/run.ts';
import { redecideFile } from '../engine/work/reopen.ts';
import { TEST_PROFILE } from './support/invented.ts';
import { addMeeting, fakeLlm, goodDecision, goodTriage, scripted, services, status } from './support/world.ts';

const profile = TEST_PROFILE;
const segments: SegmentLike[] = [
  {
    label: 'E1',
    text: '[0s] These remarks are made on behalf of the Coastal Group. We ask for a technical rollover.\n[40s] Thank you.',
    speakers: [{ start: 0, end: 40, label: 'Arvenia' }],
  },
  {
    label: 'E2',
    text: '[100s] I speak on behalf of Arvenia, Belmora, and Corvalia.\n[120s] We can accept the text.',
    speakers: [
      { start: 100, end: 130, label: 'Corvalia · Highland Forum' },
      { start: 140, end: 160, label: 'Group of Nine' },
    ],
  },
  {
    label: 'E4',
    text: '[300s] Dravonia presented the draft on behalf of the Meridian Group.',
    speakers: [{ start: 300, end: 310, label: '1st Committee · Secretary' }],
  },
  {
    label: 'E3',
    text: '[200s] Elbaria: the Union of Lakeland States sanctions regime comes up, but Elbaria speaks for itself.',
    speakers: [{ start: 200, end: 210, label: 'Elbaria' }],
  },
];
const evidence = groupsInMeeting(segments, profile);
const near = { closest_to: 'Highland Forum', differs_on: { text: 'The Forum wants a longer mandate.', cite: 'E2' } };
const decide = (stands_with: string[], group_positions: unknown[], extra: Record<string, unknown> = {}) =>
  parseDecision(goodDecision({ stands_with, group_positions, ...extra }));
const gp = (group: string, cite: string, same: boolean) => ({ group, cite, position: 'It said so.', same });

test('groups are found by speaker label or "on behalf of", not by a passing mention', () => {
  assert.deepEqual(
    evidence.map((e) => [e.group, e.segments.map((s) => s.label)]),
    [
      ['Coastal Group', ['E1']],
      ['Group of Nine', ['E2']],
      ['Highland Forum', ['E2']],
    ],
  );
  assert.match(evidence[0]?.segments[0]?.excerpt ?? '', /technical rollover/);
});

test('stands_with names the groups that defended the same position, cited to their segment', () => {
  const all = [gp('Coastal Group', 'E1', true), gp('Highland Forum', 'E2', false), gp('Group of Nine', 'E2', false)];
  assert.deepEqual(checkStandsWith(decide(['Coastal Group'], all), evidence), []);
  const multi = [
    gp('Coastal Group', 'E1', true),
    gp('Highland Forum', 'E2', false),
    gp('Group of Nine', '[E2] and E2', false),
  ];
  assert.deepEqual(checkStandsWith(decide(['Coastal Group'], multi), evidence), []);
  // A matching group exists: "national capacity" is refused.
  assert.match(checkStandsWith(decide(['national capacity'], all), evidence).join(' '), /name them instead/);
  // No group matches, or the State departs from all: "national capacity" is right, a group is not.
  const none = all.map((g) => ({ ...g, same: false }));
  assert.deepEqual(checkStandsWith(decide(['national capacity'], none, near), evidence), []);
  assert.match(checkStandsWith(decide(['Highland Forum'], none), evidence).join(' '), /must be "national capacity"/);
  // Every group that spoke is accounted for, with the segment where it spoke.
  assert.match(checkStandsWith(decide(['Coastal Group'], all.slice(0, 2)), evidence).join(' '), /Group of Nine spoke/);
  assert.match(
    checkStandsWith(decide(['Coastal Group'], [gp('Coastal Group', 'E3', true), ...all.slice(1)]), evidence).join(' '),
    /cited to E3; it spoke in E1/,
  );
  // A group that never took the floor cannot be named.
  assert.match(
    checkStandsWith(
      decide(['Union of Lakeland States'], [...none, gp('Union of Lakeland States', 'E3', true)]),
      evidence,
    ).join(' '),
    /Union of Lakeland States did not take the floor/,
  );
});

test('national capacity with groups on the floor names the closest one and where the State differs', () => {
  const none = [gp('Coastal Group', 'E1', false), gp('Highland Forum', 'E2', false), gp('Group of Nine', 'E2', false)];
  const f = (extra: Record<string, unknown>) =>
    checkStandsWith(decide(['national capacity'], none, extra), evidence).join(' ');
  assert.equal(f(near), '');
  assert.match(f({}), /closest_to: name the group.*differs_on: one sentence/);
  assert.match(
    f({ ...near, closest_to: 'Union of Lakeland States' }),
    /Union of Lakeland States did not take the floor/,
  );
  assert.match(
    f({ ...near, differs_on: { text: 'Longer mandate.', cite: 'E1' } }),
    /cited to E1; Highland Forum spoke in E2/,
  );
  // Not with a group named, nor when no group spoke.
  const all = [gp('Coastal Group', 'E1', true), ...none.slice(1)];
  assert.match(
    checkStandsWith(decide(['Coastal Group'], all, near), evidence).join(' '),
    /only with "national capacity"/,
  );
  assert.match(
    checkStandsWith(decide(['national capacity'], [], near), []).join(' '),
    /leave closest_to and differs_on null/,
  );
  assert.deepEqual(checkStandsWith(decide(['national capacity'], []), []), []);
});

test('a decision that hides a matching group behind "national capacity" is rejected and redone', async () => {
  let n = 0;
  const base = scripted(() => goodTriage('full_file'));
  const llm = fakeLlm((req) =>
    (req.messages[0]?.content ?? '').includes('you take the decision') && n++ === 0
      ? goodDecision({ stands_with: ['national capacity'] })
      : base(req),
  );
  const s = services(llm);
  addMeeting(s.db, 'sc/410');
  await runOnce(s, { trigger: 'manual', maxMinutes: 5, maxCalls: 200, ingest: false });
  assert.equal(status(s.db, 'sc/410').status, 'adopted');
  const errors = s.db.prepare(`SELECT error FROM llm_calls WHERE task = 'decision' AND error_kind = 'check'`).all() as {
    error: string;
  }[];
  assert.equal(errors.length, 1);
  assert.match(errors[0]?.error ?? '', /Union of Lakeland States defended the same position/);
  const input = llm.requests.find((q) => (q.messages[0]?.content ?? '').includes('you take the decision'));
  assert.match(input?.messages[1]?.content ?? '', /"groups_in_meeting":\[\{"group":"Union of Lakeland States"/);
  const dossier = s.db.prepare('SELECT stands_with FROM dossiers').get() as { stands_with: string };
  assert.deepEqual(JSON.parse(dossier.stands_with), ['Union of Lakeland States']);
});

test('re-deciding a file redoes only decisions, red lines and press, and replaces its dossier entry', async () => {
  let redecided = false;
  const base = scripted(() => goodTriage('full_file'));
  const llm = fakeLlm((req) =>
    redecided && (req.messages[0]?.content ?? '').includes('you take the decision')
      ? goodDecision({
          option: 'B',
          vote: 'abstain',
          stands_with: ['national capacity'],
          group_positions: [{ group: 'Union of Lakeland States', cite: 'E2', position: 'Access.', same: false }],
          closest_to: 'Union of Lakeland States',
          differs_on: { text: 'The ULS votes for the text.', cite: 'E2' },
        })
      : base(req),
  );
  const s = services(llm);
  addMeeting(s.db, 'sc/411');
  const opts = { trigger: 'manual' as const, maxMinutes: 5, maxCalls: 200, ingest: false };
  await runOnce(s, opts);
  assert.equal(status(s.db, 'sc/411').status, 'adopted');
  const before = llm.requests.length;
  redecideFile(s.db, 'sc/411', 'stands_with rule');
  redecided = true;
  await runOnce(s, opts);
  assert.equal(status(s.db, 'sc/411').status, 'adopted');
  const redone = llm.requests.slice(before).map((q) => (q.messages[0]?.content ?? '').slice(0, 60));
  assert.equal(redone.length, 2 + 4 + 1 + 2 + 1); // two decisions, four red lines, press, pack (no valid pack for B: two tries), cable
  assert.ok(redone.every((x) => !/meeting report|options memo|desk adds|check one claim/.test(x)));
  const events = s.db.prepare('SELECT change, stands_with FROM dossier_events').all() as Record<string, string>[];
  assert.deepEqual(
    events.map((e) => [e.change, JSON.parse(e.stands_with ?? '[]')]),
    [['first', ['national capacity']]],
  );
  const dossier = s.db.prepare('SELECT stands_with FROM dossiers').get() as { stands_with: string };
  assert.deepEqual(JSON.parse(dossier.stands_with), ['national capacity']);
  assert.throws(() => redecideFile(s.db, 'sc/999', 'unknown'), /No file/);
});

test('re-deciding drops a low-confidence mark that only the old decision carried', async () => {
  let n = 0;
  const base = scripted(() => goodTriage('full_file'));
  // Decision A fails twice on the writer, so the fallback writes it: the file is low confidence.
  const llm = fakeLlm((req) =>
    (req.messages[0]?.content ?? '').includes('you take the decision') && n++ < 2
      ? goodDecision({ stands_with: ['national capacity'] })
      : base(req),
  );
  const s = services(llm);
  addMeeting(s.db, 'sc/412');
  const opts = { trigger: 'manual' as const, maxMinutes: 5, maxCalls: 200, ingest: false };
  await runOnce(s, opts);
  // Decision A by the fallback: its red lines went to the second checker and passed, so the file is not marked
  // (2026-11-23); the stored decision keeps its line.
  assert.equal(status(s.db, 'sc/412').low_confidence, 0);
  const a = s.db
    .prepare(`SELECT low_confidence FROM documents WHERE kind = 'decision' AND ref = 'A' ORDER BY attempt DESC LIMIT 1`)
    .get() as { low_confidence: number };
  assert.equal(a.low_confidence, 1);
  // Decision reasoning (2026-11-19): normal on the writer, effort "low" on the fallback.
  const decisions = llm.requests.filter((q) => (q.messages[0]?.content ?? '').includes('you take the decision'));
  assert.ok(decisions.some((q) => q.model === 'f')); // the test environment's fallback model
  for (const q of decisions) assert.equal(q.reasoning, q.model === 'f' ? 'low' : true);
  redecideFile(s.db, 'sc/412', 'test');
  assert.equal(status(s.db, 'sc/412').low_confidence, 0);
  await runOnce(s, opts);
  assert.equal(status(s.db, 'sc/412').status, 'adopted');
  assert.equal(status(s.db, 'sc/412').low_confidence, 0);
});
