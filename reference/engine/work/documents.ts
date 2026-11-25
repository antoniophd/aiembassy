// Documents: stored once, never rewritten. A document is "accepted" when the
// call that produced it was not rejected (invalid output or failed check).
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/index.ts';
import { nowIso } from '../db/index.ts';
import type { GenerateResult } from '../llm/index.ts';

export type DocKind =
  | 'triage'
  | 'note'
  | 'report'
  | 'check'
  | 'segment_summary'
  | 'opinion'
  | 'options_memo'
  | 'decision'
  | 'press'
  | 'cable';

export interface DocumentRow {
  id: string;
  file_id: string;
  meeting_id: string;
  kind: DocKind;
  ref: string;
  author_role: string;
  attempt: number;
  body_json: string;
  text: string;
  model: string;
  llm_call_id: string | null;
}

export interface NewDocument {
  fileId: string;
  meetingId: string;
  kind: DocKind;
  ref: string;
  role: string;
  attempt: number;
  body: unknown;
  text: string;
  promptId: string;
  promptVersion: string;
  callId: string | null;
  result: Pick<GenerateResult, 'provider' | 'model' | 'usage' | 'durationMs'>;
  /** One-line reason when the document is low confidence (e.g. written by the fallback). */
  lowConfidence?: string | null;
}

export function storeDocument(db: Db, d: NewDocument): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO documents (id, file_id, meeting_id, kind, ref, author_role, attempt, body_json, text, provider,
       model, prompt_id, prompt_version, input_tokens, output_tokens, duration_ms, llm_call_id, created_at,
     low_confidence, low_confidence_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    d.fileId,
    d.meetingId,
    d.kind,
    d.ref,
    d.role,
    d.attempt,
    JSON.stringify(d.body),
    d.lowConfidence ? d.lowConfidence + '\n' + d.text : d.text,
    d.result.provider,
    d.result.model,
    d.promptId,
    d.promptVersion,
    d.result.usage.inputTokens,
    d.result.usage.outputTokens,
    d.result.durationMs,
    d.callId,
    nowIso(),
    d.lowConfidence ? 1 : 0,
    d.lowConfidence ?? null,
  );
  // A low-confidence document makes its file low confidence.
  if (d.lowConfidence)
    db.prepare(
      `UPDATE files SET low_confidence = 1,
         low_confidence_reason = CASE WHEN low_confidence_reason IS NULL THEN ?
           WHEN instr(low_confidence_reason, ?) > 0 THEN low_confidence_reason
           ELSE low_confidence_reason || ' ' || ? END
       WHERE id = ?`,
    ).run(d.lowConfidence, d.lowConfidence, d.lowConfidence, d.fileId);
  return id;
}

/** The accepted document of a task, or undefined. */
export function acceptedDocument(
  db: Db,
  fileId: string,
  meetingId: string,
  kind: DocKind,
  ref = '',
): DocumentRow | undefined {
  return db
    .prepare(
      `SELECT d.* FROM documents d JOIN llm_calls c ON c.id = d.llm_call_id JOIN files f ON f.id = d.file_id
       WHERE d.file_id = ? AND d.meeting_id = ? AND d.kind = ? AND d.ref = ? AND c.error_kind IS NULL
         AND c.epoch >= f.accept_from_epoch
         AND (c.epoch >= f.decide_from_epoch OR (d.kind NOT IN ('decision','press','cable') AND d.ref NOT LIKE 'redline:%'))
         AND (c.epoch >= f.rework_from_epoch OR d.kind = 'segment_summary')
         AND (c.epoch >= f.report_from_epoch OR d.kind IN ('segment_summary', 'triage'))
         AND (c.epoch >= f.memo_from_epoch OR d.kind <> 'options_memo')
       ORDER BY d.attempt DESC, d.created_at DESC LIMIT 1`,
    )
    .get(fileId, meetingId, kind, ref) as DocumentRow | undefined;
}

/** Check results attached to a document, newest first. */
export const checksOf = (db: Db, documentId: string): DocumentRow[] =>
  db
    .prepare(`SELECT * FROM documents WHERE kind = 'check' AND ref = ? ORDER BY created_at DESC`)
    .all(documentId) as unknown as DocumentRow[];
