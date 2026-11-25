// The full-file pipeline after the meeting report: claim checks,
// opinions, options memo, two independent decisions, red-line checks, press
// product, then adoption. Pure reads.
import type { Db } from '../db/index.ts';
import type { Decision } from '../check/decision.ts';
import type { FileRow } from '../work/context.ts';
import { CABLE_TRIES, cableRejections } from '../work/cable-task.ts';
import { NO_PACK_NOTE, PACK_REF, PACK_TRIES, packRejections } from '../work/press-pack-task.ts';
import { acceptedDocument, type DocumentRow } from '../work/documents.ts';

/** More than this share of not_supported claims fails the report (DESIGN check 7). */
export const MAX_NOT_SUPPORTED = 0.1;

export type FullStep =
  | { kind: 'task'; task: 'claim' | 'opinion' | 'memo' | 'decision' | 'redline' | 'press' | 'cable'; ref: string }
  | { kind: 'reject'; callId: string; reason: string; documentId: string }
  | { kind: 'adopt'; note?: string }
  | { kind: 'wait' };

export interface ClaimTally {
  total: number;
  supported: number;
  not_supported: number;
  contradicted: number;
  pass: boolean;
}

export function tallyClaims(verdicts: string[]): ClaimTally {
  const n = (v: string) => verdicts.filter((x) => x === v).length;
  const t = {
    total: verdicts.length,
    supported: n('supported'),
    not_supported: n('not_supported'),
    contradicted: n('contradicted'),
    pass: false,
  };
  t.pass = t.contradicted === 0 && t.not_supported <= MAX_NOT_SUPPORTED * t.total;
  return t;
}

const verdictOf = (d: DocumentRow | undefined): string | null =>
  d ? String((JSON.parse(d.body_json) as { verdict?: string }).verdict) : null;

export function claimVerdicts(db: Db, f: FileRow, report: DocumentRow): (string | null)[] {
  const claims = (JSON.parse(report.body_json) as { claims: unknown[] }).claims;
  return claims.map((_, i) => verdictOf(acceptedDocument(db, f.id, f.meeting_id, 'check', `claim:${report.id}:${i}`)));
}

/** An earlier meeting's file in the same dossier that is not finished yet. */
export function earlierInDossier(db: Db, f: FileRow): boolean {
  if (!f.dossier_id) return false;
  return !!db
    .prepare(
      `SELECT 1 FROM files x JOIN meetings mx ON mx.id = x.meeting_id JOIN meetings m ON m.id = ?
       WHERE x.dossier_id = ? AND x.id <> ? AND x.status IN ('queued','triaged','in_progress')
         AND (mx.date < m.date OR (mx.date = m.date AND mx.id < m.id))`,
    )
    .get(f.meeting_id, f.dossier_id, f.id);
}

/** The next full-file step, or null when the file waits (never when work is left). */
export function nextFullStep(db: Db, f: FileRow, profileRedLines: string[]): FullStep {
  const accepted = (kind: Parameters<typeof acceptedDocument>[3], ref = '') =>
    acceptedDocument(db, f.id, f.meeting_id, kind, ref);
  const report = accepted('report') as DocumentRow;

  // 7 · claim by claim.
  const verdicts = claimVerdicts(db, f, report);
  const missing = verdicts.findIndex((v) => v === null);
  if (missing >= 0) return { kind: 'task', task: 'claim', ref: `claim:${report.id}:${missing}` };
  const tally = tallyClaims(verdicts as string[]);
  if (!tally.pass) {
    const claims = (JSON.parse(report.body_json) as { claims: { claim: string; cite: string }[] }).claims;
    const bad = claims
      .map((c, i) => ({ ...c, v: verdicts[i] }))
      .filter((c) => c.v !== 'supported')
      .map((c) => `${c.v}: "${c.claim.slice(0, 120)}" [${c.cite}]`);
    return {
      kind: 'reject',
      callId: report.llm_call_id as string,
      documentId: report.id,
      reason: `Claim check failed (${tally.contradicted} contradicted, ${tally.not_supported} of ${tally.total} not supported) | ${bad.join(' | ')}`,
    };
  }

  for (const role of JSON.parse(f.opinions_json ?? '[]') as string[])
    if (!accepted('opinion', role)) return { kind: 'task', task: 'opinion', ref: role };
  if (!accepted('options_memo')) return { kind: 'task', task: 'memo', ref: '' };

  // Positions are built in the order the meetings happened: a file decides only once every earlier file
  // of its dossier is finished (2026-11-13).
  if (!accepted('decision', 'A') && earlierInDossier(db, f)) return { kind: 'wait' };

  // Two independent decisions (9 · stability compares them at adoption).
  const a = accepted('decision', 'A');
  if (!a) return { kind: 'task', task: 'decision', ref: 'A' };
  if (!accepted('decision', 'B')) return { kind: 'task', task: 'decision', ref: 'B' };

  // 8 · red lines, closed questions, on the decision that stands.
  for (const r of profileRedLines) {
    const doc = accepted('check', `redline:${a.id}:${r}`);
    if (!doc) return { kind: 'task', task: 'redline', ref: `redline:${a.id}:${r}` };
    if ((JSON.parse(doc.body_json) as { crosses?: boolean }).crosses)
      return {
        kind: 'reject',
        callId: a.llm_call_id as string,
        documentId: a.id,
        reason: `Decision crosses red line ${r}`,
      };
  }

  const d = JSON.parse(a.body_json) as Decision;
  // On a point already taken, only a high-profile triage calls for press (2026-11-13).
  const triage = accepted('triage');
  const taken =
    (triage && (JSON.parse(triage.body_json) as { decisionStatus?: { status?: string } }).decisionStatus?.status) ===
    'already_taken';
  const publicLine = (d.press !== 'none' && !taken) || !!f.press;
  // The statement or explanation of vote only when the decision takes the floor; the press pack whenever a
  // public line is asked for (2026-11-25).
  if (publicLine && d.takes_floor && !accepted('press')) return { kind: 'task', task: 'press', ref: '' };
  const notes: string[] = [];
  if (publicLine && !accepted('press', PACK_REF)) {
    if (packRejections(db, f.id, f.meeting_id, f.epoch) < PACK_TRIES)
      return { kind: 'task', task: 'press', ref: PACK_REF };
    notes.push(NO_PACK_NOTE);
  }
  // The cable, after the decision (2026-11-13). Two rejections: the file goes on without it, noted.
  if (!accepted('cable')) {
    if (cableRejections(db, f.id, f.meeting_id, f.epoch) < CABLE_TRIES) return { kind: 'task', task: 'cable', ref: '' };
    notes.push('No cable: it failed its checks twice.');
  }
  return notes.length ? { kind: 'adopt', note: notes.join(' ') } : { kind: 'adopt' };
}
