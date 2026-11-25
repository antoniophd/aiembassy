// Documents written by the fallback model (2026-11-23). The fallback is of the checker's family, so those
// documents carried low confidence "of the same family as the checker". Now the model checks that cover them are
// sent to a checker of another family (modelFor 'check_fallback'), with a larger token limit (one answer of the
// verifier test was cut at 1,500): the claims of a report (check 7; on a report-level file every claim, never
// gating, as the sample) and the red lines of decision A (check 8). Once every fallback document of a file that
// carries the line is covered by those checks and passed them, the file loses the line. A fallback document no
// model check covers (an opinion, the memo, decision B, the triage, a note, a cable, a press draft) keeps it.
import { nowIso, transaction, type Db } from '../db/index.ts';
import { tallyClaims } from '../queue/plan-full.ts';
import type { FileRow } from './context.ts';
import { acceptedDocument, type DocumentRow } from './documents.ts';

export const CHECK_TOKENS = 1500;
export const SECOND_CHECK_TOKENS = 4000;
export const FALLBACK_LINE = 'Low confidence: written by the fallback model, of the same family as the checker.';

/** Whether a stored document was written on the fallback model. */
export function writtenByFallback(db: Db, doc: Pick<DocumentRow, 'llm_call_id'> | undefined): boolean {
  if (!doc?.llm_call_id) return false;
  const r = db.prepare('SELECT fallback FROM llm_calls WHERE id = ?').get(doc.llm_call_id) as
    { fallback: number } | undefined;
  return !!r?.fallback;
}

/** The checker use and token limit for checking `doc`. */
export function checkerFor(db: Db, doc: Pick<DocumentRow, 'llm_call_id'> | undefined) {
  return writtenByFallback(db, doc)
    ? { use: 'check_fallback' as const, maxTokens: SECOND_CHECK_TOKENS, second: true }
    : { use: 'check' as const, maxTokens: CHECK_TOKENS, second: false };
}

const body = (d: DocumentRow | undefined): Record<string, unknown> =>
  d ? (JSON.parse(d.body_json) as Record<string, unknown>) : {};

/** A check done by the second checker (body flag, set at storage). */
const bySecond = (d: DocumentRow | undefined): boolean => !!d && body(d).second_checker === true;

/** Whether `doc` (an accepted fallback document of the file) is covered by passed checks of the second checker. */
export function coveredBySecondCheck(db: Db, f: FileRow, doc: DocumentRow, redLines: string[]): boolean {
  if (doc.kind === 'report') {
    const claims = (body(doc).claims as unknown[] | undefined) ?? [];
    const checks = claims.map((_, i) => acceptedDocument(db, f.id, doc.meeting_id, 'check', `claim:${doc.id}:${i}`));
    if (!checks.length || !checks.every(bySecond)) return false;
    return tallyClaims(checks.map((c) => String(body(c).verdict))).pass;
  }
  if (doc.kind === 'decision' && doc.ref === 'A') {
    const checks = redLines.map((r) => acceptedDocument(db, f.id, doc.meeting_id, 'check', `redline:${doc.id}:${r}`));
    return checks.length > 0 && checks.every((c) => bySecond(c) && body(c).crosses === false);
  }
  return false;
}

const KINDS = ['triage', 'note', 'report', 'opinion', 'options_memo', 'decision', 'press', 'cable'] as const;

/** The accepted documents of a file (its resumed parts' reports included) that were written by the fallback. */
export function fallbackDocuments(db: Db, f: FileRow): DocumentRow[] {
  const refs = db
    .prepare(
      `SELECT DISTINCT meeting_id, kind, ref FROM documents WHERE file_id = ? AND kind IN (${KINDS.map(() => '?').join(',')})`,
    )
    .all(f.id, ...KINDS) as { meeting_id: string; kind: (typeof KINDS)[number]; ref: string }[];
  return refs
    .map((r) => acceptedDocument(db, f.id, r.meeting_id, r.kind, r.ref))
    .filter((d): d is DocumentRow => !!d && writtenByFallback(db, d));
}

/**
 * Removes the fallback line from the file's low-confidence reason when every accepted fallback document is covered
 * by passed checks of the second checker; logs the change (`fallback-mark:`). Returns whether it changed.
 */
export function refreshFallbackMark(db: Db, fileId: string, redLines: string[], at = nowIso()): boolean {
  return transaction(db, () => {
    const f = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId) as unknown as FileRow | undefined;
    if (!f?.low_confidence || !(f.low_confidence_reason ?? '').includes(FALLBACK_LINE)) return false;
    const docs = fallbackDocuments(db, f);
    const open = docs.filter((d) => !coveredBySecondCheck(db, f, d, redLines));
    if (open.length) return false;
    const reason = (f.low_confidence_reason ?? '').split(FALLBACK_LINE).join('').replace(/\s+/g, ' ').trim();
    db.prepare('UPDATE files SET low_confidence = ?, low_confidence_reason = ?, updated_at = ? WHERE id = ?').run(
      reason ? 1 : 0,
      reason || null,
      at,
      f.id,
    );
    db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run(
      `fallback-mark:${at}:${f.meeting_id}`,
      JSON.stringify({
        cleared: FALLBACK_LINE,
        documents: docs.map((d) => `${d.kind}${d.ref ? ' ' + d.ref : ''}`),
        kept: reason || null,
      }),
      at,
    );
    return true;
  });
}
