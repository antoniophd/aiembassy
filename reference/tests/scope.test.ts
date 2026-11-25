import assert from 'node:assert/strict';
import { test } from 'node:test';
import { identifySlug, isUnrecognisedCandidate, weekStart } from '../engine/ingest/scope.ts';

test('slugs identify the Council, the plenary and each Main Committee', () => {
  assert.deepEqual(identifySlug('sc/868'), { body: 'security_council', session: null, number: 868, part: 1 });
  assert.deepEqual(identifySlug('ga/99/40'), { body: 'ga_plenary', session: 99, number: 40, part: 1 });
  assert.deepEqual(identifySlug('ga/c4/99/21'), { body: 'ga_c4', session: 99, number: 21, part: 1 });
  assert.equal(identifySlug('ga/c6/99/40')?.body, 'ga_c6');
});

test('resumed parts keep the meeting identity and record the part', () => {
  assert.deepEqual(identifySlug('sc/854/3'), { body: 'security_council', session: null, number: 854, part: 3 });
  assert.deepEqual(identifySlug('ga/c6/99/24/2'), { body: 'ga_c6', session: 99, number: 24, part: 2 });
  assert.equal(identifySlug('sc/854/1'), null);
  assert.equal(identifySlug('sc/854/2/2'), null);
});

test('out-of-scope and unknown slugs are not guessed', () => {
  for (const slug of ['asset/k9z/k9zzz001', 'briefing/x', 'tb/901', 'ga/c7/99/1', 'sc/abc', 'ga/es-99/3'])
    assert.equal(identifySlug(slug), null, slug);
  assert.equal(isUnrecognisedCandidate('ga/es-99/3'), true);
  assert.equal(isUnrecognisedCandidate('asset/x'), false);
});

test('weeks run Monday to Sunday', () => {
  assert.equal(weekStart('2026-11-12'), '2026-11-09');
  assert.equal(weekStart('2026-11-09'), '2026-11-09');
  assert.equal(weekStart('2026-11-15'), '2026-11-09');
});
