// 2026-11-12: decision point already taken,
// three-state alignment and voted_with, report structure, press, language,
// the legal opinion without the draft text, and reworking a file from triage.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDecision } from '../engine/check/decision.ts';
import { checkStandsWith, checkVotedWith, groupsInMeeting, memoGroupsSpoke } from '../engine/check/groups.ts';
import { checkLanguage, checkPress, DRAFTS_NOT_READ, onceDraftsNotRead } from '../engine/check/language.ts';
import { checkTiming, checkTimingCite, staleProposals, type DecisionTiming } from '../engine/check/timing.ts';
import { loadTeam } from '../engine/profile/index.ts';
import { runOnce } from '../engine/run/run.ts';
import { checkReport, parseReport, renderReport } from '../engine/work/report-doc.ts';
import { redecideFile, reworkFile } from '../engine/work/reopen.ts';
import { applyTriageRules, TriageOutputError, type TriageFacts } from '../engine/work/triage-rules.ts';
import {
  addMeeting,
  fakeLlm,
  goodDecision,
  goodMemo,
  goodReport,
  goodTriage,
  scripted,
  SEGMENT_TEXT,
  services,
  status,
} from './support/world.ts';
import { TEST_PROFILE } from './support/invented.ts';

const profile = TEST_PROFILE;
const team = loadTeam();
const segments = SEGMENT_TEXT.map((text, i) => ({
  label: 'E' + (i + 1),
  start: i * 60,
  end: i * 60 + 59,
  text,
  speakers: [
    { start: i * 60, end: i * 60 + 59, label: i === 0 ? 'Arvenia' : 'Belmora' },
    ...(i === 1 ? [{ start: 80, end: 90, label: 'Union of Lakeland States' }] : []),
  ],
}));
const facts: TriageFacts = {
  body: 'ga_c1',
  durationSeconds: 3600,
  speakers: 12,
  dossierIds: [],
  duplicateCandidates: [],
  identicalTranscriptOf: null,
  segments,
};
const taken: DecisionTiming = {
  status: 'already_taken',
  cite: 'E2',
  next_step: 'the vote in the General Assembly plenary',
  next_forum: 'plenary',
};
const sys = (r: { messages: { content: string }[] }) => r.messages[0]?.content ?? '';
const opts = { trigger: 'manual' as const, maxMinutes: 5, maxCalls: 300, ingest: false };

test('triage: decision_status is pending or already_taken, cited to the segment that shows it', () => {
  const t = (ds: unknown) => applyTriageRules(goodTriage('full_file', { decision_status: ds }), facts, profile, team);
  assert.deepEqual(t(taken).decisionStatus, taken);
  assert.equal(t({ status: 'pending', cite: 'E1' }).decisionStatus?.status, 'pending');
  assert.throws(() => t({ status: 'maybe', cite: 'E1' }), TriageOutputError);
  // E1 records no adoption or vote; E9 does not exist; already_taken needs the next step.
  assert.throws(() => t({ ...taken, cite: 'E1' }), /E1 does not record an adoption or a vote/);
  assert.throws(() => t({ ...taken, cite: 'E9' }), /not a segment of this meeting/);
  assert.throws(() => t({ ...taken, next_step: null }), /needs next_step/);
  // Notes and reports carry none.
  assert.equal(applyTriageRules(goodTriage('report'), facts, profile, team).decisionStatus, null);
  assert.deepEqual(checkTimingCite({ status: 'pending', cite: 'E1', next_step: null, next_forum: null }, segments), []);
  // Internal codes in the triage's visible text are rejected.
  assert.throws(
    () => applyTriageRules(goodTriage('full_file', { reason: 'Engages I6 and R2.' }), facts, profile, team),
    /internal codes \(I6, R2\)/,
  );
});

test('check 10: on a point already taken, nothing is proposed again at the stage already held', () => {
  // An option that seeks paragraph votes already held.
  assert.equal(staleProposals('Seek paragraph votes on L/34, then vote in favour.', 'plenary').length, 1);
  assert.deepEqual(staleProposals('Vote in favour of L/34 in the General Assembly plenary.', 'plenary'), []);
  assert.deepEqual(staleProposals('The State would have cast a vote for L/34.', 'plenary'), []);
  assert.deepEqual(staleProposals('Keep the file under review.', 'plenary'), []);
  // "The sponsors' dispute" is not an action.
  assert.deepEqual(
    staleProposals("The State takes no side in the sponsors' dispute, only on the rule.", 'plenary'),
    [],
  );
  assert.equal(staleProposals('Co-sponsor the draft.', 'plenary').length, 1);
  const memo = [
    { label: 'option A', text: 'Vote in favour of L/34 at the plenary.' },
    { label: 'option C', text: 'Seek paragraph votes on L/34.' },
  ];
  const f = checkTiming(taken, 'memo', memo, null);
  assert.match(f.join(' '), /option C proposes action on a point already taken \(E2\)/);
  assert.match(f.join(' '), /would have voted/);
  assert.equal(f.length, 2);
  // A future decision on the taken point is rejected; the same decision toward the plenary passes.
  const d = (position: string, would: string | null) =>
    checkTiming(taken, 'decision', [{ label: 'the position', text: position }], would);
  assert.equal(d('Vote for L/34.', 'The State would have backed the text then.').length, 1);
  assert.deepEqual(d('Vote for L/34 when the plenary meets.', 'The State would have backed the text then.'), []);
  assert.match(d('Vote for L/34 when the plenary meets.', 'In favour.').join(), /what the State would have done/);
  // A pending point is not affected.
  assert.deepEqual(checkTiming({ ...taken, status: 'pending' }, 'decision', [{ label: 'x', text: 'Vote.' }], null), []);
});

test('alignment: not addressing the point is not a different position; closest_to only among those who did', () => {
  const evidence = groupsInMeeting(segments, profile);
  assert.deepEqual(
    evidence.map((e) => e.group),
    ['Union of Lakeland States'],
  );
  const silent = [
    { group: 'Union of Lakeland States', cite: 'E2', position: 'Spoke on other drafts.', stance: 'not_addressed' },
  ];
  const nc = (extra: Record<string, unknown> = {}) =>
    checkStandsWith(
      parseDecision(goodDecision({ stands_with: ['national capacity'], group_positions: silent, ...extra })),
      evidence,
    );
  assert.deepEqual(nc(), []);
  // "Closest to" a group that did not speak to the point is rejected.
  assert.match(
    nc({ closest_to: 'Union of Lakeland States', differs_on: { text: 'It spoke on other drafts.', cite: 'E2' } }).join(
      ' ',
    ),
    /no group that spoke addressed this item/,
  );
  // A group that addressed it differently is the closest one.
  const different = [{ ...silent[0], stance: 'different' }];
  const withDifferent = (extra: Record<string, unknown>) =>
    checkStandsWith(
      parseDecision(goodDecision({ stands_with: ['national capacity'], group_positions: different, ...extra })),
      evidence,
    );
  assert.match(withDifferent({}).join(' '), /closest_to: name the group that addressed the point/);
  assert.deepEqual(
    withDifferent({
      closest_to: 'Union of Lakeland States',
      differs_on: { text: 'It asks for conditions.', cite: 'E2' },
    }),
    [],
  );
  // Earlier decisions with same: true / false still read as same / different.
  assert.equal(parseDecision(goodDecision()).group_positions[0]?.stance, 'same');
});

test('voted_with: States that voted the same way, from the report, each with its segment', () => {
  const positions = goodReport().positions;
  const v = (voted_with: unknown[]) => checkVotedWith(parseDecision(goodDecision({ voted_with })), positions, segments);
  assert.deepEqual(v([{ state: 'Arvenia', cite: 'E1' }]), []);
  assert.match(v([{ state: 'Arvenia', cite: 'E2' }]).join(), /not a position in the meeting report/);
  assert.match(v([{ state: 'Corvalia', cite: 'E1' }]).join(), /Corvalia \[E1\] is not a position/);
  assert.throws(() => parseDecision(goodDecision({ voted_with: [{ state: 'Arvenia' }] })), /voted_with needs/);
});

test('report: key points for the Mission, sections by kind of meeting, no officers, positions by draft', () => {
  const ctx = { body: 'ga_c1' as const, decisionPoint: 'Action on draft L.5' };
  const run = (extra: Record<string, unknown>) =>
    checkReport(parseReport({ ...goodReport(), ...extra }), segments as never, '', ctx).failures.map((f) => f.detail);
  assert.deepEqual(run({}), []);
  assert.match(
    run({ briefers: [{ speaker: 'Arvenia', text: 'Briefed.', cites: ['E1'] }] }).join(),
    /only in the Security/,
  );
  assert.match(
    run({ positions: [{ delegation: 'GA · President', text: 'Put the draft.', cites: ['E1'] }] }).join(),
    /presides or serves the meeting/,
  );
  // In the Council, a Secretariat official who briefs is a briefer; the Secretary serving the meeting is not.
  const council = (speaker: string) =>
    checkReport(
      parseReport({ ...goodReport(), briefers: [{ speaker, text: 'Briefed.', cites: ['E1'] }] }),
      segments as never,
      '',
      { body: 'security_council', decisionPoint: null },
    ).failures.map((f) => f.detail);
  assert.doesNotMatch(council('UN Secretariat · ASG, Coastal Affairs and Field Support').join(), /presides or serves/);
  assert.match(council('UN Secretariat · Secretary').join(), /presides or serves/);
  assert.match(council('Security Council · President').join(), /presides or serves/);
  assert.match(run({ key_points: [] }).join(), /1 key points; give 3 to 5/);
  assert.match(run({ decision_outcome: null }).join(), /outcome of the texts of the decision point/);
  // "Not recorded in this transcript" needs no segment; any other outcome does.
  assert.deepEqual(run({ decision_outcome: { text: 'The vote on L.5 is not recorded in this transcript.' } }), []);
  assert.match(run({ decision_outcome: { text: 'L.5 passed.' } }).join(), /cite the segment/);
  assert.match(run({ issues: [{ text: 'It engages I6.', cites: ['E1'] }] }).join(), /internal codes/);
  // Rendering: key points first; in a committee, explanations of vote grouped by draft; no briefers.
  const r = parseReport({
    ...goodReport(),
    positions: [
      { draft: 'L.5', delegation: 'Arvenia', text: 'Voted in favour.', cites: ['E1'] },
      { draft: null, delegation: 'Belmora', text: 'General remarks.', cites: ['E2'] },
    ],
  });
  const text = renderReport(r, null, 'ga_c1');
  assert.match(text, /^# .*\n\n## Key points for the Mission\n- Arvenia supports/);
  assert.match(
    text,
    /## Explanations of vote\n\n### L\.5\n- \*\*Arvenia\*\*.*\n\n### General statements\n- \*\*Belmora\*\*/,
  );
  assert.doesNotMatch(text, /Briefers/);
  assert.match(renderReport({ ...r, meeting_type: 'debate' }, null, 'security_council'), /## Positions\n/);
});

test('language and press: no codes, no machinery, no speculation on unseen drafts; publishable press', () => {
  assert.match(checkLanguage('This serves I2 and I6.', 'the memo').join(), /internal codes \(I2, I6\)/);
  assert.match(checkLanguage("The Union's supplied segments address other drafts.", 'x').join(), /machinery/);
  assert.match(checkLanguage('Any operative language implying binding constraints.', 'x').join(), /speculates/);
  assert.deepEqual(checkLanguage('Operative paragraph 7 was deleted, Belmora said.', 'x'), []);
  assert.deepEqual(checkLanguage('Open trade and safe routes are at stake.', 'x'), []);
  assert.match(
    checkPress('The Permanent Representative has decided that we vote yes.', 'statement').join(),
    /internal/,
  );
  assert.match(checkPress('The State votes yes.', 'explanation of vote').join(), /first person/);
  assert.deepEqual(
    checkPress('My delegation voted in favour because rules for new technologies matter.', 'statement'),
    [],
  );
  assert.deepEqual(checkPress('The Permanent Mission welcomes the adoption of the text.', 'press note'), []);
});

test('a point already taken: memo and decision redone toward the next step; legal opinion says the text was not read', async () => {
  let memoCalls = 0;
  let decisionCalls = 0;
  const base = scripted(() => goodTriage('full_file', { decision_status: taken, press: { flag: false } }));
  const llm = fakeLlm((req) => {
    const s = sys(req);
    if (s.includes('the one thing your desk adds'))
      return { opinion: DRAFTS_NOT_READ + ' Access must be unhindered.', objection: false, interests: ['I3'] };
    if (s.includes('Write the options memo')) {
      memoCalls++;
      const m = goodMemo();
      if (memoCalls === 1)
        return { ...m, options: [...m.options, { ...m.options[1], id: 'C', action: 'Seek paragraph votes.' }] };
      return {
        ...m,
        options: m.options.map((o) => ({ ...o, action: o.action.replace('.', ' when the plenary meets.') })),
        would_have_voted: 'Had it voted, the State would have backed the text, for the sake of access.',
      };
    }
    if (s.includes('you take the decision on this file')) {
      decisionCalls++;
      return goodDecision({
        press: 'none',
        ...(decisionCalls <= 2
          ? {}
          : {
              position: 'When the General Assembly plenary takes up the draft, the State casts its vote for it.',
              would_have_voted: 'Had it voted in the Committee, the State would have backed the text.',
            }),
      });
    }
    return base(req);
  });
  const s = services(llm);
  addMeeting(s.db, 'sc/430');
  await runOnce(s, opts);
  assert.equal(status(s.db, 'sc/430').status, 'adopted');
  assert.equal(memoCalls, 2);
  assert.equal(decisionCalls, 4); // the first two attempts vote again at the stage already held: rejected
  const rejected = s.db
    .prepare(`SELECT error FROM llm_calls WHERE task IN ('memo','decision') AND error_kind = 'check'`)
    .all() as { error: string }[];
  assert.equal(rejected.length, 3);
  assert.ok(rejected.every((r) => /timing: .* proposes action on a point already taken \(E2\)/.test(r.error)));
  const legal = s.db.prepare(`SELECT text FROM documents WHERE kind = 'opinion' AND ref = 'legal'`).get() as {
    text: string;
  };
  assert.ok(legal.text.startsWith(DRAFTS_NOT_READ + '\n\n'));
  assert.equal(legal.text.split(DRAFTS_NOT_READ).length, 2); // once, even if the model writes it too
  // No press: the decision asks for none and the triage does not mark the file high profile.
  assert.equal(s.db.prepare(`SELECT COUNT(*) AS n FROM documents WHERE kind = 'press'`).get()?.n, 0);
});

test('reworking a decided file from triage reuses its segment summaries and replaces its dossier entry', async () => {
  const llm = fakeLlm(scripted(() => goodTriage('full_file')));
  const s = services(llm);
  addMeeting(s.db, 'sc/431');
  await runOnce(s, opts);
  assert.equal(status(s.db, 'sc/431').status, 'adopted');
  const before = llm.requests.length;
  reworkFile(s.db, 'sc/431', 'owner review');
  assert.equal(status(s.db, 'sc/431').status, 'queued');
  await runOnce(s, opts);
  assert.equal(status(s.db, 'sc/431').status, 'adopted');
  const redone = llm.requests.slice(before).map(sys);
  assert.equal(redone.filter((x) => x.includes('Summarise one segment')).length, 0);
  assert.equal(redone.filter((x) => x.includes('You triage every completed meeting')).length, 1);
  assert.equal(redone.filter((x) => x.includes('Write the meeting report')).length, 1);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM dossier_events').get()?.n, 1);
  assert.throws(() => reworkFile(s.db, 'sc/999', 'x'), /No file/);
});

test('closest_to stays empty when every group that addressed the point opposes the State', () => {
  const evidence = groupsInMeeting(segments, profile);
  const opposed = [
    {
      group: 'Union of Lakeland States',
      cite: 'E2',
      position: 'Rejects the forum.',
      stance: 'different',
      opposes: true,
    },
  ];
  const d = (extra: Record<string, unknown> = {}) =>
    checkStandsWith(
      parseDecision(goodDecision({ stands_with: ['national capacity'], group_positions: opposed, ...extra })),
      evidence,
    );
  assert.deepEqual(d(), []);
  // The only group that spoke opposed the State: no group is the closest.
  assert.match(
    d({ closest_to: 'Union of Lakeland States', differs_on: { text: 'It rejects the forum.', cite: 'E2' } }).join(),
    /without opposing the State; leave closest_to and differs_on null/,
  );
  assert.equal(parseDecision(goodDecision({ group_positions: opposed })).group_positions[0]?.opposes, true);
});

test('memo: an option may stand only with a group that took the floor in the meeting', () => {
  const memo = {
    options: [
      { id: 'A', stands_with: ['national capacity'] },
      { id: 'B', stands_with: ['Meridian Group'] },
    ],
  };
  assert.deepEqual(memoGroupsSpoke(memo, ['Union of Lakeland States']).length, 1);
  assert.match(
    memoGroupsSpoke(memo, ['Union of Lakeland States'])[0] ?? '',
    /option B stands with Meridian Group, which did not take the floor/,
  );
  assert.deepEqual(memoGroupsSpoke(memo, ['Meridian Group']), []);
});

test('the legal lead line appears once, at save and on display', () => {
  const twice = `${DRAFTS_NOT_READ}\n\n${DRAFTS_NOT_READ} The texts go to the plenary.`;
  assert.equal(onceDraftsNotRead(twice), `${DRAFTS_NOT_READ}\n\nThe texts go to the plenary.`);
  assert.equal(onceDraftsNotRead('No lead line.'), 'No lead line.');
});

test('a point already taken gets press only when the triage marks the file high profile', async () => {
  for (const flag of [false, true]) {
    const llm = fakeLlm((req) => {
      const s = sys(req);
      if (s.includes('Write the options memo'))
        return {
          ...goodMemo(),
          options: goodMemo().options.map((o) => ({ ...o, action: o.action.replace('.', ' when the plenary meets.') })),
          would_have_voted: 'Had it voted, the State would have backed the text.',
        };
      if (s.includes('you take the decision on this file'))
        return goodDecision({
          position: 'The State casts its vote for the draft once it reaches the General Assembly plenary.',
          would_have_voted: 'Had it voted, the State would have backed the text.',
          press: 'statement',
        });
      return scripted(() => goodTriage('full_file', { decision_status: taken, press: { flag, reason: 'x' } }))(req);
    });
    const s = services(llm);
    addMeeting(s.db, 'sc/440');
    await runOnce(s, opts);
    assert.equal(status(s.db, 'sc/440').status, 'adopted');
    assert.equal(s.db.prepare(`SELECT COUNT(*) AS n FROM documents WHERE kind = 'press'`).get()?.n, flag ? 2 : 0); // statement and press pack
  }
});

test('redoing a file from its memo redoes memo, decisions, red lines and press only', async () => {
  const llm = fakeLlm(scripted(() => goodTriage('full_file')));
  const s = services(llm);
  addMeeting(s.db, 'sc/441');
  await runOnce(s, opts);
  const before = llm.requests.length;
  redecideFile(s.db, 'sc/441', 'memo rules', true);
  await runOnce(s, opts);
  assert.equal(status(s.db, 'sc/441').status, 'adopted');
  const redone = llm.requests.slice(before).map(sys);
  assert.equal(redone.length, 1 + 2 + 4 + 2 + 1); // memo, two decisions, four red lines, press and pack, cable
  assert.equal(redone.filter((x) => x.includes('Write the options memo')).length, 1);
  assert.ok(redone.every((x) => !/Write the meeting report|desk adds|check one claim|You triage/.test(x)));
});
