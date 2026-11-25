// Coherence of the dossiers' timelines (2026-11-13, step 5 of the
// reprocess): checked at the end, and stale events (left by an earlier
// re-decision of a file that changed dossier) removed with a log entry.
import { nowIso, transaction, type Db } from '../db/index.ts';

export interface DossierIssue {
  dossier: string;
  meeting: string;
  issue: 'stale' | 'first_not_first' | 'later_marked_first';
}

/**
 * Coherence of each dossier's timeline (2026-11-13, step 5): events in meeting order; the first is
 * "first", no later one is; no event of a file that now belongs to another dossier.
 */
export function dossierIssues(db: Db): DossierIssue[] {
  const ev = db
    .prepare(
      `SELECT e.dossier_id, e.change, f.dossier_id AS fd, f.meeting_id FROM dossier_events e
       JOIN files f ON f.id = e.file_id JOIN meetings m ON m.id = f.meeting_id ORDER BY e.dossier_id, m.date, m.id`,
    )
    .all() as { dossier_id: string; change: string; fd: string | null; meeting_id: string }[];
  const out: DossierIssue[] = [];
  const seen = new Set<string>();
  for (const e of ev) {
    if (e.fd !== e.dossier_id) {
      out.push({ dossier: e.dossier_id, meeting: e.meeting_id, issue: 'stale' });
      continue;
    }
    const first = !seen.has(e.dossier_id);
    seen.add(e.dossier_id);
    if (first && e.change !== 'first')
      out.push({ dossier: e.dossier_id, meeting: e.meeting_id, issue: 'first_not_first' });
    if (!first && e.change === 'first')
      out.push({ dossier: e.dossier_id, meeting: e.meeting_id, issue: 'later_marked_first' });
  }
  return out;
}

/** Removes stale events (logged); each affected dossier keeps its latest valid position. */
export function removeStaleEvents(db: Db): number {
  return transaction(db, () => {
    const stale = dossierIssues(db).filter((i) => i.issue === 'stale');
    for (const s of stale) {
      const e = db
        .prepare(
          `SELECT e.* FROM dossier_events e JOIN files f ON f.id = e.file_id WHERE e.dossier_id = ? AND f.meeting_id = ?`,
        )
        .get(s.dossier, s.meeting) as { id: string } & Record<string, unknown>;
      db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`).run(
        `dossier-log:${nowIso()}:${s.dossier}:${s.meeting}:stale`,
        JSON.stringify({ stale: true, event: e }),
        nowIso(),
      );
      db.prepare('DELETE FROM dossier_events WHERE id = ?').run(e.id);
      const last = db
        .prepare(
          `SELECT e.position, e.stands_with FROM dossier_events e JOIN files f ON f.id = e.file_id
           JOIN meetings m ON m.id = f.meeting_id WHERE e.dossier_id = ? ORDER BY m.date DESC, m.id DESC LIMIT 1`,
        )
        .get(s.dossier) as { position: string; stands_with: string } | undefined;
      db.prepare('UPDATE dossiers SET standing_position = ?, stands_with = ?, updated_at = ? WHERE id = ?').run(
        last?.position ?? null,
        last?.stands_with ?? null,
        nowIso(),
        s.dossier,
      );
    }
    return stale.length;
  });
}
