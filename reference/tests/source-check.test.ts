import assert from 'node:assert/strict';
import { test } from 'node:test';
import { figures, quotes } from '../engine/check/source.ts';
import { checkReport, parseReport, ReportOutputError } from '../engine/work/report-doc.ts';
import type { Segment } from '../engine/work/context.ts';
import { goodReport, SEGMENT_TEXT } from './support/world.ts';

const segments: Segment[] = SEGMENT_TEXT.map((text, i) => ({
  label: 'E' + (i + 1),
  start: i * 60,
  end: i * 60 + 59,
  text,
  speakers: [{ start: 0, end: 1, label: i === 0 ? 'Arvenia' : 'Belmora' }],
}));
const run = (raw: unknown) => checkReport(parseReport(raw), segments, 'Test meeting 880th meeting 2026-11-10');

test('a faithful report passes and counts what it verified', () => {
  const r = run(goodReport());
  assert.deepEqual(r.failures, []);
  assert.equal(r.pass, true);
  assert.ok(r.stats.figures >= 3 && r.stats.quotes === 1 && r.stats.attributions === 2);
});

test('an altered figure is rejected', () => {
  const raw = goodReport();
  raw.outcome.text = 'The draft was adopted by 14 votes.';
  const r = run(raw);
  assert.equal(r.pass, false);
  assert.deepEqual(
    r.failures.map((f) => f.rule),
    ['figures'],
  );
});

test('a wrong speaker is rejected', () => {
  const raw = goodReport();
  raw.positions[0]!.delegation = 'Belmora';
  const r = run(raw);
  assert.equal(r.pass, false);
  assert.equal(r.failures[0]?.rule, 'attribution');
});

test('a quotation that is not verbatim is rejected', () => {
  const raw = goodReport();
  raw.positions[1]!.text = 'Asks for "a lasting stop to the shelling".';
  assert.equal(run(raw).failures[0]?.rule, 'quotes');
});

test('unknown or missing citations are rejected', () => {
  assert.equal(run(goodReport('E9')).failures[0]?.rule, 'references');
  const raw = goodReport();
  raw.issues[0]!.cites = [];
  assert.equal(run(raw).failures[0]?.rule, 'references');
});

test('figures from the meeting title and date need no segment', () => {
  const raw = goodReport();
  raw.issues.push({ text: 'The 880th meeting was held in 2026.', cites: ['E1'] });
  assert.equal(run(raw).pass, true);
});

test('a report over twice its length guide is rejected', () => {
  const raw = goodReport();
  raw.issues.push({ text: 'Arvenia '.repeat(900), cites: ['E1'] });
  assert.ok(run(raw).failures.some((f) => f.rule === 'length'));
});

test('a report without claims or outcome is not a report', () => {
  assert.throws(() => parseReport({ ...goodReport(), claims: [] }), ReportOutputError);
  assert.throws(() => parseReport({ ...goodReport(), outcome: {} }), ReportOutputError);
});

test('figure and quote extraction', () => {
  assert.deepEqual(figures('Resolution 9901 (2024), 15% and 3 parties; 1,200 observers [E12].'), [
    '9901',
    '2024',
    '15%',
    '1200',
  ]);
  assert.deepEqual(quotes('He said "no" and “we will not accept this”.'), ['we will not accept this']);
});

test('figures are compared as whole numbers, never as substrings', () => {
  const segs: Segment[] = [
    {
      label: 'E1',
      start: 0,
      end: 1,
      text: '[0s] Arvenia: Since 1987, 80 States have sent 1,200 observers.',
      speakers: [{ start: 0, end: 1, label: 'Arvenia' }],
    },
  ];
  const report = (t: string) => ({
    ...goodReport(),
    key_points: [1, 2, 3].map(() => ({ text: 'Arvenia spoke.', cites: ['E1'] })),
    decision_outcome: null,
    issues: [{ text: t, cites: ['E1'] }],
    positions: [],
    outcome: { text: 'None.', cites: ['E1'] },
    claims: [{ claim: 'x', cite: 'E1' }],
  });
  assert.equal(checkReport(parseReport(report('80 States since 1987; 1200 observers.')), segs, '').pass, true);
  assert.equal(checkReport(parseReport(report('87 States.')), segs, '').pass, false);
  assert.equal(checkReport(parseReport(report('19 States.')), segs, '').pass, false);
});

test('timestamps are not figures; numbers in words are', () => {
  const segs: Segment[] = [
    {
      label: 'E1',
      start: 0,
      end: 1,
      text: '[677s] Arvenia: twelve lighthouse keepers and twenty-one harbours.',
      speakers: [{ start: 0, end: 1, label: 'Arvenia' }],
    },
  ];
  const report = (t: string) => ({
    ...goodReport(),
    key_points: [1, 2, 3].map(() => ({ text: 'Arvenia spoke.', cites: ['E1'] })),
    decision_outcome: null,
    issues: [{ text: t, cites: ['E1'] }],
    positions: [],
    outcome: { text: 'None.', cites: ['E1'] },
    claims: [{ claim: 'x', cite: 'E1' }],
  });
  assert.equal(checkReport(parseReport(report('12 lighthouse keepers, 21 harbours.')), segs, '').pass, true);
  assert.equal(checkReport(parseReport(report('677 lighthouse keepers.')), segs, '').pass, false);
});

test('a misplaced figure is reported with the segment where it appears', () => {
  const raw = goodReport();
  raw.issues[0]!.cites = ['E2']; // 9901 and 15 are in E1; resolution 9901 is a reference, 15 a figure
  const f = run(raw).failures.filter((x) => x.rule === 'figures');
  assert.deepEqual(
    f.map((x) => x.detail),
    ['"15" not in E2; it appears in E1'],
  );
});

test('a reference (document symbol, resolution, rule, agenda item) may be cited where it is acted on', () => {
  const seg = (label: string, text: string): Segment => ({
    label,
    start: 0,
    end: 1,
    text,
    speakers: [{ start: 0, end: 1, label: 'Arvenia' }],
  });
  const segs = [
    seg('E1', '[0s] Arvenia: the amendment in document L/52; agenda item 49; resolution 99/151 and resolution 9903.'),
    seg(
      'E2',
      '[60s] Arvenia: the motion that no action be taken was adopted, 75 in favour, 7 against and 7 abstentions.',
    ),
  ];
  const report = (t: string) => ({
    ...goodReport(),
    key_points: [1, 2, 3].map(() => ({ text: 'Arvenia spoke.', cites: ['E1'] })),
    decision_outcome: null,
    issues: [{ text: t, cites: ['E2'] }],
    positions: [],
    outcome: { text: 'None.', cites: ['E1'] },
    claims: [{ claim: 'x', cite: 'E1' }],
  });
  const pass = (t: string) => checkReport(parseReport(report(t)), segs, '').pass;
  assert.equal(pass('The no-action motion on amendment L.52 was adopted, 75 in favour.'), true);
  assert.equal(pass('Under agenda item 49, resolutions 99/151 and 9903 were recalled; 75 in favour.'), true);
  // A reference that appears nowhere in the transcript, or a bare figure in the wrong segment, still fails.
  assert.equal(pass('The motion on amendment L.53 was adopted.'), false);
  assert.equal(pass('52 States voted in favour.'), false);
  assert.equal(pass('75 in favour; resolution 9903 had 52 sponsors.'), false);
});

test('a report output error names the missing part', () => {
  assert.throws(() => parseReport({ ...goodReport(), issues: [] }), /missing: issues/);
  assert.throws(() => parseReport({ ...goodReport(), outcome: 'None.' }), /missing: outcome as an object/);
});
