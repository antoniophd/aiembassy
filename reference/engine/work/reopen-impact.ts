// What a reopening does to the rest of a dossier (2026-11-25), shown by cli/reopen before it acts.
// Positions are built in meeting order (2026-11-13): reopening a full file sends back every later
// meeting of its dossier. A later file with a position loses it and decides again; a later file still in work
// waits until the reopened one is finished. Pure reads.
import type { Db } from '../db/index.ts';

export interface DossierImpact {
  /** The meeting reopened. */
  meetingId: string;
  dossierId: string;
  /** Later meetings of the dossier whose position (dossier event) is removed; they decide again. */
  losePosition: string[];
  /** Later meetings of the dossier still in work: they wait for the reopened one before deciding. */
  wait: string[];
}

export function dossierImpact(db: Db, meetingIds: string[]): DossierImpact[] {
  const out: DossierImpact[] = [];
  for (const id of meetingIds) {
    const f = db
      .prepare(
        `SELECT f.id, f.dossier_id, m.date FROM files f JOIN meetings m ON m.id = f.meeting_id WHERE f.meeting_id = ?`,
      )
      .get(id) as { id: string; dossier_id: string | null; date: string } | undefined;
    if (!f?.dossier_id) continue;
    const later = db
      .prepare(
        `SELECT x.meeting_id, x.status, EXISTS (SELECT 1 FROM dossier_events e WHERE e.file_id = x.id) AS has_event
         FROM files x JOIN meetings mx ON mx.id = x.meeting_id
         WHERE x.dossier_id = ? AND x.id <> ? AND (mx.date > ? OR (mx.date = ? AND mx.id > ?))
         ORDER BY mx.date, mx.id`,
      )
      .all(f.dossier_id, f.id, f.date, f.date, id) as { meeting_id: string; status: string; has_event: number }[];
    const others = later.filter((x) => !meetingIds.includes(x.meeting_id));
    const losePosition = others.filter((x) => x.has_event).map((x) => x.meeting_id);
    const wait = others
      .filter((x) => !x.has_event && ['queued', 'triaged', 'in_progress'].includes(x.status))
      .map((x) => x.meeting_id);
    if (losePosition.length || wait.length) out.push({ meetingId: id, dossierId: f.dossier_id, losePosition, wait });
  }
  return out;
}

/** The impact in plain lines, for the confirmation. */
export const impactLines = (impact: DossierImpact[]): string[] =>
  impact.flatMap((i) => [
    `${i.meetingId} (${i.dossierId}):`,
    ...(i.losePosition.length ? [`  lose their position and decide again: ${i.losePosition.join(', ')}`] : []),
    ...(i.wait.length ? [`  wait until ${i.meetingId} is finished: ${i.wait.join(', ')}`] : []),
  ]);
