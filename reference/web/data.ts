// Read-only queries for the site. Only accepted documents are shown.
import { onceDraftsNotRead } from '../engine/check/language.ts';
import type { Db } from '../engine/db/index.ts';
import { BODY_LABELS, offsetDate, weekStart, type Body } from '../engine/ingest/scope.ts';
import { meetingRef } from '../engine/ingest/scope.ts';
export { meetingRef };
import { acceptedDocument, type DocKind, type DocumentRow } from '../engine/work/documents.ts';

export interface MeetingRow {
  id: string;
  body: Body;
  date: string;
  title: string;
  duration_seconds: number;
  page_url: string;
  file_id: string;
  level: 'note' | 'report' | 'full_file' | null;
  status: string;
  status_reason: string | null;
  duplicate_of: string | null;
  dossier_id: string | null;
  low_confidence: number;
  low_confidence_reason: string | null;
  opinions_json: string | null;
  /** Shown as its triage (a file that failed for good before an accepted report). */
  triage_note?: boolean;
}

const MEETING_SELECT = `SELECT m.id, m.body, m.date, m.title, m.duration_seconds, m.page_url, f.id AS file_id, f.level,
  f.status, f.status_reason, f.duplicate_of, f.dossier_id, f.low_confidence, f.low_confidence_reason, f.opinions_json
  FROM meetings m JOIN files f ON f.meeting_id = m.id`;

export const bodyLabel = (b: string): string => BODY_LABELS[b as Body] ?? b;

export function updatedAt(db: Db): string | null {
  const r = db
    .prepare(
      `SELECT finished_at FROM runs WHERE outcome = 'completed' AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`,
    )
    .get() as { finished_at: string } | undefined;
  if (!r) return null;
  const [d, t] = r.finished_at.split('T') as [string, string];
  const [, m, day] = d.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[Number(m) - 1]} ${Number(day)}, ${t.slice(0, 5)}`;
}

/** Weeks (Monday) that have at least one meeting with a file, newest first. */
export function weeks(db: Db): string[] {
  const dates = (
    db.prepare(`SELECT DISTINCT m.date FROM meetings m JOIN files f ON f.meeting_id = m.id`).all() as {
      date: string;
    }[]
  ).map((r) => weekStart(r.date));
  return [...new Set(dates)].sort().reverse();
}

/** Meetings with a file in each week (Monday → count), for the week selector (2026-11-23). */
export function weekCounts(db: Db): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of db.prepare(`SELECT m.date FROM meetings m JOIN files f ON f.meeting_id = m.id`).all() as {
    date: string;
  }[])
    out.set(weekStart(r.date), (out.get(weekStart(r.date)) ?? 0) + 1);
  return out;
}

/** The week shown by default: the newest with a finished file. */
/** The week in course, shown even when half done (2026-11-13); else the latest week with work. */
export function defaultWeek(db: Db, today = new Date().toISOString().slice(0, 10)): string | null {
  const current = weekStart(today);
  if (weeks(db).includes(current)) return current;
  const r = db
    .prepare(
      `SELECT MAX(m.date) AS d FROM meetings m JOIN files f ON f.meeting_id = m.id
       WHERE f.status IN ('noted','reported','adopted','not_adopted')`,
    )
    .get() as { d: string | null };
  return r.d ? weekStart(r.d) : (weeks(db)[0] ?? null);
}

export function weekMeetings(db: Db, monday: string): MeetingRow[] {
  return (
    db
      .prepare(`${MEETING_SELECT} WHERE m.date BETWEEN ? AND ? ORDER BY m.date DESC, m.id DESC`)
      .all(monday, offsetDate(monday, 6)) as unknown as MeetingRow[]
  ).map((m) => publicView(db, m));
}

/** One meeting as the public pages show it (`publicView`). */
export function meeting(db: Db, id: string): MeetingRow | undefined {
  const m = db.prepare(`${MEETING_SELECT} WHERE m.id = ?`).get(id) as MeetingRow | undefined;
  return m ? publicView(db, m) : undefined;
}

export const doc = (db: Db, m: Pick<MeetingRow, 'file_id' | 'id'>, kind: DocKind, ref = ''): DocumentRow | undefined =>
  acceptedDocument(db, m.file_id, m.id, kind, ref);

export const body = <T>(d: DocumentRow | undefined): T | undefined => (d ? (JSON.parse(d.body_json) as T) : undefined);

/** The document text without the one-line low-confidence notice (shown separately). */
export const textOf = (d: DocumentRow): string =>
  onceDraftsNotRead(publicText(d.text.replace(/^Low confidence:[^\n]*\n/, '')));

/**
 * How a file is shown on the public pages (2026-11-25). Low confidence is never shown there (it stays in
 * Metrics). A file that failed for good is shown up to its last accepted document and says nothing of the
 * failure: with an accepted report, as a report (with its cable, if any); without one, as its triage, a note.
 * Its opinions, memo and decisions are not shown; neither is the not-adopted reason (Metrics keeps it). A file
 * whose failed document still has its second chance is not finished: it is in preparation (status in_progress).
 */
export function publicView(db: Db, m: MeetingRow): MeetingRow {
  const shown = { ...m, low_confidence: 0, low_confidence_reason: null };
  if (m.status !== 'not_adopted' && m.status !== 'failed') return shown;
  const asReport = !!acceptedDocument(db, m.file_id, m.id, 'report');
  return {
    ...shown,
    level: asReport ? 'report' : 'note',
    status: asReport ? 'reported' : 'noted',
    status_reason: null,
    opinions_json: '[]',
    triage_note: !asReport,
  };
}

/** Public pages never show model names (2026-11-13); the database and Metrics keep them. */
export const publicText = (s: string): string => s.replace(/\b(model|checker) \([^)]*\)/g, '$1');

export interface DecisionBody {
  position: string;
  option: string;
  why: string;
  rejected: { option: string; why: string }[];
  interests: string[];
  red_lines: string[];
  stands_with: string[];
  stands_with_reason: string;
  group_positions?: { group: string; cite: string; position: string; stance?: string; same?: boolean }[];
  voted_with?: unknown;
  vote?: string | null;
  takes_floor?: boolean | null;
  would_have_voted?: string | null;
  closest_to?: string | null;
  differs_on?: { text: string; cite: string } | null;
  change: 'first' | 'maintains' | 'revises';
  line_change?: string | null;
  reopens_if: string;
  press: string;
}

/** A report title as a topic: without the body and meeting number, and not a generic heading. */
function reportTopic(title: string | undefined): string {
  if (!title) return '';
  let cleaned = cleanTitle(title);
  const inner = /\(([^)]*agenda item[^)]*)\)/i.exec(title)?.[1];
  if (GENERIC.test(cleaned) && inner) cleaned = inner.replace(/^\w/, (c) => c.toUpperCase());
  return cleaned && !GENERIC.test(cleaned) && !UN_GENERIC.test(cleaned) ? cleaned : '';
}

/**
 * The title of the newest report of the file that passed its check in an earlier epoch (a reprocessed or
 * reopened file): the subject of the meeting is the same, so it names the topic while the new work is in
 * preparation (2026-11-16). Only the title is used; no model call.
 */
function earlierReportTitle(db: Db, m: MeetingRow): string | undefined {
  const r = db
    .prepare(
      `SELECT d.body_json FROM documents d JOIN llm_calls c ON c.id = d.llm_call_id
       WHERE d.file_id = ? AND d.meeting_id = ? AND d.kind = 'report' AND c.state = 'complete' AND c.error_kind IS NULL
       ORDER BY d.created_at DESC LIMIT 1`,
    )
    .get(m.file_id, m.id) as { body_json: string } | undefined;
  return r ? (JSON.parse(r.body_json) as { title?: string }).title : undefined;
}

/**
 * A short topic for a meeting: SC agenda item, dossier or report subject; while a file is in preparation, the
 * subject an earlier accepted report gave it; else the UN title.
 */
export function topic(db: Db, m: MeetingRow): string {
  if (m.body === 'security_council') {
    const t = m.title.split(' - Security Council')[0]?.trim();
    if (t) return t;
  }
  // A dossier that holds this meeting only names it best; one that groups several meetings (several texts, as
  // a dossier on several country situations) does not, so the meeting's own report title is used (
  // 2026-11-23: a meeting on one country showed the dossier's title, named after another).
  const current = reportTopic(body<{ title?: string }>(doc(db, m, 'report'))?.title);
  if (m.dossier_id && m.level === 'full_file') {
    const d = db
      .prepare(
        `SELECT d.title, (SELECT COUNT(*) FROM files f WHERE f.dossier_id = d.id) AS n FROM dossiers d WHERE d.id = ?`,
      )
      .get(m.dossier_id) as { title: string; n: number } | undefined;
    if (d && (d.n <= 1 || !current))
      return d.title
        .replace(/^(Security Council|General Assembly|First|Second|Third|Fourth|Fifth|Sixth) Committee action on /i, '')
        .replace(/^\w/, (c) => c.toUpperCase());
  }
  if (current) return current;
  if (doc(db, m, 'note')) return 'Procedural meeting';
  return reportTopic(earlierReportTitle(db, m)) || meetingRef(m.title, m.body) || (m.title.split(' - ')[0] ?? m.title);
}

/** Cut at a word boundary, with "…" (2026-11-16: never in the middle of a word). */
export function clip(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const i = cut.lastIndexOf(' ');
  return (i > max / 2 ? cut.slice(0, i) : t.slice(0, max)).replace(/[\s,;:.–—-]+$/, '') + '…';
}

/**
 * "10259th meeting", "24th plenary meeting" (the Assembly's own) or "20th meeting" (a committee): the UN title
 * says "plenary meeting" for committee meetings too (2026-11-25: the header names the real body).
 */
export const meetingNumber = (m: Pick<MeetingRow, 'title' | 'id' | 'body'>): string =>
  meetingRef(m.title, m.body)?.replace(/^[^,]*,\s*/, '') ?? m.id;

export const firstSentence = (s: string): string => {
  const m = /^(.{40,260}?[.;])(\s|$)/.exec(s.trim());
  return (m?.[1] ?? s.trim()).slice(0, 280);
};

export interface DossierRow {
  id: string;
  title: string;
  standing_position: string | null;
  stands_with: string | null;
  interest: string | null;
  red_line: string | null;
  created_at: string;
  updated_at: string;
}
export interface DossierEvent {
  file_id: string;
  meeting_id: string;
  date: string;
  body: string;
  title: string;
  change: string;
  position: string;
  stands_with: string;
  document_id: string;
}

export const dossiers = (db: Db): (DossierRow & { meetings: number; last: string | null; body: string | null })[] =>
  db
    .prepare(
      `SELECT d.*, (SELECT COUNT(*) FROM files f WHERE f.dossier_id = d.id) AS meetings,
         (SELECT e.change FROM dossier_events e WHERE e.dossier_id = d.id ORDER BY e.created_at DESC LIMIT 1) AS last,
         (SELECT m.body FROM files f JOIN meetings m ON m.id = f.meeting_id WHERE f.dossier_id = d.id ORDER BY m.date LIMIT 1) AS body
       FROM dossiers d
       -- A dossier without events (no position taken) is in no list (2026-11-23).
       WHERE EXISTS (SELECT 1 FROM dossier_events e WHERE e.dossier_id = d.id)
       ORDER BY d.updated_at DESC`,
    )
    .all() as never;

export const dossierEvents = (db: Db, id: string): DossierEvent[] =>
  db
    .prepare(
      `SELECT e.file_id, f.meeting_id, m.date, m.body, m.title, e.change, e.position, e.stands_with, e.document_id
       FROM dossier_events e JOIN files f ON f.id = e.file_id JOIN meetings m ON m.id = f.meeting_id
       WHERE e.dossier_id = ? ORDER BY m.date DESC, e.created_at DESC`,
    )
    .all(id) as never;

export const documentBody = <T>(db: Db, id: string): T | undefined => {
  const r = db.prepare('SELECT body_json FROM documents WHERE id = ?').get(id) as { body_json: string } | undefined;
  return r ? (JSON.parse(r.body_json) as T) : undefined;
};

/** Search meetings and every accepted document of all weeks. */
export function search(db: Db, q: string, limit = 60): { m: MeetingRow; snippet: string }[] {
  const like = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  const rows = db
    .prepare(
      `SELECT x.meeting_id, MIN(x.snippet) AS snippet FROM (
         SELECT m.id AS meeting_id, '' AS snippet FROM meetings m WHERE m.title LIKE ? ESCAPE '\\'
         UNION ALL
         SELECT d.meeting_id, d.text AS snippet FROM documents d JOIN llm_calls c ON c.id = d.llm_call_id
           JOIN files f ON f.id = d.file_id
           WHERE c.error_kind IS NULL AND c.epoch >= f.accept_from_epoch AND c.epoch >= f.rework_from_epoch AND (c.epoch >= f.report_from_epoch OR d.kind = 'triage')
             AND (c.epoch >= f.decide_from_epoch OR d.kind NOT IN ('decision','press','cable'))
             AND (c.epoch >= f.memo_from_epoch OR d.kind <> 'options_memo')
             AND d.kind IN ('note','report','opinion','options_memo','decision','press') AND d.text LIKE ? ESCAPE '\\'
             -- A file that failed for good shows only its report (publicView).
             AND (f.status NOT IN ('not_adopted','failed') OR d.kind = 'report')
       ) x GROUP BY x.meeting_id`,
    )
    .all(like, like) as { meeting_id: string; snippet: string }[];
  const out: { m: MeetingRow; snippet: string }[] = [];
  for (const r of rows) {
    const m = meeting(db, r.meeting_id);
    if (!m) continue;
    const text = r.snippet || '';
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    out.push({ m, snippet: i < 0 ? '' : text.slice(Math.max(0, i - 90), i + q.length + 120).replace(/\s+/g, ' ') });
  }
  return out.sort((a, b) => b.m.date.localeCompare(a.m.date)).slice(0, limit);
}

/** Segment label → "0:12–0:40" for cite titles. */
export function segmentSpans(db: Db, meetingIds: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const id of meetingIds)
    for (const s of db
      .prepare('SELECT label, start_seconds, end_seconds FROM segments WHERE meeting_id = ? ORDER BY seq')
      .all(id) as { label: string; start_seconds: number; end_seconds: number }[]) {
      const c = (x: number) => `${Math.floor(x / 3600)}:${String(Math.floor((x % 3600) / 60)).padStart(2, '0')}`;
      if (!map.has(s.label)) map.set(s.label, `${c(s.start_seconds)}–${c(s.end_seconds)}`);
    }
  return map;
}

const GENERIC =
  /^(meeting report|report|briefing|interactive dialogue|briefing and interactive dialogue|general debate)$/i;
/** A title that names only the body and the meeting ("Fourth Committee, 25th plenary meeting", "… 25th meeting"). */
const UN_GENERIC = /^[^:]*\b\d+(st|nd|rd|th)( and \d+(st|nd|rd|th))? (plenary )?meetings?\b[^:]*$/i;
const BODY_PREFIX =
  /^(the )?(general assembly|security council|(first|second|third|fourth|fifth|sixth) committee)\b[^:—–]*?(meeting|session|\))\)?\s*(\([^)]*\))?\s*[:—–-]\s*/i;

/** A report title without the body, meeting number and session it repeats. */
export function cleanTitle(t: string): string {
  let out = t.trim();
  for (let i = 0; i < 2; i++) out = out.replace(BODY_PREFIX, '');
  return out.replace(/^\w/, (c) => c.toUpperCase());
}

/** Open alerts, newest first. */
export const openAlerts = (db: Db): string[] =>
  (
    db.prepare(`SELECT message FROM alerts WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 5`).all() as {
      message: string;
    }[]
  ).map((a) => a.message);

/**
 * The dossier event of a file: the mark and the groups as they stand (2026-11-23: the event is the source
 * of the mark; a decision's own field may predate the line rule), or undefined.
 */
export const fileEvent = (db: Db, fileId: string): { change: string; stands_with: string } | undefined =>
  db.prepare('SELECT change, stands_with FROM dossier_events WHERE file_id = ?').get(fileId) as never;
