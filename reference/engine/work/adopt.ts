// Adoption of a full file: check 9 (stability of the two decisions), the
// same_model rule, the internal-check summary and the dossier update. Only
// adopted decisions update a dossier.
import { randomUUID } from 'node:crypto';
import { nowIso, transaction, type Db } from '../db/index.ts';
import { stable, type Decision } from '../check/decision.ts';
import { claimVerdicts, tallyClaims } from '../queue/plan-full.ts';
import type { FileRow } from './context.ts';
import { acceptedDocument, storeDocument, type DocumentRow } from './documents.ts';

const INTERNAL = {
  provider: 'internal',
  model: 'deterministic',
  usage: { inputTokens: null, outputTokens: null },
  durationMs: 0,
};

const callOf = (db: Db, d: DocumentRow) =>
  db.prepare('SELECT fallback, model_used FROM llm_calls WHERE id = ?').get(d.llm_call_id as string) as {
    fallback: number;
    model_used: string;
  };

export function adoptFile(db: Db, f: FileRow, redLines: string[]): void {
  const accepted = (kind: Parameters<typeof acceptedDocument>[3], ref = '') =>
    acceptedDocument(db, f.id, f.meeting_id, kind, ref) as DocumentRow;
  const report = accepted('report');
  const a = accepted('decision', 'A');
  const b = accepted('decision', 'B');
  const da = JSON.parse(a.body_json) as Decision;
  const db_ = JSON.parse(b.body_json) as Decision;
  const isStable = stable(da, db_);
  const claims = tallyClaims(claimVerdicts(db, f, report) as string[]);
  const redChecks = redLines.map((r) => accepted('check', `redline:${a.id}:${r}`));
  // same_model: the decision and its red-line checks both ended on the fallback model.
  const sameModel = !!callOf(db, a).fallback && redChecks.some((c) => !!callOf(db, c).fallback);
  const reasons = [
    ...(isStable
      ? []
      : ['Low confidence: the two independent decisions differ (option or stands_with); both are kept.']),
    ...(sameModel
      ? ['Low confidence: decision and red-line checks were both produced by the fallback model (same_model).']
      : []),
  ];
  const at = nowIso();
  transaction(db, () => {
    storeDocument(db, {
      fileId: f.id,
      meetingId: f.meeting_id,
      kind: 'check',
      ref: 'internal:' + a.id,
      role: 'check',
      // A file adopted again on the same decision (e.g. reopened for its cable) records a new check.
      attempt: nextAttempt(db, f.id, f.meeting_id, 'internal:' + a.id),
      body: {
        check: 'internal',
        claims,
        red_lines: redChecks.map((c) => JSON.parse(c.body_json)),
        stability: {
          stable: isStable,
          a: { option: da.option, stands_with: da.stands_with },
          b: { option: db_.option, stands_with: db_.stands_with },
        },
        same_model: sameModel,
      },
      text: [
        `Claims: ${claims.supported} supported, ${claims.not_supported} not supported, ${claims.contradicted} contradicted of ${claims.total}.`,
        `Red lines: none crossed (${redLines.join(', ')}).`,
        `Decision stability: ${isStable ? 'the two decisions agree' : 'the two decisions differ'}.`,
        ...(sameModel ? ['same_model: yes.'] : []),
      ].join('\n'),
      promptId: 'check.internal',
      promptVersion: '1.0.0',
      callId: null,
      result: INTERNAL,
      lowConfidence: reasons.length ? reasons.join(' ') : null,
    });
    if (f.dossier_id) {
      db.prepare(
        `UPDATE dossiers SET standing_position = ?, stands_with = ?, interest = ?, red_line = ?, updated_at = ? WHERE id = ?`,
      ).run(
        da.position,
        JSON.stringify(da.stands_with),
        da.interests[0] ?? null,
        da.red_lines[0] ?? null,
        at,
        f.dossier_id,
      );
      db.prepare(
        `INSERT INTO dossier_events (id, dossier_id, file_id, document_id, change, position, stands_with, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (dossier_id, file_id) DO UPDATE SET document_id = excluded.document_id,
           change = excluded.change, position = excluded.position, stands_with = excluded.stands_with,
           created_at = excluded.created_at`,
      ).run(randomUUID(), f.dossier_id, f.id, a.id, da.change, da.position, JSON.stringify(da.stands_with), at);
    }
    db.prepare(`UPDATE files SET status = 'adopted', status_reason = NULL, updated_at = ? WHERE id = ?`).run(at, f.id);
  });
}

/** A document rejected by a later check (claims or red lines): its call is marked and the reason kept. */
export function rejectLater(db: Db, f: FileRow, callId: string, documentId: string, reason: string): void {
  transaction(db, () => {
    db.prepare(`UPDATE llm_calls SET error_kind = 'check', error = ? WHERE id = ?`).run(reason.slice(0, 500), callId);
    storeDocument(db, {
      fileId: f.id,
      meetingId: f.meeting_id,
      kind: 'check',
      ref: 'rejected:' + documentId,
      role: 'check',
      attempt: nextAttempt(db, f.id, f.meeting_id, 'rejected:' + documentId),
      body: { check: 'later_rejection', document: documentId, reason },
      text: reason,
      promptId: 'check.internal',
      promptVersion: '1.0.0',
      callId: null,
      result: INTERNAL,
    });
  });
}

const nextAttempt = (db: Db, fileId: string, meetingId: string, ref: string): number =>
  (
    db
      .prepare(
        `SELECT COALESCE(MAX(attempt), 0) + 1 AS n FROM documents WHERE file_id = ? AND meeting_id = ? AND kind = 'check' AND ref = ?`,
      )
      .get(fileId, meetingId, ref) as { n: number }
  ).n;
