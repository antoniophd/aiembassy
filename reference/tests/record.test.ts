// 2026-11-13: tallies, group statements and named delegations
// kept in the report; each desk in its field; memo votes; voted_with by text;
// what reopens a file; the express citation of a point already taken.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkMemo, checkReopens, parseDecision, parseMemo, votedWithText } from '../engine/check/decision.ts';
import { checkDesk, OPINION_OVERLAP, overlap } from '../engine/check/language.ts';
import {
  groupStatements,
  missingGroupStatements,
  missingTallies,
  namedWithoutEntry,
  transcriptTallies,
} from '../engine/check/record.ts';
import { checkTimingCite } from '../engine/check/timing.ts';
import { loadTeam } from '../engine/profile/index.ts';
import { checkReport, parseReport, renderReport } from '../engine/work/report-doc.ts';
import { applyTriageRules } from '../engine/work/triage-rules.ts';
import { TEST_PROFILE } from './support/invented.ts';
import { goodDecision, goodMemo, goodReport, goodTriage } from './support/world.ts';

const profile = TEST_PROFILE;
const team = loadTeam();
const seg = (label: string, lines: string[], speakers: { label: string; start: number; end: number }[]) => ({
  label,
  text: lines.join('\n'),
  speakers,
});
// Invented lines in the shape of a First Committee transcript.
const segments = [
  seg(
    'E1',
    [
      '[10s] Delegations may now explain their positions on cluster 5 after the voting.',
      '[422s] Arvenia voted in favour of draft L/34 on rules for autonomous sea drones.',
    ],
    [
      { label: '1st Committee · Chair', start: 0, end: 20 },
      { label: 'Arvenia', start: 400, end: 500 },
    ],
  ),
  seg(
    'E5',
    ['[2885s] I speak today, briefly, on behalf of the Coastal Group and its nine members.'],
    [{ label: 'Belmora', start: 2880, end: 2900 }],
  ),
  seg(
    'E7',
    [
      '[4080s] Those in favour of keeping preambular paragraph 4, please raise your cards; against; abstaining.',
      '[4120s] The voting result: 151 in favour, 2 against, and 4 abstentions.',
      '[4210s] Those in favour of draft resolution number A/C.1/99/L.6, as orally revised, kindly signify; then against; then abstentions.',
      '[4258s] The result of the voting is: 172 in favour, 3 against and 0 abstentions.',
      '[4265s] Draft resolution L.6 is adopted.',
    ],
    [{ label: '1st Committee · Chair', start: 4000, end: 4300 }],
  ),
  seg(
    'E10',
    [
      '[6144s] I have the honour to explain our vote on draft decision L66, on the work of the Sea Drone Panel, on behalf of Corvalia, Dravonia, Vell and Morra, Ferrania, Galdovia, and Halvoria.',
    ],
    [{ label: 'Halvoria', start: 6140, end: 6200 }],
  ),
  seg(
    'E13',
    [
      '[8210s] We proceed to action on draft resolution L-66 and related texts. Those in favour of the draft resolutions as a group, please signify; those against; abstentions.',
      '[8267s] Voting result: 128 in favour, 6 against and 31 abstentions.',
      '[8276s] Accordingly, draft resolution L/66 is adopted.',
      '[8300s] Istrena abstained on L-66.',
    ],
    [
      { label: '1st Committee · Chair', start: 8200, end: 8280 },
      { label: 'Istrena', start: 8290, end: 8310 },
    ],
  ),
];

test('tallies: every draft voted as a whole, paragraph votes left out, symbol taken from the adoption', () => {
  assert.deepEqual(
    transcriptTallies(segments as never).map((t) => [t.draft, t.in_favour, t.segment]),
    [
      ['6', 172, 'E7'],
      ['66', 128, 'E13'],
    ],
  );
  const missing = missingTallies(transcriptTallies(segments as never), [{ draft: 'L.6', in_favour: 172 }]);
  assert.deepEqual(
    missing.map((t) => t.draft),
    ['66'],
  );
});

test('group statements: kept, with the number of States counted from the transcript', () => {
  const g = groupStatements(segments as never);
  assert.deepEqual(
    g.map((x) => [x.speaker, x.segment, x.states]),
    [
      ['Belmora', 'E5', null],
      ['Halvoria', 'E10', 6],
    ],
  );
  assert.deepEqual(
    missingGroupStatements(g, [{ delegation: 'Belmora', cites: ['E5'] }]).map((x) => x.speaker),
    ['Halvoria'],
  );
});

test('report: tallies and group statements must be there; a named delegation speaks where cited', () => {
  const ctx = { body: 'ga_c1' as const, decisionPoint: null, segments: segments as never };
  const base = {
    ...goodReport(),
    key_points: [1, 2, 3].map(() => ({ text: 'Arvenia spoke.', cites: ['E1'] })),
    decision_outcome: null,
    issues: [{ text: 'Cluster 5.', cites: ['E1'] }],
    positions: [{ draft: 'L/34', delegation: 'Arvenia', text: 'Voted in favour.', cites: ['E1'] }],
    outcome: { text: 'L.6 and L/66 were adopted.', cites: ['E7', 'E13'] },
    claims: [{ claim: 'Arvenia voted in favour of L/34.', cite: 'E1' }],
  };
  const fails = (extra: Record<string, unknown>) =>
    checkReport(parseReport({ ...base, ...extra }), segments as never, '', ctx).failures.map((f) => f.detail);
  const all = fails({});
  assert.ok(all.some((x) => /tally of L\.6 \(172 in favour, E7\)/.test(x)));
  assert.ok(all.some((x) => /tally of L\.66 \(128 in favour, E13\)/.test(x)));
  assert.ok(all.some((x) => /Belmora spoke on behalf of the Coastal Group/.test(x)));
  const complete = {
    votes: [
      { draft: 'L.6', result: 'adopted', in_favour: 172, against: 3, abstentions: 0, cites: ['E7'] },
      { draft: 'L/66', result: 'adopted', in_favour: 128, against: 6, abstentions: 31, cites: ['E13'] },
    ],
    group_statements: [
      { delegation: 'Belmora', on_behalf_of: 'the Coastal Group', text: 'Spoke.', cites: ['E5'] },
      { delegation: 'Halvoria', on_behalf_of: 'a group of States', draft: 'L/66', text: 'Abstained.', cites: ['E10'] },
    ],
  };
  assert.deepEqual(fails(complete), []);
  // A delegation named in disagreement: no entry of its own needed, but it must speak in the cited segment (2026-11-16).
  assert.deepEqual(fails({ ...complete, disagreement: [{ text: 'Istrena abstained on L-66.', cites: ['E13'] }] }), []);
  // Cited where it does not speak: repaired by code before the check (2026-11-19), never rejected.
  // (Only the figure of the line still fails here, as it should: "66" is not in E7.)
  assert.deepEqual(fails({ ...complete, disagreement: [{ text: 'Istrena abstained on L-66.', cites: ['E7'] }] }), [
    '"66" not in E7; it appears in E10, E13',
  ]);
  const r = parseReport({ ...base, ...complete });
  r.group_statements[1]!.states = 5;
  const text = renderReport(r, null, 'ga_c1');
  assert.match(text, /## Statements on behalf of groups\n- \*\*Belmora\*\*, on behalf of the Coastal Group: Spoke\./);
  assert.match(text, /\*\*Halvoria\*\*, on behalf of a group of States \(5 States\) on L\/66/);
  assert.match(text, /## Outcome\n.*\n- L\.6: adopted, 172 in favour, 3 against, 0 abstentions \[E7\]/);
  assert.deepEqual(namedWithoutEntry('Arvenia and Istrena agreed.', segments as never, [r.positions[0]!]), ['istrena']);
});

test('opinions: the legal desk keeps to law; two opinions may not cover the same ground', () => {
  assert.match(checkDesk('Supply chains and digital trade depend on it.', 'legal').join(), /economic argument/);
  assert.deepEqual(checkDesk('The Assembly may recommend; the text is not binding.', 'legal'), []);
  assert.deepEqual(checkDesk('Trade matters here.', 'economic'), []);
  const legal = 'The Assembly is competent to recommend rules on autonomous sea drones; the text binds no one.';
  assert.ok(overlap(legal, legal) > OPINION_OVERLAP);
  assert.ok(overlap('Programme budget implications are modest and financed.', legal) < OPINION_OVERLAP);
  // The economic desk only on economic, environmental or budgetary matters.
  const facts = {
    body: 'ga_c1' as const,
    durationSeconds: 3600,
    speakers: 12,
    dossierIds: [],
    duplicateCandidates: [],
    identicalTranscriptOf: null,
  };
  const t = (o: Record<string, unknown>) => applyTriageRules(goodTriage('full_file', o), facts, profile, team);
  assert.deepEqual(t({ opinions: ['legal', 'economic'] }).opinions, ['legal']);
  assert.match(t({ opinions: ['legal', 'economic'] }).adjustments.join(), /economic opinion dropped/);
  assert.deepEqual(t({ opinions: ['economic'], engaged: { interests: ['I5'], red_lines: [] } }).opinions, ['economic']);
});

test('memo: each option says how the State votes, and apart from that whether it takes the floor', () => {
  const m = goodMemo();
  assert.throws(
    () => parseMemo({ ...m, options: m.options.map((o) => ({ ...o, vote: 'stay silent' })) }),
    /says what the State votes.*silence is not a vote/,
  );
  const memo = parseMemo(m);
  assert.deepEqual(
    memo.options.map((o) => [o.vote, o.takes_floor]),
    [
      ['in favour', true],
      ['abstain', true],
    ],
  );
  assert.deepEqual(checkMemo(memo, 100, profile), []);
});

test('decision: the vote of the option chosen; voted_with by text with partial abstentions; reopens_if', () => {
  const d = parseDecision(
    goodDecision({
      voted_with: [
        {
          text: 'L/34',
          states: [
            { state: 'Arvenia', cite: 'E1' },
            { state: 'Jandora', cite: 'E4', note: 'abstained on PP2 and OP1' },
          ],
        },
        { text: 'L/8', states: [{ state: 'Kestavia', cite: 'E2' }] },
      ],
    }),
  );
  assert.equal(votedWithText(d), 'L/34: Arvenia [E1], Jandora [E4] (abstained on PP2 and OP1); L/8: Kestavia [E2]');
  // Earlier decisions: one flat list.
  assert.equal(
    votedWithText(parseDecision(goodDecision({ voted_with: [{ state: 'Lumeria', cite: 'E1' }] }))),
    'Lumeria [E1]',
  );
  assert.match(checkReopens('The State would revisit its support.').join(), /not what the State would do/);
  assert.match(checkReopens('Things change.').join(), /an event the body can produce/);
  assert.deepEqual(checkReopens('The plenary amends the draft or defers the vote.'), []);
});

test('triage: already_taken cites the segment that says so expressly, not the adoption of other texts', () => {
  const t = { status: 'already_taken' as const, cite: 'E7', next_step: 'the plenary', next_forum: 'plenary' as const };
  const point = 'Cluster 5 drafts, including L/34 on rules for autonomous sea drones';
  assert.match(checkTimingCite(t, segments as never, point).join(), /E7 records other texts/);
  assert.deepEqual(checkTimingCite({ ...t, cite: 'E1' }, segments as never, point), []);
  // Without symbols in the decision point, any recorded action counts.
  assert.deepEqual(checkTimingCite(t, segments as never, 'The vote on the texts'), []);
});

test('cable: names, figures and symbols from the report; keeps the decision; prose; 450–1,500 words', async () => {
  const { checkCable, parseCable, renderCable } = await import('../engine/check/cable.ts');
  const { goodCable } = await import('./support/world.ts');
  const report = 'Arvenia and Belmora spoke. L.5 was adopted by 13 votes.';
  const ctx = (decision: { option: string; stands_with: string[] } | null) => ({
    reportText: report,
    segments: [
      {
        label: 'E1',
        text: '',
        speakers: [
          { label: 'Arvenia', start: 0, end: 1 },
          { label: 'Corvalia', start: 2, end: 3 },
        ],
      },
    ],
    decision,
  });
  const good = parseCable(goodCable(true));
  assert.deepEqual(checkCable(good, ctx({ option: 'A', stands_with: ['Union of Lakeland States'] })), []);
  assert.match(checkCable(good, ctx({ option: 'B', stands_with: ['national capacity'] })).join(), /keep the decision/);
  const bad = parseCable({
    ...goodCable(false),
    summary: goodCable(false).summary + ' Corvalia cited 42 States, L.9 and [E2]; deepseek wrote it.',
  });
  const f = checkCable(bad, ctx(null)).join(' | ');
  assert.match(f, /figures not in the report \(42\)/);
  assert.match(f, /document symbols not in the report \(L9\)/);
  assert.match(f, /delegations not in the report \(Corvalia\)/);
  assert.match(f, /no segment marks/);
  assert.match(f, /"deepseek" names the machinery/);
  assert.match(
    checkCable(
      parseCable({
        ...goodCable(false),
        paragraphs: [{ title: 'Short', text: 'Too short.' }],
        summary: 'x',
        assessment: ['y'],
      }),
      ctx(null),
    ).join(),
    /a cable has 450 to 1,500 words/,
  );
  const text = renderCable(good, '2026-11-02');
  assert.match(text, /^FROM: Permanent Mission, New York\nTO: Capital\nDATE: 2 November 2026\nSUBJECT: /);
  assert.match(text, /## 1\. Summary[\s\S]*## 2\. Access[\s\S]*## 5\. Assessment/);
});

test('triage: a cable on every full file, on reports only when marked, never on notes', () => {
  const facts = {
    body: 'ga_c1' as const,
    durationSeconds: 3600,
    speakers: 12,
    dossierIds: [],
    duplicateCandidates: [],
    identicalTranscriptOf: null,
  };
  const t = (level: string, extra: Record<string, unknown> = {}) =>
    applyTriageRules(goodTriage(level, extra), facts, profile, team);
  assert.equal(t('full_file').cable, true);
  assert.equal(t('report').cable, false);
  assert.equal(t('report', { cable: { flag: true, reason: 'A vote on a text the State follows.' } }).cable, true);
  assert.equal(t('note', { cable: { flag: true, reason: 'x' } }).cable, false);
  assert.equal(t('report', { procedural: true, cable: { flag: true, reason: 'x' } }).cable, false);
});

test('an interest written in words in the triage maps to its id; a rejected fallback document leaves no mark', async () => {
  const facts = {
    body: 'ga_c1' as const,
    durationSeconds: 3600,
    speakers: 12,
    dossierIds: [],
    duplicateCandidates: [],
    identicalTranscriptOf: null,
  };
  const t = applyTriageRules(
    goodTriage('full_file', {
      engaged: { interests: ['Common rules for new technologies (drones, data).'], red_lines: [] },
    }),
    facts,
    profile,
    team,
  );
  assert.equal(t.level, 'full_file');
  assert.deepEqual(t.engaged.interests, ['I6']);
});

test('officers: the chair of the meeting is excluded; a delegation that chairs another body is not', async () => {
  const { OFFICERS } = await import('../engine/check/groups.ts');
  for (const l of [
    '1st Committee · Chair',
    'GA · President',
    '4th Committee · Secretary',
    'Security Council · President',
  ])
    assert.ok(OFFICERS.test(l), l);
  for (const l of [
    'Jandora · Chair of the 2025 meeting of the Parties to the Sea Drone Convention · Drone Convention Parties',
    'Kestavia · Chair of the Coastal Mechanism',
    'Lumeria · Chair of the Working Group on Tides',
    'Morvania · Coastal Group',
  ])
    assert.ok(!OFFICERS.test(l), l);
});

test('a garbled tally is flagged unclear and never interpreted; not-adopted reasons read in plain words', async () => {
  const segs = [
    seg(
      'E7',
      [
        '[4335s] Those in favor of draft resolution A/C.1/99/L.10, kindly signify; then against; then abstentions.',
        '[4380s] The voting result: 158 in favour, 4 abstentions, against and two abstained.',
      ],
      [{ label: '1st Committee · Chair', start: 4300, end: 4400 }],
    ),
  ];
  const [t] = transcriptTallies(segs as never);
  assert.equal(t?.unclear, true);
  assert.equal(transcriptTallies(segments as never)[0]?.unclear, false);
});

test('an ambiguous number sequence ("in 2025, 31, and 28") is not used; a clear one ("in 2024, 17 states") is', async () => {
  const { ambiguousSequences, usesAmbiguous } = await import('../engine/check/record.ts');
  const segs = [
    seg(
      'E9',
      [
        '[5205s] This session, 15 delegations were again kept out of the observer seats.',
        '[5218s] Likewise, in 2025, 31, and 28, a request by many delegations to take part was refused.',
      ],
      [{ label: 'Norvessa', start: 5200, end: 5300 }],
    ),
    seg(
      'E15',
      ['[9689s] Chair, in 2024, 17 delegations without membership were kept out.'],
      [{ label: 'Pellaria', start: 9680, end: 9700 }],
    ),
  ];
  const q = ambiguousSequences(segs as never);
  assert.deepEqual(q, [{ year: '2025', numbers: ['31', '28'] }]);
  // As a report or a cable might write them, in figures or in words.
  assert.deepEqual(usesAmbiguous('15 delegations were kept out this session, 31 in 2025 and 28 before.', q), [
    '31',
    '28',
  ]);
  assert.deepEqual(
    usesAmbiguous('fifteen delegations were kept out again, against thirty-one in 2025 and twenty-eight before.', q),
    ['31', '28'],
  );
  assert.deepEqual(usesAmbiguous('The numbers for 2025 and before, 31 and 28, are unclear in the transcript.', q), []);
  assert.deepEqual(usesAmbiguous('In 2024, 17 delegations were kept out; this session 15.', q), []);
  assert.deepEqual(usesAmbiguous('Rooms are available for up to 31 weeks per year.', q), []);
});
