// The earlier decision of a file's dossier, for the line mark (2026-11-23; engine/check/line-mark.ts).
import type { Db } from '../db/index.ts';
import { markChange, type Decision, type StandingPosition } from '../check/decision.ts';
import { lineMark } from '../check/line-mark.ts';

/** The decision of the latest event of the dossier before `meetingId` (meeting order), or null. */
export function earlierDecision(db: Db, dossierId: string | null, meetingId: string): Decision | null {
  if (!dossierId) return null;
  const r = db
    .prepare(
      `SELECT d.body_json FROM dossier_events e JOIN files f ON f.id = e.file_id JOIN meetings m ON m.id = f.meeting_id
       JOIN meetings me ON me.id = ? JOIN documents d ON d.id = e.document_id
       WHERE e.dossier_id = ? AND f.meeting_id <> ? AND (m.date < me.date OR (m.date = me.date AND m.id < me.id))
       ORDER BY m.date DESC, m.id DESC LIMIT 1`,
    )
    .get(meetingId, dossierId, meetingId) as { body_json: string } | undefined;
  return r ? (JSON.parse(r.body_json) as Decision) : null;
}

/** The decision with its mark: "first" without a standing position, else by the line rule (earlier decision). */
export const markByLine = (
  ctx: { db: Db; workFile: { dossier_id: string | null }; key: { meetingId: string } },
  d: Decision,
  standing: StandingPosition | null | undefined,
) => lineMark(earlierDecision(ctx.db, ctx.workFile.dossier_id, ctx.key.meetingId), markChange(d, standing));
