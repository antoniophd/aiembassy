import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkCopy } from '../engine/check/copy.ts';
import { checkDecision, parseDecision, parseMemo } from '../engine/check/decision.ts';
import { tallyClaims } from '../engine/queue/plan-full.ts';
import { inClaimSample } from '../engine/queue/plan.ts';
import { runOnce } from '../engine/run/run.ts';
import {
  addMeeting,
  fakeLlm,
  goodDecision,
  goodMemo,
  goodTriage,
  scripted,
  services,
  status,
} from './support/world.ts';
import { TEST_PROFILE } from './support/invented.ts';

const opts = { trigger: 'manual' as const, maxMinutes: 5, maxCalls: 200, ingest: false };
const sys = (r: { messages: { content: string }[] }) => r.messages[0]?.content ?? '';
const profile = TEST_PROFILE;

test('a full file: claims, opinion, memo, two decisions, red lines, press, adopted, dossier updated', async () => {
  const llm = fakeLlm(scripted(() => goodTriage('full_file')));
  const s = services(llm);
  addMeeting(s.db, 'sc/400');
  const r = await runOnce(s, opts);
  assert.equal(r.outcome, 'completed');
  assert.equal(status(s.db, 'sc/400').status, 'adopted');
  const kinds = s.db
    .prepare(
      `SELECT kind, ref FROM documents WHERE kind IN ('opinion','options_memo','decision','press') ORDER BY kind, ref`,
    )
    .all()
    .map((x) => `${x.kind}:${x.ref}`);
  assert.deepEqual(kinds, ['decision:A', 'decision:B', 'opinion:legal', 'options_memo:', 'press:', 'press:pack']);
  assert.equal(llm.requests.filter((q) => sys(q).includes('You check one claim')).length, 1);
  assert.equal(llm.requests.filter((q) => sys(q).includes('cross this red line')).length, 4);
  assert.ok(llm.requests.filter((q) => sys(q).includes('cross this red line')).every((q) => q.model === 'c'));
  // The writer reasons normally on the decision; the fallback keeps effort "low" (2026-11-19).
  assert.ok(llm.requests.filter((q) => sys(q).includes('you take the decision')).every((q) => q.reasoning === true));
  const dossier = s.db.prepare('SELECT standing_position, stands_with FROM dossiers').get() as Record<string, string>;
  assert.match(dossier.standing_position ?? '', /votes in favour/);
  assert.deepEqual(JSON.parse(dossier.stands_with ?? '[]'), ['Union of Lakeland States']);
  const press = s.db.prepare(`SELECT text FROM documents WHERE kind = 'press'`).get() as { text: string };
  assert.match(press.text, /^Draft statement\. Not released/);
  assert.equal(status(s.db, 'sc/400').low_confidence, 0);
});

test('two decisions that differ: adopted with low confidence, both kept', async () => {
  let n = 0;
  const base = scripted(() => goodTriage('full_file'));
  const llm = fakeLlm((req) =>
    sys(req).includes('you take the decision')
      ? goodDecision(
          n++ === 0
            ? {}
            : {
                option: 'B',
                vote: 'abstain',
                stands_with: ['national capacity'],
                group_positions: [{ group: 'Union of Lakeland States', cite: 'E2', position: 'Access.', same: false }],
                closest_to: 'Union of Lakeland States',
                differs_on: { text: 'The Union votes for the text.', cite: 'E2' },
              },
        )
      : base(req),
  );
  const s = services(llm);
  addMeeting(s.db, 'sc/401');
  await runOnce(s, opts);
  const f = status(s.db, 'sc/401');
  assert.equal(f.status, 'adopted');
  assert.equal(f.low_confidence, 1);
});

test('a decision crossing a red line is regenerated', async () => {
  let first = true;
  const base = scripted(() => goodTriage('full_file'));
  const llm = fakeLlm((req) => {
    if (sys(req).includes('cross this red line') && first && (req.messages[1]?.content ?? '').includes('"id":"R1"')) {
      first = false;
      return { crosses: true, reason: 'It recognises an annexation.' };
    }
    return base(req);
  });
  const s = services(llm);
  addMeeting(s.db, 'sc/402');
  await runOnce(s, opts);
  assert.equal(status(s.db, 'sc/402').status, 'adopted');
  assert.equal(llm.requests.filter((q) => sys(q).includes('you take the decision')).length, 3); // A, B, A again
});

test('a report with a contradicted claim is redone before any opinion is written', async () => {
  let first = true;
  const base = scripted(() => goodTriage('full_file'));
  const llm = fakeLlm((req) => {
    if (sys(req).includes('You check one claim') && first) {
      first = false;
      return { verdict: 'contradicted', reason: 'Arvenia opposed it.' };
    }
    return base(req);
  });
  const s = services(llm);
  addMeeting(s.db, 'sc/403');
  await runOnce(s, opts);
  assert.equal(status(s.db, 'sc/403').status, 'adopted');
  assert.equal(llm.requests.filter((q) => sys(q).includes('Write the meeting report')).length, 2);
  const redo = llm.requests.filter((q) => sys(q).includes('Write the meeting report'))[1];
  assert.match(redo?.messages[1]?.content ?? '', /contradicted: \\"Arvenia supports resolution 9901/);
});

test('claim tally: any contradicted, or more than 10 % not supported, fails', () => {
  assert.equal(tallyClaims(Array(10).fill('supported')).pass, true);
  assert.equal(tallyClaims([...Array(9).fill('supported'), 'not_supported']).pass, true);
  assert.equal(tallyClaims([...Array(8).fill('supported'), 'not_supported', 'not_supported']).pass, false);
  assert.equal(tallyClaims([...Array(19).fill('supported'), 'contradicted']).pass, false);
});

test('copy check: a decision repeating the memo is rejected', () => {
  const memo =
    'The State votes in favour of the draft and explains that humanitarian access admits no exception. It stands with the Union of Lakeland States on this text.';
  assert.equal(checkCopy(memo, [memo]).pass, false);
  assert.equal(
    checkCopy('A wholly different sentence about the budget of peacekeeping missions this year.', [memo]).pass,
    true,
  );
});

test('decision checks: profile references, dossier coherence and the memo option', () => {
  const memo = parseMemo(goodMemo());
  const d = parseDecision(goodDecision());
  assert.deepEqual(checkDecision(d, 100, memo, profile, null), []);
  const bad = parseDecision(goodDecision({ interests: ['I9'], stands_with: ['The Lantern League'], option: 'C' }));
  const f = checkDecision(bad, 100, memo, profile, null).join(' ');
  assert.match(f, /unknown interest I9/);
  assert.match(f, /unknown group "The Lantern League"/);
  assert.match(f, /option C is not in the memo/);
  const maintains = parseDecision(goodDecision({ change: 'maintains' }));
  // Other groups, the same line: "maintains" passes (2026-11-23).
  assert.doesNotMatch(
    checkDecision(maintains, 100, memo, profile, { stands_with: ['Coastal Group'] }).join(),
    /dossier/,
  );
  assert.match(
    checkDecision(d, 100, memo, profile, { stands_with: ['Coastal Group'] }).join(),
    /say "maintains" or "revises"/,
  );
  assert.throws(
    () => parseDecision(goodDecision({ position: 'No formal outcome was recorded.' })),
    /finding is not a position/,
  );
});

test('one report in ten has its claims checked for Metrics, and the check never gates it', async () => {
  const base = scripted(() => goodTriage('report'));
  const llm = fakeLlm((req) =>
    sys(req).includes('You check one claim') ? { verdict: 'contradicted', reason: 'No.' } : base(req),
  );
  const s = services(llm);
  assert.ok(inClaimSample('sc/333') && !inClaimSample('sc/334'));
  addMeeting(s.db, 'sc/333');
  addMeeting(s.db, 'sc/334');
  await runOnce(s, opts);
  assert.equal(status(s.db, 'sc/333').status, 'reported');
  assert.equal(status(s.db, 'sc/334').status, 'reported');
  const claims = s.db.prepare(`SELECT file_id, model_used FROM llm_calls WHERE task = 'claim'`).all();
  assert.deepEqual(
    claims.map((c) => [c.file_id, c.model_used]),
    [['file:sc/333', 'c']],
  );
});
