import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, type AttemptRecord } from '../engine/work/ladder.ts';

const rec = (r: Partial<AttemptRecord>): AttemptRecord => ({
  attempt: 1,
  fallback: false,
  round: 1,
  state: 'complete',
  errorKind: null,
  runId: 'run-a',
  ...r,
});

test('first call goes to the writer', () => {
  assert.deepEqual(decide([], 'run-a'), { kind: 'call', attempt: 1, fallback: false, round: 1 });
});

test('a provider failure is retried once on the fallback, then waits for the next run', () => {
  const down = rec({ state: 'failed', errorKind: 'provider' });
  assert.deepEqual(decide([down], 'run-a'), { kind: 'call', attempt: 1, fallback: true, round: 1 });
  const both = [down, rec({ state: 'failed', errorKind: 'provider', fallback: true })];
  assert.equal(decide(both, 'run-a').kind, 'wait');
  assert.deepEqual(decide(both, 'run-b'), { kind: 'call', attempt: 1, fallback: false, round: 2 });
});

test('an interrupted call counts as a provider failure and is never resent', () => {
  assert.deepEqual(decide([rec({ state: 'claimed' })], 'run-b'), {
    kind: 'call',
    attempt: 1,
    fallback: true,
    round: 1,
  });
});

test('after three provider rounds the task is given up', () => {
  const rounds = [1, 2, 3].flatMap((round) => [
    rec({ state: 'failed', errorKind: 'provider', round, runId: 'r' + round }),
    rec({ state: 'failed', errorKind: 'provider', fallback: true, round, runId: 'r' + round }),
  ]);
  assert.deepEqual(decide(rounds, 'r4'), {
    kind: 'give_up',
    reason: 'Model provider unavailable after 3 rounds',
    technical: true,
  });
});

test('a provider timeout is retried on the next run and is not counted as a round (2026-11-19)', () => {
  // A decision B whose attempt 3 on the fallback timed out in three runs: it is not given up.
  const timeouts = [1, 2, 3].map((round) =>
    rec({
      attempt: 3,
      state: 'failed',
      errorKind: 'provider',
      fallback: true,
      round,
      runId: 'r' + round,
      timeout: true,
    }),
  );
  assert.equal(decide(timeouts, 'r3').kind, 'wait'); // same run: waits
  assert.deepEqual(decide(timeouts, 'r4'), { kind: 'call', attempt: 3, fallback: true, round: 4 });
  // Other provider failures still count: three of them give up, timeouts among them do not add.
  const mixed = [
    ...timeouts.slice(0, 2),
    ...[3, 4, 5].map((round) =>
      rec({ attempt: 3, state: 'failed', errorKind: 'provider', fallback: true, round, runId: 'r' + round }),
    ),
  ];
  assert.equal(decide(mixed, 'r6').kind, 'give_up');
  assert.equal(decide(mixed.slice(0, 4), 'r6').kind, 'call');
});

test('four timeouts in a row on one document: not adopted, in plain words (2026-11-19)', async () => {
  const t = (round: number, fallback = true) =>
    rec({ attempt: 3, state: 'failed', errorKind: 'provider', fallback, round, runId: 'r' + round, timeout: true });
  assert.equal(decide([t(1), t(2), t(3)], 'r4').kind, 'call');
  assert.deepEqual(decide([t(1), t(2), t(3), t(4)], 'r5'), {
    kind: 'give_up',
    reason: 'The model did not respond in time (4 timeouts in a row)',
    technical: false,
  });
  // In a row: an answer in between (a rejected document) starts the count again.
  const broken = [t(1), t(2), rec({ attempt: 2, state: 'complete', errorKind: 'check', round: 1 }), t(3), t(4)];
  assert.notEqual(decide(broken, 'r5').kind, 'give_up');
});

test('a rejected document is regenerated once, then once on the fallback, then given up', () => {
  const r1 = rec({ errorKind: 'check' });
  assert.deepEqual(decide([r1], 'run-a'), { kind: 'call', attempt: 2, fallback: false, round: 1 });
  const r2 = rec({ attempt: 2, errorKind: 'output' });
  assert.deepEqual(decide([r1, r2], 'run-a'), { kind: 'call', attempt: 3, fallback: true, round: 1 });
  const r3 = rec({ attempt: 3, fallback: true, errorKind: 'check' });
  assert.equal(decide([r1, r2, r3], 'run-a').kind, 'give_up');
});

test('a timeout on the writer is retried once on the writer before the fallback (2026-11-25)', () => {
  const t = (fallback: boolean, round = 1, attempt = 1) =>
    rec({ attempt, state: 'failed', errorKind: 'provider', fallback, round, timeout: true });
  assert.deepEqual(decide([t(false)], 'run-a'), { kind: 'call', attempt: 1, fallback: false, round: 2 });
  assert.deepEqual(decide([t(false), t(false, 2)], 'run-a'), { kind: 'call', attempt: 1, fallback: true, round: 1 });
  // Another provider failure (not a timeout) still goes straight to the fallback.
  const down = rec({ state: 'failed', errorKind: 'provider' });
  assert.deepEqual(decide([down], 'run-a'), { kind: 'call', attempt: 1, fallback: true, round: 1 });
  // A regeneration (attempt 2) that times out gets its own retry on the writer.
  const r1 = rec({ errorKind: 'check' });
  assert.deepEqual(decide([r1, t(false, 1, 2)], 'run-a'), { kind: 'call', attempt: 2, fallback: false, round: 2 });
});

test('a configuration failure halts the run', () => {
  assert.equal(decide([rec({ state: 'failed', errorKind: 'config' })], 'run-a').kind, 'halt');
});
