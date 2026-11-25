// Owner rules of 2026-11-16: delegations named in agreement or disagreement
// speak where cited (own entry only for the decision and the cable);
// Secretariat officials brief the Council; the cable of a report needs an
// interest and an outcome (a text voted or adopted).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkCable, parseCable } from '../engine/check/cable.ts';
import { isOfficer } from '../engine/check/groups.ts';
import { namedNotSpeaking, namedWithoutEntry } from '../engine/check/record.ts';
import { reportWantsCable } from '../engine/work/cable-task.ts';
import { checkReport, parseReport } from '../engine/work/report-doc.ts';
import { goodCable, goodReport } from './support/world.ts';

const seg = (label: string, text: string, speakers: string[]) => ({
  label,
  text,
  speakers: speakers.map((l, i) => ({ label: l, start: i * 10, end: i * 10 + 9 })),
});
// Many speakers; a State whose label carries a parenthesis is named in agreement by its short name.
const segments = [
  seg('E1', '[0s] Opening.', ['3rd Committee · Chair', 'Tarvonia']),
  seg('E2', '[0s] We support the text.', ['Quintara (Republic of)', 'Rovinia']),
  seg('E3', '[0s] We oppose it.', ['Rovinia', 'UN Secretariat · Secretary']),
];

test('agreement and disagreement: a named delegation must speak in a cited segment, no entry of its own', () => {
  assert.deepEqual(
    namedNotSpeaking([{ text: 'Quintara and Rovinia agreed on the text.', cites: ['E2'] }], segments, 'ga_c3'),
    [],
  );
  assert.deepEqual(
    namedNotSpeaking([{ text: 'Tarvonia and Rovinia disagreed.', cites: ['E3'] }], segments, 'ga_c3').map(
      (x) => x.name,
    ),
    ['tarvonia'],
  );
  // An organisation (labelled by acronym) named as the subject of a line is not a delegation.
  const office = [...segments, seg('E4', '[0s] Report.', ['OCTA · Commissioner-General'])];
  assert.deepEqual(namedNotSpeaking([{ text: 'Rovinia backed OCTA.', cites: ['E3'] }], office, 'ga_c4'), []);
  // Presiding officers are not delegations: naming the Chair is not checked.
  assert.deepEqual(namedNotSpeaking([{ text: 'The Chair closed.', cites: ['E3'] }], segments, 'ga_c3'), []);
  // The decision and the cable still require an entry of their own.
  assert.deepEqual(
    namedWithoutEntry('Rovinia and Tarvonia voted no.', segments, [{ delegation: 'Rovinia', cites: ['E3'] }]),
    ['tarvonia'],
  );
});

test('report check: a State named in agreement where it spoke passes without a position', () => {
  const r = parseReport({
    ...goodReport(),
    agreement: [{ text: 'Quintara and Rovinia agreed.', cites: ['E2'] }],
    disagreement: [{ text: 'Tarvonia objected.', cites: ['E2'] }],
  });
  const ctx = { body: 'ga_c3' as const, decisionPoint: null, segments: segments as never };
  const f = checkReport(r, segments as never, '', ctx)
    .failures.filter((x) => x.section === 'agreement')
    .map((x) => x.detail);
  // Since 2026-11-19 the line is repaired by code before the check (repairNamedLines), never rejected.
  assert.equal(f.length, 0);
});

test('officers: Secretariat officials brief the Council; the exclusion stays in the Assembly and committees', () => {
  const council = [
    'UN Secretariat · ASG, Coastal Affairs and Field Support',
    'UN · SRSG for Children and Armed Conflict',
    'UN · Special Envoy of the SG on the Lakeland Basin',
    'UN · USG for Peace Operations',
    'UN · Senior Representative of the SG on carrying out Council resolution 9902',
  ];
  for (const l of council) assert.equal(isOfficer(l, 'security_council'), false, l);
  assert.equal(isOfficer('Security Council · President', 'security_council'), true);
  assert.equal(isOfficer('UN Secretariat · Secretary', 'security_council'), true);
  assert.equal(isOfficer('UN Secretariat', 'security_council'), true);
  assert.equal(isOfficer('UN Secretariat · ASG, Coastal Affairs', 'ga_c4'), true);
  assert.equal(isOfficer('4th Committee · Chair', 'ga_c4'), true);
  // A delegation is never an officer, in either.
  assert.equal(isOfficer('Arvenia · President of the Security Council', 'security_council'), false);
});

test('report check: an ASG briefing the Council is a briefer; in a committee it is refused', () => {
  const asg = 'UN Secretariat · ASG, Coastal Affairs and Field Support';
  const sc = [
    seg('E1', '[0s] Briefing.', ['Security Council · President', asg]),
    seg('E2', '[0s] Arvenia.', ['Arvenia']),
  ];
  const r = parseReport({ ...goodReport(), briefers: [{ speaker: asg, text: 'Briefed the Council.', cites: ['E1'] }] });
  const structure = (body: 'security_council' | 'ga_c4') =>
    checkReport(r, sc as never, '', { body, decisionPoint: null, segments: sc as never })
      .failures.filter((x) => x.section === 'briefers')
      .map((x) => x.detail);
  assert.deepEqual(structure('security_council'), []);
  assert.ok(structure('ga_c4').some((x) => /presides or serves the meeting/.test(x)));
  const president = parseReport({
    ...goodReport(),
    briefers: [{ speaker: 'Security Council · President', text: 'Opened.', cites: ['E1'] }],
  });
  assert.ok(
    checkReport(president, sc as never, '', {
      body: 'security_council',
      decisionPoint: null,
      segments: sc as never,
    }).failures.some((x) => x.section === 'briefers' && /presides or serves/.test(x.detail)),
  );
});

test('cable of a report: marked, a concrete interest, and a text voted or adopted (read by code since 2026-11-19)', () => {
  const triage = { level: 'report', cable: true, engaged: { interests: ['I2'] } };
  const segments = [{ label: 'E2', text: '[60s] Draft resolution L.5 was adopted by 13 votes.', speakers: [] }];
  const vote = { outcome: { text: 'Draft resolution L.5 was adopted.', cites: ['E2'] }, disagreement: [] };
  const split = {
    outcome: { text: 'The debate ended without action.', cites: ['E2'] },
    disagreement: [{ text: 'Arvenia and Belmora disagreed.', cites: ['E2'] }],
  };
  assert.equal(reportWantsCable(triage, vote as never, segments), true);
  assert.equal(reportWantsCable(triage, split as never, segments), false); // a division alone is not enough
  assert.equal(reportWantsCable({ ...triage, engaged: { interests: [] } }, vote as never, segments), false);
  assert.equal(reportWantsCable({ ...triage, cable: false }, vote as never, segments), false);
  assert.equal(reportWantsCable({ ...triage, level: 'note' }, vote as never, segments), false);
  assert.equal(reportWantsCable(triage, null, segments), false); // decided once the report is accepted
});

test('cable: a delegation it names needs an entry of its own in the report', () => {
  const ctx = (entries: { delegation: string; cites: string[] }[]) => ({
    reportText: 'Arvenia and Belmora spoke. L.5 was adopted by 13 votes.',
    segments: [seg('E1', '', ['Arvenia', 'Belmora'])],
    decision: null,
    entries,
    body: 'ga_c1' as const,
  });
  const c = parseCable(goodCable(false));
  const both = [
    { delegation: 'Arvenia', cites: ['E1'] },
    { delegation: 'Belmora', cites: ['E1'] },
  ];
  assert.deepEqual(checkCable(c, ctx(both)), []);
  assert.match(checkCable(c, ctx([both[0]!])).join(), /cable: belmora has no entry of its own in the report/);
});
