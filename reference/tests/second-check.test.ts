// 2026-11-23: a document written by the fallback is checked by a model of another family, and its file
// loses the "same family" low confidence once every fallback document is covered by passed checks.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GenerateRequest } from '../engine/llm/index.ts';
import { runOnce } from '../engine/run/run.ts';
import { FALLBACK_LINE, SECOND_CHECK_TOKENS } from '../engine/work/second-check.ts';
import { addMeeting, fakeLlm, goodTriage, MODELS, providerDown, scripted, services } from './support/world.ts';

const opts = { trigger: 'manual' as const, maxMinutes: 5, maxCalls: 300, ingest: false };
const sys = (r: GenerateRequest) => r.messages[0]?.content ?? '';
/** The writer ('w') cannot write `what`; the fallback ('f') writes it in the next step. */
const writerDownOn = (what: string, base: ReturnType<typeof scripted>, claim?: (r: GenerateRequest) => unknown) =>
  fakeLlm((r) => {
    if (sys(r).includes(what) && r.model === 'w') return providerDown();
    if (claim && sys(r).includes('You check one claim')) return claim(r);
    return base(r);
  });
const file = (s: ReturnType<typeof services>, id: string) =>
  s.db
    .prepare('SELECT status, low_confidence AS lc, low_confidence_reason AS r FROM files WHERE meeting_id = ?')
    .get(id) as {
    status: string;
    lc: number;
    r: string | null;
  };

test('a fallback report on a full file: its claims go to the second checker with more tokens; no mark', async () => {
  const llm = writerDownOn(
    'Write the meeting report',
    scripted(() => goodTriage('full_file')),
  );
  const s = services(llm);
  addMeeting(s.db, 'sc/800');
  await runOnce(s, opts);
  const claims = llm.requests.filter((r) => sys(r).includes('You check one claim'));
  assert.ok(claims.length >= 1);
  assert.ok(claims.every((r) => r.model === MODELS.LLM_MODEL_CHECK_FALLBACK && r.maxTokens === SECOND_CHECK_TOKENS));
  // The decision was written by the writer: its red lines stay with the usual checker.
  const red = llm.requests.filter((r) => sys(r).includes('cross this red line'));
  assert.ok(red.length && red.every((r) => r.model === MODELS.LLM_MODEL_CHECK && r.maxTokens === 1500));
  const f = file(s, 'sc/800');
  assert.equal(f.status, 'adopted');
  assert.doesNotMatch(f.r ?? '', /same family/);
  const log = s.db.prepare(`SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'fallback-mark:%:sc/800'`).get() as {
    n: number;
  };
  assert.equal(log.n, 1);
});

test('a fallback report on a report-level file: every claim checked, never gating; a failed claim keeps the mark', async () => {
  const ok = writerDownOn('Write the meeting report', scripted());
  const s = services(ok);
  addMeeting(s.db, 'ga/c2/99/800');
  await runOnce(s, opts);
  assert.ok(
    ok.requests.some((r) => sys(r).includes('You check one claim') && r.model === MODELS.LLM_MODEL_CHECK_FALLBACK),
  );
  assert.deepEqual({ ...file(s, 'ga/c2/99/800') }, { status: 'reported', lc: 0, r: null });

  const bad = writerDownOn('Write the meeting report', scripted(), () => ({ verdict: 'contradicted', reason: 'No.' }));
  const t = services(bad);
  addMeeting(t.db, 'ga/c2/99/801');
  await runOnce(t, opts);
  const f = file(t, 'ga/c2/99/801');
  assert.equal(f.status, 'reported', 'the check never holds a report back');
  assert.equal(f.lc, 1);
  assert.match(f.r ?? '', new RegExp(FALLBACK_LINE.replace(/[.()]/g, '\\$&')));
});

test('a fallback document that no model check covers (an opinion) keeps the mark', async () => {
  const base = scripted(() => goodTriage('full_file', { opinions: ['legal'] }));
  const llm = writerDownOn('the one thing your desk adds', base);
  const s = services(llm);
  addMeeting(s.db, 'sc/810');
  await runOnce(s, opts);
  const f = file(s, 'sc/810');
  assert.equal(f.status, 'adopted');
  assert.match(f.r ?? '', /same family/);
  // Nothing else of this file was written by the fallback, so its checks stay with the usual checker.
  assert.ok(
    llm.requests.filter((r) => sys(r).includes('You check one claim')).every((r) => r.model === MODELS.LLM_MODEL_CHECK),
  );
});
