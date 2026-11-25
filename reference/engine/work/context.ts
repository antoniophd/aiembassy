// Read access to one meeting file: the file row, its meeting, transcript and
// segments. Pure reads; no model.
import type { Db } from '../db/index.ts';
import { ownMeeting } from '../evidence/meeting-bounds.ts';
import { incompleteLine } from '../evidence/quality.ts';
import type { SpeakerSpan } from '../evidence/segments.ts';
import type { Body } from '../ingest/scope.ts';

export type FileStatus =
  'queued' | 'triaged' | 'in_progress' | 'adopted' | 'not_adopted' | 'noted' | 'reported' | 'failed';
export type Level = 'note' | 'report' | 'full_file';

export interface FileRow {
  id: string;
  meeting_id: string;
  status: FileStatus;
  status_reason: string | null;
  level: Level | null;
  lead: string | null;
  opinions_json: string | null;
  press: number | null;
  dossier_id: string | null;
  duplicate_of: string | null;
  low_confidence: number;
  low_confidence_reason: string | null;
  epoch: number;
}

export interface MeetingRow {
  id: string;
  body: Body;
  session: number | null;
  number: number;
  part: number;
  date: string;
  title: string;
  duration_seconds: number | null;
}

export interface TranscriptRow {
  meeting_id: string;
  url: string;
  title: string;
  characters: number;
  segment_count: number;
  speakers_json: string;
  sha256: string;
  suspect_incomplete: number;
}

export interface Segment {
  label: string;
  start: number;
  end: number;
  text: string;
  speakers: SpeakerSpan[];
}

export interface MeetingMaterial {
  meeting: MeetingRow;
  transcript: TranscriptRow;
  segments: Segment[];
  speakers: SpeakerSpan[];
  /** The one-line low-confidence notice, or null. */
  lowConfidenceLine: string | null;
}

export const getFile = (db: Db, id: string): FileRow | undefined =>
  db.prepare('SELECT * FROM files WHERE id = ?').get(id) as FileRow | undefined;

export const fileForMeeting = (db: Db, meetingId: string): FileRow | undefined =>
  db.prepare('SELECT * FROM files WHERE meeting_id = ?').get(meetingId) as FileRow | undefined;

export function loadMaterial(db: Db, meetingId: string): MeetingMaterial {
  const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId) as MeetingRow | undefined;
  const transcript = db.prepare('SELECT * FROM transcripts WHERE meeting_id = ?').get(meetingId) as
    TranscriptRow | undefined;
  if (!meeting || !transcript) throw Error('No transcript stored for ' + meetingId);
  const segments = (
    db.prepare('SELECT * FROM segments WHERE meeting_id = ? ORDER BY seq').all(meetingId) as {
      label: string;
      start_seconds: number;
      end_seconds: number;
      text: string;
      speakers_json: string;
    }[]
  ).map((s) => ({
    label: s.label,
    start: s.start_seconds,
    end: s.end_seconds,
    text: s.text,
    speakers: JSON.parse(s.speakers_json) as SpeakerSpan[],
  }));
  // Only the meeting itself when the recording also holds another Council meeting (2026-11-23).
  const own = ownMeeting(meeting.body, meeting.number, segments, JSON.parse(transcript.speakers_json) as SpeakerSpan[]);
  return {
    meeting,
    transcript,
    segments: own.segments,
    speakers: own.speakers,
    lowConfidenceLine:
      transcript.suspect_incomplete && meeting.duration_seconds
        ? incompleteLine(transcript.characters, meeting.duration_seconds)
        : null,
  };
}

/** Distinct speaker labels with how many statements each made. */
export function speakerList(speakers: SpeakerSpan[]): { label: string; statements: number }[] {
  const counts = new Map<string, number>();
  for (const s of speakers) counts.set(s.label, (counts.get(s.label) ?? 0) + 1);
  return [...counts].map(([label, statements]) => ({ label, statements }));
}
