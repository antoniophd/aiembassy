// The call ledger. Every model call is claimed in llm_calls before it is
// sent, under a deterministic id; a second claim of the same id is refused,
// so a retry or a second run never sends a duplicate request.
import type { Db } from '../db/index.ts';
import { nowIso } from '../db/index.ts';
import {
  classifyCallError,
  modelFor,
  type ChatMessage,
  type GenerateResult,
  type LlmClient,
  type LlmEnvironment,
  type Reasoning,
} from '../llm/index.ts';
import type { AttemptRecord } from './ladder.ts';

export interface TaskKey {
  fileId: string;
  task:
    | 'triage'
    | 'note'
    | 'summary'
    | 'report'
    | 'claim'
    | 'opinion'
    | 'memo'
    | 'decision'
    | 'redline'
    | 'press'
    | 'cable';
  meetingId: string;
  ref: string;
  /** The work file's epoch: a reopened file starts a new ladder of attempts. */
  epoch: number;
}

export interface CallPlan extends TaskKey {
  runId: string;
  role: string;
  attempt: number;
  fallback: boolean;
  round: number;
  reasoning: Reasoning;
  /** 'check' uses the checker model (checks 7–8), 'check_fallback' the checker of fallback documents. */
  use?: 'writer' | 'check' | 'check_fallback';
  promptId: string;
  promptVersion: string;
  messages: ChatMessage[];
  maxTokens: number;
}

export const callId = (p: Omit<CallPlan, 'messages'>): string =>
  [
    p.task,
    p.fileId,
    p.meetingId,
    p.ref || '-',
    'a' + p.attempt,
    p.fallback ? 'fallback' : 'writer',
    'r' + p.round,
    ...(p.epoch ? ['e' + p.epoch] : []),
  ].join('|');

/** Highest attempt number used by earlier epochs; the new ladder counts on from it. */
export function baseAttempt(db: Db, key: TaskKey): number {
  const row = db
    .prepare(
      `SELECT MAX(attempt) AS a FROM llm_calls
       WHERE file_id = ? AND task = ? AND meeting_id = ? AND ref = ? AND epoch < ?`,
    )
    .get(key.fileId, key.task, key.meetingId, key.ref, key.epoch) as { a: number | null };
  return row.a ?? 0;
}

export function attemptRecords(db: Db, key: TaskKey): AttemptRecord[] {
  return (
    db
      .prepare(
        `SELECT attempt, fallback, round, state, error_kind, error, run_id FROM llm_calls
         WHERE file_id = ? AND task = ? AND meeting_id = ? AND ref = ? AND epoch = ? ORDER BY claimed_at, rowid`,
      )
      .all(key.fileId, key.task, key.meetingId, key.ref, key.epoch) as {
      attempt: number;
      fallback: number;
      round: number;
      state: AttemptRecord['state'];
      error_kind: AttemptRecord['errorKind'];
      error: string | null;
      run_id: string | null;
    }[]
  ).map((r) => ({
    attempt: r.attempt,
    fallback: !!r.fallback,
    round: r.round,
    state: r.state,
    errorKind: r.error_kind,
    runId: r.run_id,
    // "Ollama timed out or was unreachable" (adapter wording): a timeout is not counted as a round.
    timeout: r.error_kind === 'provider' && /\btimed out\b/i.test(r.error ?? ''),
  }));
}

export interface CallOutcome {
  id: string;
  result: GenerateResult | null;
  error: string | null;
}

/** Claims, sends and records one call. Never throws for model failures. */
export async function callModel(db: Db, llm: LlmClient, env: LlmEnvironment, plan: CallPlan): Promise<CallOutcome> {
  const id = callId(plan);
  const model = plan.fallback
    ? modelFor(env, 'fallback')
    : plan.use === 'check' || plan.use === 'check_fallback'
      ? modelFor(env, plan.use)
      : modelFor(env, 'writer', plan.role);
  const claimed = db
    .prepare(
      `INSERT INTO llm_calls (id, run_id, file_id, purpose, provider, model_requested, fallback, reasoning,
         prompt_id, prompt_version, state, claimed_at, task, meeting_id, ref, attempt, round, epoch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'claimed', ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
    )
    .run(
      id,
      plan.runId,
      plan.fileId,
      plan.role + '.' + plan.task,
      llm.target(plan.role).provider,
      model,
      plan.fallback ? 1 : 0,
      plan.reasoning ? 1 : 0,
      plan.promptId,
      plan.promptVersion,
      nowIso(),
      plan.task,
      plan.meetingId,
      plan.ref,
      plan.attempt,
      plan.round,
      plan.epoch,
    );
  if (claimed.changes !== 1) throw Error('Call already claimed: ' + id + '. No duplicate request was sent.');
  try {
    const result = await llm.generate({
      messages: plan.messages,
      maxTokens: plan.maxTokens,
      purpose: plan.role,
      model,
      // An effort level is sent as is to the writer and the fallback (both accepted "low" in the probes of
      // 2026-11-19).
      reasoning: plan.reasoning,
    });
    db.prepare(
      `UPDATE llm_calls SET state = 'complete', model_used = ?, input_tokens = ?, output_tokens = ?,
         duration_ms = ?, finished_at = ? WHERE id = ?`,
    ).run(result.model, result.usage.inputTokens, result.usage.outputTokens, result.durationMs, nowIso(), id);
    return { id, result, error: null };
  } catch (error) {
    const message = String((error as Error).message).slice(0, 500);
    db.prepare(`UPDATE llm_calls SET state = 'failed', error_kind = ?, error = ?, finished_at = ? WHERE id = ?`).run(
      classifyCallError(error),
      message,
      nowIso(),
      id,
    );
    return { id, result: null, error: message };
  }
}

/** Marks a completed call whose output was unusable or failed its check. */
export function rejectCall(db: Db, id: string, kind: 'output' | 'check', reason: string): void {
  db.prepare(`UPDATE llm_calls SET error_kind = ?, error = ? WHERE id = ?`).run(kind, reason.slice(0, 500), id);
  // A rejected document does not leave its low-confidence mark on the file, unless an accepted one carries it.
  const docs = db
    .prepare(`SELECT file_id, low_confidence_reason AS r FROM documents WHERE llm_call_id = ? AND low_confidence = 1`)
    .all(id) as { file_id: string; r: string }[];
  for (const d of docs) {
    const kept = db
      .prepare(
        `SELECT 1 FROM documents x JOIN llm_calls c ON c.id = x.llm_call_id
         WHERE x.file_id = ? AND x.low_confidence = 1 AND x.low_confidence_reason = ? AND c.error_kind IS NULL`,
      )
      .get(d.file_id, d.r);
    if (kept) continue;
    const f = db.prepare('SELECT low_confidence_reason AS r FROM files WHERE id = ?').get(d.file_id) as {
      r: string | null;
    };
    const rest = (f.r ?? '')
      .replace(d.r, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    db.prepare('UPDATE files SET low_confidence = ?, low_confidence_reason = ? WHERE id = ?').run(
      rest ? 1 : 0,
      rest || null,
      d.file_id,
    );
  }
}

/** Every rejection of this task in this epoch, newest first, each reason once (the second chance, 2026-11-25). */
export function allRejections(ctx: { db: Db; key: TaskKey }, kind: string, max = 24): string[] {
  const rows = ctx.db
    .prepare(
      `SELECT c.error FROM llm_calls c WHERE c.file_id = ? AND c.task = ? AND c.meeting_id = ? AND c.ref = ?
       AND c.epoch = ? AND c.error_kind IN ('check','output') AND c.error IS NOT NULL ORDER BY c.rowid DESC`,
    )
    .all(ctx.key.fileId, kind, ctx.key.meetingId, ctx.key.ref, ctx.key.epoch) as { error: string }[];
  return [...new Set(rows.flatMap((r) => r.error.split(' | ').map((x) => x.trim())).filter(Boolean))].slice(0, max);
}
