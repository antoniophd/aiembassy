// Decisions of 2026-11-19 (third round): proper names of organs, bodies
// and documents are not an argument of any field; overlap limit between
// opinions 35 %; the dossier mark "first" is set by code, the model chooses
// "maintains" or "revises", and a change of stands_with must be "revises";
// a red line the triage did not mark may be named by the decision (recorded,
// shown in Metrics only); the triage reads R3 on its own words.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { checkDecision, markChange, parseDecision, parseMemo, redLinesAdded } from '../engine/check/decision.ts';
import { runOnce } from '../engine/run/run.ts';
import { startServer } from '../web/server.ts';
import { disputeRule, triagePrompt } from '../prompts/dpr.triage.ts';
import { checkDesk, OPINION_OVERLAP, withoutProperNames } from '../engine/check/language.ts';
import { TEST_PROFILE } from './support/invented.ts';
import { addMeeting, fakeLlm, goodDecision, goodMemo, goodTriage, scripted, services } from './support/world.ts';

const profile = TEST_PROFILE;

test('desk: names of organs, commissions and documents are not economic arguments', () => {
  for (const t of [
    'It followed the wish of the parties and a ruling of the Economic and Maritime Council.',
    'The scheme rests on EMC ruling 2099/3.',
    'Two delegations mentioned the Lakeland Trade Organization.',
    'The Committee on Economic, Fiscal and Cultural Affairs sent its findings to the Assembly.',
    'The Commission on Trade and Shipping sat in Arvenia.',
  ])
    assert.deepEqual(checkDesk(t, 'legal'), [], t);
  assert.doesNotMatch(withoutProperNames('the Economic and Maritime Council'), /Economic/);
});

test('desk: an economic argument still fails the legal opinion, and only the legal opinion', () => {
  assert.match(checkDesk('It preserves the predictability on which open trade depends.', 'legal').join(), /"trade"/);
  assert.match(checkDesk('The economic cost of sanctions weighs on the State.', 'legal').join(), /"economic"/);
  assert.match(checkDesk('Economic arguments are weak here.', 'legal').join(), /"Economic"/);
  assert.deepEqual(checkDesk('The economic cost of sanctions weighs on the State.', 'political'), []);
});

test('overlap between opinions: limit 35 %', () => {
  assert.equal(OPINION_OVERLAP, 0.35);
});

test('dossier mark: "first" by code when there is no standing position, whatever the model wrote', () => {
  for (const change of [null, 'maintains', 'revises', 'first'])
    assert.equal(markChange(parseDecision(goodDecision({ change })), null).change, 'first');
  assert.equal(markChange(parseDecision(goodDecision({ change: 'revises' })), { stands_with: [] }).change, 'first');
  const memo = parseMemo(goodMemo());
  assert.deepEqual(
    checkDecision(markChange(parseDecision(goodDecision({ change: null })), null), 100, memo, profile, null),
    [],
  );
});

test('dossier mark: with a standing position the model says maintains or revises; the groups do not decide it (2026-11-23)', () => {
  const memo = parseMemo(goodMemo());
  const standing = { stands_with: ['Coastal Group'] };
  const check = (change: unknown, stands_with = ['Union of Lakeland States']) =>
    checkDecision(
      markChange(parseDecision(goodDecision({ change, stands_with })), standing),
      100,
      memo,
      profile,
      standing,
    ).join();
  assert.match(check(null), /say "maintains" or "revises"/);
  assert.match(check('first'), /say "maintains" or "revises"/);
  // Since 2026-11-23 the mark follows the line: other groups with the same line is "maintains"; "revises" says why.
  assert.doesNotMatch(check('maintains'), /dossier/);
  assert.match(check('revises'), /"revises" needs "line_change"/);
  assert.doesNotMatch(
    checkDecision(
      markChange(parseDecision(goodDecision({ change: 'revises', line_change: 'It now abstains on L.5.' })), standing),
      100,
      memo,
      profile,
      standing,
    ).join(),
    /dossier/,
  );
  assert.doesNotMatch(check('maintains', ['Coastal Group']), /dossier/);
  assert.throws(() => parseDecision(goodDecision({ change: 'keeps' })), /maintains or revises/);
});

test('red lines added by the decision: those of the profile the triage did not mark', () => {
  assert.deepEqual(redLinesAdded(['R2', 'R3', 'R3', 'R9'], { red_lines: ['R2'] }, profile), ['R3']);
  assert.deepEqual(redLinesAdded(['R2'], { red_lines: ['R2'] }, profile), []);
});

test('triage: R3 read on its own words, no wider test', () => {
  const r3 = profile.red_lines.find((r) => r.id === 'R3')!;
  const rule = disputeRule(profile);
  assert.ok(rule.includes(`"${r3.text}"`));
  assert.match(rule, /take a side on the merits/);
  assert.match(rule, /to which it is not party/);
  // The two cases (2026-11-19): a country-specific text on a dispute between States engages R3; a
  // resolution on a country's internal situation (human rights) does not.
  assert.ok(
    rule.includes(
      'A country-specific text engages it when the text turns on a dispute between States to which the State is not party.',
    ),
  );
  assert.ok(
    rule.includes(
      'A resolution on the internal situation of a country (human rights, for example) is not a dispute between States and does not engage it.',
    ),
  );
  assert.doesNotMatch(
    rule.replace(/A country-specific text[^.]*\.|A resolution on the internal[^.]*\./g, ''),
    /country/i,
  );
  const sys = triagePrompt.build({ profile, duplicateCandidates: [] } as never)[0]!.content;
  assert.ok(sys.includes(rule));
});

test('a decision naming a red line the triage did not mark is adopted, recorded and counted in Metrics only', async () => {
  const base = scripted(() => goodTriage('full_file'));
  const llm = fakeLlm((req) =>
    (req.messages[0]?.content ?? '').includes('you take the decision')
      ? goodDecision({ red_lines: ['R2', 'R3'] })
      : base(req),
  );
  const s = services(llm);
  addMeeting(s.db, 'sc/520', { date: '2026-11-10' });
  await runOnce(s, { trigger: 'manual', maxMinutes: 5, maxCalls: 200, ingest: false });
  const f = s.db.prepare(`SELECT status FROM files WHERE meeting_id = 'sc/520'`).get() as { status: string };
  assert.equal(f.status, 'adopted');
  const bodies = (
    s.db.prepare(`SELECT body_json FROM documents WHERE kind = 'decision'`).all() as { body_json: string }[]
  ).map((d) => JSON.parse(d.body_json) as { red_lines_added: string[] });
  assert.ok(bodies.length >= 2 && bodies.every((b) => b.red_lines_added.join() === 'R3'));
  // Every red line of the profile is still checked on the decision that stands.
  const checks = s.db.prepare(`SELECT COUNT(*) AS n FROM documents WHERE ref LIKE 'redline:%'`).get() as { n: number };
  assert.equal(checks.n, profile.red_lines.length);
  const server = startServer(s.db, '127.0.0.1', 0);
  await new Promise((r) => server.once('listening', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (p: string) => (await fetch(origin + p, { headers: { 'x-embassy-metrics': 'granted' } })).text();
  try {
    assert.match(await get('/metrics'), /Red lines added by the decision[\s\S]*1 in 1 decision of 1/);
    assert.doesNotMatch(await get('/meetings/sc/520'), /added by the decision|red_lines_added/i);
  } finally {
    server.close();
  }
});
