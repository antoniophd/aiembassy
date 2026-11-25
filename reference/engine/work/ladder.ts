// The ladder of attempts for one task (the design, § Models).
// Pure: decides the next call from the ledger rows of that task.
//
//   attempt 1 on the writer; a failed document gets one regeneration
//   (attempt 2, writer) and then one on the fallback model (attempt 3);
//   after that the task is given up.
//   A provider failure (timeout, 5xx, rate limit, model unavailable) repeats
//   the same attempt once on the fallback model in the next step. If that
//   also fails the task waits for the next run; after three such rounds it is
//   given up. A timeout (the provider did not answer in time) is retried on the
//   next run and does not count as a round (2026-11-19): only other
//   provider failures (5xx, rate limit, model unavailable, interrupted call)
//   do. After four timeouts in a row on the same document the task is given
//   up as not adopted, "the model did not respond in time" (2026-11-19).
//   A timeout on the writer is first retried once on the writer, in the next
//   step, before the fallback (2026-11-25): a slow answer is not a
//   reason to change model.
//   A document still rejected after the fallback gets a second chance (
//   2026-11-25): one more attempt (4) on the writer in the next run, told every
//   rejection of the document; the file stays in preparation meanwhile. If
//   that fails too, the task is given up. Only for the tasks that take it.
//   A configuration failure (key, credits) halts the run.

export const MAX_ATTEMPTS = 3;
/** The second chance's attempt: one more, on the writer, in the next run. */
export const SECOND_CHANCE_ATTEMPT = MAX_ATTEMPTS + 1;
export const MAX_PROVIDER_ROUNDS = 3;
/** Timeouts in a row on one document after which it is given up (not adopted). */
export const MAX_TIMEOUTS_IN_A_ROW = 4;
export const TIMEOUT_REASON = 'The model did not respond in time';

export interface AttemptRecord {
  attempt: number;
  fallback: boolean;
  round: number;
  state: 'claimed' | 'complete' | 'failed';
  errorKind: 'provider' | 'config' | 'output' | 'check' | null;
  runId: string | null;
  /** A provider failure that was a timeout (no answer in time): not counted as a round. */
  timeout?: boolean;
}

export type Decision =
  | { kind: 'call'; attempt: number; fallback: boolean; round: number; secondChance?: boolean }
  | { kind: 'wait'; reason: string }
  | { kind: 'give_up'; reason: string; technical: boolean }
  | { kind: 'halt'; reason: string };

/**
 * `records` in claim order. A complete record whose document was accepted
 * means the task is done and decide() is not called.
 */
export function decide(records: AttemptRecord[], runId: string, opts: { secondChance?: boolean } = {}): Decision {
  const last = records.at(-1);
  if (!last) return { kind: 'call', attempt: 1, fallback: false, round: 1 };
  const nextRound = (attempt: number, fallback: boolean): number =>
    records.filter((r) => r.attempt === attempt && r.fallback === fallback).length + 1;

  if (last.errorKind === 'config') {
    if (last.runId === runId) return { kind: 'halt', reason: 'Model provider configuration (key or credits) rejected' };
    return {
      kind: 'call',
      attempt: last.attempt,
      fallback: last.fallback,
      round: nextRound(last.attempt, last.fallback),
    };
  }

  // A claimed call never finished (interrupted run): treated as a provider failure.
  const providerFailure = last.state === 'claimed' || (last.state === 'failed' && last.errorKind === 'provider');
  if (providerFailure) {
    let streak = 0;
    for (let i = records.length - 1; i >= 0 && records[i]!.state === 'failed' && records[i]!.timeout; i--) streak++;
    if (streak >= MAX_TIMEOUTS_IN_A_ROW)
      return { kind: 'give_up', reason: `${TIMEOUT_REASON} (${streak} timeouts in a row)`, technical: false };
    if (!last.fallback) {
      const prev = records.at(-2);
      const retried =
        !!prev && !prev.fallback && prev.attempt === last.attempt && prev.state === 'failed' && !!prev.timeout;
      if (last.state === 'failed' && last.timeout && !retried)
        return { kind: 'call', attempt: last.attempt, fallback: false, round: nextRound(last.attempt, false) };
      return { kind: 'call', attempt: last.attempt, fallback: true, round: nextRound(last.attempt, true) };
    }
    const rounds = records.filter(
      (r) =>
        r.attempt === last.attempt &&
        r.fallback &&
        (r.state === 'claimed' || r.errorKind === 'provider') &&
        !(r.state === 'failed' && r.timeout),
    ).length;
    if (rounds >= MAX_PROVIDER_ROUNDS)
      return { kind: 'give_up', reason: 'Model provider unavailable after ' + rounds + ' rounds', technical: true };
    if (last.runId === runId) return { kind: 'wait', reason: 'Provider failure; retried on the next run' };
    const fallback = last.attempt === MAX_ATTEMPTS;
    if (last.attempt === SECOND_CHANCE_ATTEMPT)
      return {
        kind: 'call',
        attempt: last.attempt,
        fallback: false,
        round: nextRound(last.attempt, false),
        secondChance: true,
      };
    return { kind: 'call', attempt: last.attempt, fallback, round: nextRound(last.attempt, fallback) };
  }

  // The document was produced but rejected (invalid output or failed check).
  if (last.attempt === MAX_ATTEMPTS && opts.secondChance) {
    if (last.runId === runId) return { kind: 'wait', reason: 'Second chance on the next run' };
    return { kind: 'call', attempt: SECOND_CHANCE_ATTEMPT, fallback: false, round: 1, secondChance: true };
  }
  if (last.attempt >= MAX_ATTEMPTS)
    return {
      kind: 'give_up',
      reason:
        last.attempt > MAX_ATTEMPTS
          ? 'Document failed after its second chance'
          : 'Document failed after regeneration on the fallback model',
      technical: false,
    };
  const attempt = last.attempt + 1;
  const fallback = attempt === MAX_ATTEMPTS;
  return { kind: 'call', attempt, fallback, round: nextRound(attempt, fallback) };
}
