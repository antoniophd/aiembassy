// Reopening failed files after a prompt, check or model change (a build-time
// tool, like the regression set: no person reviews or edits any document).
// The work file's epoch goes up by one, so its unfinished tasks start a new
// ladder of attempts. Nothing is deleted or rewritten: earlier calls stay in
// the ledger (never resent) and accepted documents stay accepted (segment
// summaries are reused).
import { nowIso, transaction, type Db } from '../db/index.ts';
import { getFile, type FileRow, type FileStatus } from './context.ts';
import { acceptedDocument } from './documents.ts';

export interface Reopened {
  meetingId: string;
  from: FileStatus;
  to: FileStatus;
  epoch: number;
}

const REOPENABLE: FileStatus[] = ['not_adopted', 'failed'];

/** The file that holds the documents: the first part's file for a resumed part. */
function workFileOf(db: Db, f: FileRow): FileRow {
  if (!f.duplicate_of) return f;
  return (db.prepare('SELECT * FROM files WHERE meeting_id = ?').get(f.duplicate_of) as unknown as FileRow) ?? f;
}

/** Where a reopened file resumes, from what is already settled. */
function resumeStatus(f: FileRow): FileStatus {
  if (!f.level) return 'queued'; // triage never completed
  if (f.duplicate_of || f.level === 'note') return 'triaged';
  return 'in_progress';
}

export function reopenFiles(db: Db, meetingIds: string[], reason: string): Reopened[] {
  return transaction(db, () => {
    const out: Reopened[] = [];
    const bumped = new Set<string>();
    for (const id of meetingIds) {
      const f = db.prepare('SELECT * FROM files WHERE meeting_id = ?').get(id) as unknown as FileRow | undefined;
      if (!f) throw Error('No file for ' + id);
      if (!REOPENABLE.includes(f.status)) throw Error(`${id} is ${f.status}; only not_adopted or failed files reopen`);
      const work = workFileOf(db, f);
      if (!bumped.has(work.id)) {
        db.prepare('UPDATE files SET epoch = epoch + 1, updated_at = ? WHERE id = ?').run(nowIso(), work.id);
        bumped.add(work.id);
      }
      const to = resumeStatus(f);
      db.prepare('UPDATE files SET status = ?, status_reason = ?, updated_at = ? WHERE id = ?').run(
        to,
        `Reopened (${reason}); previously ${f.status}: ${f.status_reason ?? ''}`.slice(0, 500),
        nowIso(),
        f.id,
      );
      out.push({ meetingId: id, from: f.status, to, epoch: (getFile(db, work.id) as FileRow).epoch });
      // A reopened full file earlier than decisions already in its dossier: those later events are logged and
      // removed, and their files decide again after this one (2026-11-19).
      if (work.level === 'full_file' && work.dossier_id && laterEvents(db, work.dossier_id, work.meeting_id))
        rewindFrom(db, work.dossier_id, work.meeting_id, work.id);
    }
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`).run(
      'reopen:' + nowIso(),
      JSON.stringify({ reason, files: out }),
      nowIso(),
    );
    return out;
  });
}

/** Whether the dossier holds events of meetings after this one. */
function laterEvents(db: Db, dossierId: string, meetingId: string): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM dossier_events e JOIN files x ON x.id = e.file_id JOIN meetings mx ON mx.id = x.meeting_id
       JOIN meetings m ON m.id = ? WHERE e.dossier_id = ? AND (mx.date > m.date OR (mx.date = m.date AND mx.id > m.id))`,
    )
    .get(meetingId, dossierId);
}

/**
 * Restarts a file from triage (e.g. its triage was written by a model or
 * prompt that is no longer valid). New epoch; documents of earlier epochs stay
 * stored but no longer count as accepted. A first part with resumed parts
 * linked to it cannot be restarted alone.
 */
export function restartFile(db: Db, meetingId: string, reason: string): Reopened {
  return transaction(db, () => {
    const f = db.prepare('SELECT * FROM files WHERE meeting_id = ?').get(meetingId) as unknown as FileRow | undefined;
    if (!f) throw Error('No file for ' + meetingId);
    if (f.duplicate_of) throw Error(`${meetingId} is a resumed part of ${f.duplicate_of}; restart that file`);
    const parts = db.prepare('SELECT COUNT(*) AS n FROM files WHERE duplicate_of = ?').get(meetingId) as { n: number };
    if (parts.n) throw Error(`${meetingId} has resumed parts linked to it; restart is not supported for it`);
    // The dossier goes back to its state before this meeting, as for a rework (2026-11-23).
    const previous = rewindDossier(db, f, meetingId);
    db.prepare(
      `UPDATE files SET epoch = epoch + 1, accept_from_epoch = epoch + 1, status = 'queued', status_reason = ?,
         low_confidence = 0, low_confidence_reason = NULL, dossier_id = NULL, updated_at = ? WHERE id = ?`,
    ).run(`Restarted (${reason}); previously ${f.status}`.slice(0, 500), nowIso(), f.id);
    const out: Reopened = { meetingId, from: f.status, to: 'queued', epoch: f.epoch + 1 };
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`).run(
      'restart:' + nowIso(),
      JSON.stringify({ reason, file: out, previous_event: previous }),
      nowIso(),
    );
    return out;
  });
}

const DECISION_REASONS = [
  'Low confidence: the two independent decisions differ (option or stands_with); both are kept.',
  'Low confidence: decision and red-line checks were both produced by the fallback model (same_model).',
];

/**
 * Re-decides an adopted or not-adopted full file after a decision-rule change:
 * new epoch from which decisions, red-line checks and press count; report,
 * claims, opinions and memo stay accepted. The dossier goes back to its state
 * before this file (the file must be its latest event); the old event is kept
 * in the log and replaced at adoption.
 */
export function redecideFile(db: Db, meetingId: string, reason: string, fromMemo = false): Reopened {
  return transaction(db, () => {
    const f = decidedFile(db, meetingId);
    const previous = rewindDossier(db, f, meetingId);
    const kept = keptReasons(db, f, fromMemo ? ['options_memo'] : []);
    db.prepare(
      `UPDATE files SET epoch = epoch + 1, decide_from_epoch = epoch + 1,
         memo_from_epoch = CASE WHEN ? THEN epoch + 1 ELSE memo_from_epoch END, status = 'in_progress',
         status_reason = ?, low_confidence = ?, low_confidence_reason = ?, updated_at = ? WHERE id = ?`,
    ).run(
      fromMemo ? 1 : 0,
      `${fromMemo ? 'Redone from the memo' : 'Re-decided'} (${reason}); previously ${f.status}`.slice(0, 500),
      kept ? 1 : 0,
      kept || null,
      nowIso(),
      f.id,
    );
    const out: Reopened = { meetingId, from: f.status, to: 'in_progress', epoch: f.epoch + 1 };
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`).run(
      'redecide:' + nowIso() + ':' + meetingId,
      JSON.stringify({ reason, file: out, previous_event: previous }),
      nowIso(),
    );
    return out;
  });
}

/**
 * Reworks a decided full file from its triage after a triage, report or
 * later rule change: new epoch from which every document counts again,
 * except the segment summaries, which are reused. The dossier goes back to
 * its state before this file, as for a re-decision. A first part with
 * resumed parts linked to it cannot be reworked alone.
 */
export function reworkFile(db: Db, meetingId: string, reason: string, hold = false): Reopened {
  return transaction(db, () => {
    const f = finishedFile(db, meetingId);
    if (f.duplicate_of) throw Error(`${meetingId} is a resumed part of ${f.duplicate_of}; rework that file`);
    const previous = rewindDossier(db, f, meetingId);
    db.prepare(
      `UPDATE files SET epoch = epoch + 1, rework_from_epoch = epoch + 1, decide_from_epoch = epoch + 1,
         status = 'queued', status_reason = ?, low_confidence = 0, low_confidence_reason = NULL, updated_at = ?,
         hold_after_triage = ?
       WHERE id = ?`,
    ).run(`Reworked from triage (${reason}); previously ${f.status}`.slice(0, 500), nowIso(), hold ? 1 : 0, f.id);
    // Resumed parts write their reports into this file: they are redone too, after the root's triage.
    db.prepare(
      `UPDATE files SET status = 'triaged', status_reason = ?, updated_at = ? WHERE duplicate_of = ?
       AND status IN ('reported','noted','not_adopted','failed')`,
    ).run(`Root ${meetingId} reworked`, nowIso(), meetingId);
    const out: Reopened = { meetingId, from: f.status, to: 'queued', epoch: f.epoch + 1 };
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`).run(
      'rework:' + nowIso() + ':' + meetingId,
      JSON.stringify({ reason, file: out, previous_event: previous }),
      nowIso(),
    );
    return out;
  });
}

/**
 * Reworks a finished file from its report: the triage and the segment summaries are kept; report, claims,
 * opinions, memo, decisions, red lines, press and cable are redone. Optionally held until released, like the
 * files reworked from triage (2026-11-13).
 */
export function reworkFromReport(db: Db, meetingId: string, reason: string, hold = false): Reopened {
  return transaction(db, () => {
    const f = finishedFile(db, meetingId);
    if (f.duplicate_of) throw Error(`${meetingId} is a resumed part of ${f.duplicate_of}; rework that file`);
    const previous = rewindDossier(db, f, meetingId);
    db.prepare(
      `UPDATE files SET epoch = epoch + 1, report_from_epoch = epoch + 1, decide_from_epoch = epoch + 1,
         memo_from_epoch = epoch + 1, status = 'triaged', status_reason = ?, low_confidence = 0,
         low_confidence_reason = NULL, hold_after_triage = ?, updated_at = ? WHERE id = ?`,
    ).run(`Reworked from the report (${reason}); previously ${f.status}`.slice(0, 500), hold ? 1 : 0, nowIso(), f.id);
    db.prepare(
      `UPDATE files SET status = 'triaged', status_reason = ?, updated_at = ? WHERE duplicate_of = ?
       AND status IN ('reported','noted','not_adopted','failed')`,
    ).run(`Root ${meetingId} reworked`, nowIso(), meetingId);
    const out: Reopened = { meetingId, from: f.status, to: 'triaged', epoch: f.epoch + 1 };
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`).run(
      'rework-report:' + nowIso() + ':' + meetingId,
      JSON.stringify({ reason, file: out, previous_event: previous }),
      nowIso(),
    );
    return out;
  });
}

/**
 * Gives a finished file its missing cable: a new epoch, so the cable's two tries start again; every
 * accepted document stays accepted (2026-11-13).
 */
export function recableFile(db: Db, meetingId: string, reason: string, replace = false): Reopened {
  return transaction(db, () => {
    const f = finishedFile(db, meetingId);
    // Replacing an accepted cable: it is rejected later with the reason (kept, no longer counts).
    if (replace) {
      const c = acceptedDocument(db, f.id, f.meeting_id, 'cable');
      if (c?.llm_call_id) {
        db.prepare(`UPDATE llm_calls SET error_kind = 'check', error = ? WHERE id = ?`).run(
          `Replaced: ${reason}`.slice(0, 500),
          c.llm_call_id,
        );
        db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`).run(
          'cable-replaced:' + nowIso() + ':' + meetingId,
          JSON.stringify({ reason, document: c.id }),
          nowIso(),
        );
      }
    }
    if (!['adopted', 'reported'].includes(f.status))
      throw Error(`${meetingId} is ${f.status}; only adopted or reported files get a cable`);
    const status = 'in_progress';
    db.prepare(`UPDATE files SET epoch = epoch + 1, status = ?, status_reason = ?, updated_at = ? WHERE id = ?`).run(
      status,
      `Reopened for its cable (${reason}); previously ${f.status}`.slice(0, 500),
      nowIso(),
      f.id,
    );
    const out: Reopened = { meetingId, from: f.status, to: status, epoch: f.epoch + 1 };
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`).run(
      'recable:' + nowIso() + ':' + meetingId,
      JSON.stringify({ reason, file: out }),
      nowIso(),
    );
    return out;
  });
}

function decidedFile(db: Db, meetingId: string): FileRow {
  const f = db.prepare('SELECT * FROM files WHERE meeting_id = ?').get(meetingId) as unknown as FileRow | undefined;
  if (!f) throw Error('No file for ' + meetingId);
  if (f.level !== 'full_file' || !['adopted', 'not_adopted'].includes(f.status))
    throw Error(`${meetingId} is ${f.level} ${f.status}; only decided full files are re-decided or reworked`);
  return f;
}

/** A file whose work is finished (any level): what a rework from triage accepts. */
function finishedFile(db: Db, meetingId: string): FileRow {
  const f = db.prepare('SELECT * FROM files WHERE meeting_id = ?').get(meetingId) as unknown as FileRow | undefined;
  if (!f) throw Error('No file for ' + meetingId);
  if (!['adopted', 'not_adopted', 'reported', 'noted'].includes(f.status))
    throw Error(`${meetingId} is ${f.status}; only finished files are reworked`);
  return f;
}

/** Puts the dossier back to its state before this file; returns this file's event (kept in the log). */
function rewindDossier(db: Db, f: FileRow, meetingId: string): unknown {
  if (!f.dossier_id) return null;
  return rewindFrom(db, f.dossier_id, meetingId, f.id);
}

/**
 * Takes a dossier back to its state before `meetingId`. Used when a file is reworked, and by the triage when
 * a meeting joins a dossier that already holds decisions of later meetings.
 */
export function rewindFrom(db: Db, dossierId: string, meetingId: string, fileId: string | null): unknown {
  const f = { id: fileId ?? '', dossier_id: dossierId };
  // The dossier goes back to its state before this meeting. Events of this meeting and of every later meeting
  // are logged (settings `dossier-log:`) and removed; the later files decide again, in meeting order, once this
  // one is finished (plan-full: earlierInDossier). 2026-11-13: positions are built in the order the
  // meetings happened.
  const events = db
    .prepare(
      `SELECT e.*, m.date, m.id AS meeting FROM dossier_events e JOIN files x ON x.id = e.file_id
       JOIN meetings m ON m.id = x.meeting_id WHERE e.dossier_id = ? ORDER BY m.date, m.id`,
    )
    .all(f.dossier_id) as {
    id: string;
    file_id: string;
    position: string;
    stands_with: string;
    date: string;
    meeting: string;
  }[];
  const own = db.prepare('SELECT date FROM meetings WHERE id = ?').get(meetingId) as { date: string };
  const later = (e: (typeof events)[number]) =>
    e.file_id === f.id || e.date > own.date || (e.date === own.date && e.meeting > meetingId);
  const removed = events.filter(later);
  const before = events.filter((e) => !later(e)).at(-1);
  if (removed.length) {
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`).run(
      `dossier-log:${nowIso()}:${f.dossier_id}:${meetingId}`,
      JSON.stringify({ rewound_for: meetingId, events: removed }),
      nowIso(),
    );
    for (const e of removed) db.prepare('DELETE FROM dossier_events WHERE id = ?').run(e.id);
  }
  db.prepare(
    `UPDATE dossiers SET standing_position = ?, stands_with = ?, interest = NULL, red_line = NULL, updated_at = ? WHERE id = ?`,
  ).run(before?.position ?? null, before?.stands_with ?? null, nowIso(), f.dossier_id);
  // Later decided files of the dossier decide again (decisions, red lines, press, cable).
  for (const e of removed.filter((e) => e.file_id !== f.id)) {
    const x = db.prepare('SELECT * FROM files WHERE id = ?').get(e.file_id) as unknown as FileRow;
    // A stale event (its file now belongs to another dossier, or to none) is only removed.
    if (x.dossier_id !== f.dossier_id) continue;
    if (!['adopted', 'not_adopted'].includes(x.status)) continue;
    const kept = keptReasons(db, x);
    db.prepare(
      `UPDATE files SET epoch = epoch + 1, decide_from_epoch = epoch + 1, status = 'in_progress', status_reason = ?,
         low_confidence = ?, low_confidence_reason = ?, updated_at = ? WHERE id = ?`,
    ).run(
      `Re-decided after the earlier meeting ${meetingId} was reworked; previously ${x.status}`.slice(0, 500),
      kept ? 1 : 0,
      kept || null,
      nowIso(),
      x.id,
    );
  }
  return events.find((e) => e.file_id === f.id) ?? null;
}

/**
 * The file's low-confidence reasons that survive a re-decision: those of the
 * adoption (stability, same_model) and those that only decisions, red-line
 * checks or press products carried (e.g. a decision written by the fallback)
 * are dropped; reasons of the triage, report or opinions stay.
 */
export function keptReasons(db: Db, f: FileRow, redone: string[] = []): string {
  const docs = db
    .prepare(
      `SELECT d.kind, d.ref, d.low_confidence_reason AS r FROM documents d LEFT JOIN llm_calls c ON c.id = d.llm_call_id
       WHERE d.file_id = ? AND d.low_confidence = 1 AND (c.id IS NULL OR c.error_kind IS NULL)`,
    )
    .all(f.id) as { kind: string; ref: string; r: string }[];
  const decisionOnly = (r: string) => {
    const from = docs.filter((d) => d.r?.includes(r));
    return (
      from.length > 0 &&
      from.every(
        (d) => ['decision', 'press', 'cable', ...redone].includes(d.kind) || /^(redline|internal):/.test(d.ref),
      )
    );
  };
  return (f.low_confidence_reason ?? '')
    .split(/(?<=\.)\s+(?=Low confidence:)/)
    .map((r) => r.trim())
    .filter((r) => r && !DECISION_REASONS.includes(r) && !decisionOnly(r))
    .join(' ');
}
