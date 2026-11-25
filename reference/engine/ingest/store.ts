// Ingest into the database: index entries to `meetings`; for eligible
// meetings, the transcript, its segments and a queued file. Idempotent: a
// meeting that already has a transcript or a file is never downloaded again.
import { createHash } from 'node:crypto';
import { nowIso, transaction, type Db } from '../db/index.ts';
import { incompleteLine, isSuspectIncomplete } from '../evidence/quality.ts';
import {
  downloadTranscript,
  TranscriptNotReadyError,
  TranscriptRejectedError,
  type DownloadedTranscript,
  type IndexedMeeting,
  type IndexWindow,
} from './un-transcripts.ts';
import { isEligible } from './week.ts';

export interface IngestResult {
  seen: number;
  eligible: number;
  ingested: string[];
  notReady: string[];
  rejected: { id: string; reason: string }[];
  /** Temporary failures (network, UN unavailable): retried on the next run. */
  retryLater: { id: string; reason: string }[];
}

export function upsertMeeting(db: Db, m: IndexedMeeting, at = nowIso()): void {
  db.prepare(
    `INSERT INTO meetings (id, body, session, number, part, date, title, duration_seconds, has_transcript,
       page_url, json_url, index_body, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET title = excluded.title, date = excluded.date,
       duration_seconds = excluded.duration_seconds, has_transcript = excluded.has_transcript,
       page_url = excluded.page_url, json_url = excluded.json_url, index_body = excluded.index_body,
       last_seen_at = excluded.last_seen_at`,
  ).run(
    m.id,
    m.body,
    m.session,
    m.number,
    m.part,
    m.date,
    m.title,
    m.durationSeconds,
    m.hasTranscript ? 1 : 0,
    m.pageUrl,
    m.jsonUrl,
    m.indexBody,
    at,
    at,
  );
  refreshTranscriptQuality(db, m.id, at);
}

const SHORT =
  'Low confidence: the transcript is short for the meeting’s length \\([^)]*\\); part of the proceedings may be missing or silent\\.\\s*';
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The meeting's own line in its file, or its "Resumed part <id>: …" line in the root file. */
const shortLine = (meetingId: string, own: boolean): RegExp =>
  own ? new RegExp('(?<!: )' + SHORT, 'g') : new RegExp('Resumed part ' + escapeRe(meetingId) + ': ' + SHORT, 'g');

/**
 * The short-transcript mark follows the index's duration (2026-11-23): when the index corrects a
 * meeting's length, the mark is computed again. Clearing it removes the line from the file's low-confidence
 * reason (and from a root file's reason for a resumed part); setting it marks the file. Stored documents are
 * not rewritten: the site already shows them without the line. Each change is logged in `settings`.
 */
export function refreshTranscriptQuality(db: Db, meetingId: string, at = nowIso()): 'set' | 'cleared' | null {
  const row = db
    .prepare(
      `SELECT t.characters AS c, t.suspect_incomplete AS s, m.duration_seconds AS d FROM transcripts t
       JOIN meetings m ON m.id = t.meeting_id WHERE t.meeting_id = ?`,
    )
    .get(meetingId) as { c: number; s: number; d: number | null } | undefined;
  if (!row) return null;
  const now = isSuspectIncomplete(row.c, row.d) ? 1 : 0;
  if (now === row.s) return null;
  db.prepare('UPDATE transcripts SET suspect_incomplete = ? WHERE meeting_id = ?').run(now, meetingId);
  const files = db
    .prepare(
      `SELECT id, low_confidence_reason AS r FROM files WHERE meeting_id = ?
       OR meeting_id = (SELECT duplicate_of FROM files WHERE meeting_id = ?)`,
    )
    .all(meetingId, meetingId) as { id: string; r: string | null }[];
  for (const f of files) {
    if (now === 0) {
      const r = (f.r ?? '').replace(shortLine(meetingId, f.id === fileIdFor(meetingId)), '').trim();
      db.prepare('UPDATE files SET low_confidence = ?, low_confidence_reason = ?, updated_at = ? WHERE id = ?').run(
        r ? 1 : 0,
        r || null,
        at,
        f.id,
      );
    } else if (f.id === fileIdFor(meetingId)) {
      const line = incompleteLine(row.c, row.d!);
      const r = f.r?.includes(line) ? f.r : [f.r, line].filter(Boolean).join(' ');
      db.prepare('UPDATE files SET low_confidence = 1, low_confidence_reason = ?, updated_at = ? WHERE id = ?').run(
        r,
        at,
        f.id,
      );
    }
  }
  db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run(
    `quality:${at}:${meetingId}`,
    JSON.stringify({ from: row.s, to: now, characters: row.c, duration_seconds: row.d, files: files.map((f) => f.id) }),
    at,
  );
  return now ? 'set' : 'cleared';
}

export const fileIdFor = (meetingId: string): string => 'file:' + meetingId;

function insertFile(db: Db, meetingId: string, status: 'queued' | 'failed', reason: string | null, at: string): void {
  db.prepare(
    `INSERT INTO files (id, meeting_id, status, status_reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(fileIdFor(meetingId), meetingId, status, reason, at, at);
}

export function storeTranscript(db: Db, meetingId: string, t: DownloadedTranscript, at = nowIso()): void {
  const sha = createHash('sha256').update(JSON.stringify(t.segments)).digest('hex');
  transaction(db, () => {
    db.prepare(
      `INSERT INTO transcripts (meeting_id, url, title, language, statements, characters, segment_count,
         speakers_json, sha256, retrieved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      meetingId,
      t.url,
      t.title,
      t.language,
      t.statements,
      t.characters,
      t.segments.length,
      JSON.stringify(t.speakers),
      sha,
      at,
    );
    const insert = db.prepare(
      `INSERT INTO segments (meeting_id, seq, label, start_seconds, end_seconds, text, speakers_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    t.segments.forEach((s, i) =>
      insert.run(meetingId, i + 1, s.id, s.start, s.end, s.text, JSON.stringify(s.speakers)),
    );
    const meeting = db.prepare('SELECT duration_seconds AS d FROM meetings WHERE id = ?').get(meetingId) as
      { d: number | null } | undefined;
    if (isSuspectIncomplete(t.characters, meeting?.d ?? null))
      db.prepare('UPDATE transcripts SET suspect_incomplete = 1 WHERE meeting_id = ?').run(meetingId);
    insertFile(db, meetingId, 'queued', null, at);
  });
}

function needsWork(db: Db, meetingId: string): boolean {
  const row = db
    .prepare(
      `SELECT (SELECT 1 FROM transcripts WHERE meeting_id = ?) AS t, (SELECT 1 FROM files WHERE meeting_id = ?) AS f`,
    )
    .get(meetingId, meetingId) as { t: number | null; f: number | null };
  return !row.t && !row.f;
}

export async function ingestWindow(
  db: Db,
  window: IndexWindow,
  today: string,
  download: (m: IndexedMeeting) => Promise<DownloadedTranscript> = downloadTranscript,
): Promise<IngestResult> {
  const at = nowIso();
  transaction(db, () => window.meetings.forEach((m) => upsertMeeting(db, m, at)));
  const eligible = window.meetings.filter((m) => isEligible(m, today));
  const result: IngestResult = {
    seen: window.meetings.length,
    eligible: eligible.length,
    ingested: [],
    notReady: [],
    rejected: [],
    retryLater: [],
  };
  for (const m of eligible) {
    if (!needsWork(db, m.id)) continue;
    try {
      storeTranscript(db, m.id, await download(m));
      result.ingested.push(m.id);
    } catch (error) {
      const reason = (error as Error).message;
      if (error instanceof TranscriptNotReadyError) result.notReady.push(m.id);
      else if (error instanceof TranscriptRejectedError) {
        insertFile(db, m.id, 'failed', 'Transcript rejected: ' + reason, nowIso());
        result.rejected.push({ id: m.id, reason });
      } else result.retryLater.push({ id: m.id, reason });
    }
  }
  return result;
}
