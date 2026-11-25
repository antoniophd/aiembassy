// Read-only UN Transcripts client: index and transcript download. No model
// calls, no credentials sent. Host allowlist and size limits from v1 (main).
import {
  segmentTranscript,
  transcriptSpeakerIndex,
  type EvidenceChunk,
  type SpeakerSpan,
} from '../evidence/segments.ts';
import { BODY_LABELS, identifySlug, isTrustedTranscriptUrl, UN_ORIGIN, type Body } from './scope.ts';

const TRUSTED_HOSTS = ['transcripts.un.org'];
const MAX_SOURCE_CHARS = 12_000_000;
const MAX_INDEX_PAGES = 20;
const TIMEOUT_MS = 30_000;

/** Fetches JSON from an approved UN host, bounded in time and size. */
export async function unJSON<T = unknown>(url: string): Promise<T> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !TRUSTED_HOSTS.includes(parsed.hostname))
    throw Error('Untrusted source endpoint');
  const response = await fetch(parsed.href, {
    headers: { Accept: 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw Error('UN source unavailable (' + response.status + ')');
  const text = await response.text();
  if (text.length > MAX_SOURCE_CHARS) throw Error('Source exceeds size limit');
  return JSON.parse(text) as T;
}

/** One entry of meetings.json, as published. */
export interface RawIndexMeeting {
  title?: unknown;
  date?: unknown;
  body?: unknown;
  category?: unknown;
  slug?: unknown;
  duration?: unknown;
  hasTranscript?: unknown;
  pageUrl?: unknown;
  jsonUrl?: unknown;
}

export interface IndexedMeeting {
  id: string;
  body: Body;
  session: number | null;
  number: number;
  part: number;
  date: string;
  title: string;
  durationSeconds: number | null;
  hasTranscript: boolean;
  pageUrl: string;
  jsonUrl: string;
  /** The index's own body label, kept to detect disagreement with the slug. */
  indexBody: string | null;
}

export interface IndexWindow {
  from: string;
  to: string;
  /** In-scope meetings (SC + GA plenary + Main Committees). */
  meetings: IndexedMeeting[];
  /** sc/ or ga/ slugs that match no known pattern. */
  unrecognised: string[];
  /** Total entries the index returned for the window, all bodies. */
  totalEntries: number;
}

function seconds(duration: unknown): number | null {
  const m = /^(\d+):(\d{2}):(\d{2})$/.exec(String(duration ?? ''));
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/** Normalises one index entry; null when out of scope or malformed. */
export function normaliseIndexMeeting(raw: RawIndexMeeting): IndexedMeeting | null {
  const slug = typeof raw.slug === 'string' ? raw.slug : '';
  const identity = identifySlug(slug);
  const date = String(raw.date ?? '').slice(0, 10);
  if (!identity || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const pageUrl = new URL('/en/' + slug, UN_ORIGIN).href;
  const jsonUrl = new URL(String(raw.jsonUrl ?? '/en/' + slug + '.json'), UN_ORIGIN).href;
  if (!isTrustedTranscriptUrl(pageUrl) || !isTrustedTranscriptUrl(jsonUrl)) return null;
  return {
    id: slug,
    ...identity,
    date,
    title: String(raw.title ?? ''),
    durationSeconds: seconds(raw.duration),
    hasTranscript: raw.hasTranscript === true,
    pageUrl,
    jsonUrl,
    indexBody: typeof raw.body === 'string' ? raw.body : null,
  };
}

/** True when the index's body label agrees with the slug (or is absent). */
export function bodyLabelAgrees(m: IndexedMeeting): boolean {
  return m.indexBody === null || m.indexBody === BODY_LABELS[m.body];
}

/** Reads every page of the index for [from, to] (New York dates, inclusive). */
export async function fetchIndex(from: string, to: string): Promise<IndexWindow> {
  const meetings: IndexedMeeting[] = [];
  const unrecognised: string[] = [];
  let totalEntries = 0;
  let more = true;
  let page = 1;
  for (; more && page <= MAX_INDEX_PAGES; page++) {
    const data = await unJSON<{ meetings?: RawIndexMeeting[]; hasMore?: boolean }>(
      UN_ORIGIN + '/en/meetings.json?from=' + from + '&to=' + to + '&page=' + page,
    );
    if (!Array.isArray(data.meetings)) throw Error('UN Transcripts index format changed');
    totalEntries += data.meetings.length;
    for (const raw of data.meetings) {
      const meeting = normaliseIndexMeeting(raw);
      if (meeting) meetings.push(meeting);
      else if (typeof raw.slug === 'string' && /^(sc|ga)\//.test(raw.slug)) unrecognised.push(raw.slug);
    }
    more = data.hasMore === true;
  }
  if (more) throw Error('Transcript index exceeds ' + MAX_INDEX_PAGES + ' pages; window too wide');
  const unique = new Map(meetings.map((m) => [m.id, m]));
  return { from, to, meetings: [...unique.values()], unrecognised, totalEntries };
}

interface TranscriptStatement {
  start?: unknown;
  speaker?: { affiliation_full?: unknown; affiliation?: unknown; function?: unknown; group?: unknown };
  paragraphs?: { sentences?: { start?: unknown; end?: unknown; text?: unknown }[] }[];
}

interface TranscriptRecord {
  url?: unknown;
  video?: { date?: unknown; title?: unknown };
  transcript?: { language?: unknown; data?: unknown };
}

export interface SegmentWithSpeakers extends EvidenceChunk {
  speakers: SpeakerSpan[];
}

export interface DownloadedTranscript {
  url: string;
  title: string;
  language: 'en';
  statements: number;
  characters: number;
  speakers: SpeakerSpan[];
  segments: SegmentWithSpeakers[];
}

/** The transcript is listed but has no text yet: try again on a later run. */
export class TranscriptNotReadyError extends Error {}

/** The transcript can never be processed as published (identity, format, size). */
export class TranscriptRejectedError extends Error {}

function transcriptRows(data: TranscriptStatement[]): { start: number; text: string }[] {
  return data.flatMap((statement) =>
    (statement.paragraphs ?? []).flatMap((p) =>
      (p.sentences ?? []).map((t) => ({
        start: Math.max(0, Math.ceil(Number(t.start) || 0)),
        text: String(t.text || ''),
      })),
    ),
  );
}

/** Downloads, validates and segments one transcript. */
export async function downloadTranscript(meeting: IndexedMeeting): Promise<DownloadedTranscript> {
  const record = await unJSON<TranscriptRecord>(meeting.jsonUrl);
  const canonical = String(record.url ?? '');
  if (!isTrustedTranscriptUrl(canonical) || new URL(canonical).pathname !== '/en/' + meeting.id)
    throw new TranscriptRejectedError('Transcript identity did not match the index');
  if (String(record.video?.date ?? '').slice(0, 10) !== meeting.date)
    throw new TranscriptRejectedError('Transcript date did not match the index');
  if (record.transcript?.language !== 'en') throw new TranscriptRejectedError('Transcript is not in English');
  if (!Array.isArray(record.transcript.data)) throw new TranscriptRejectedError('Transcript format changed');
  const data = record.transcript.data as TranscriptStatement[];
  const rows = transcriptRows(data).filter((r) => r.text.trim());
  if (!rows.length) throw new TranscriptNotReadyError('Published transcript contains no text yet');
  const speakers = transcriptSpeakerIndex(data);
  let chunks: EvidenceChunk[];
  try {
    chunks = segmentTranscript(rows);
  } catch (error) {
    throw new TranscriptRejectedError((error as Error).message);
  }
  const segments = chunks.map((c) => ({
    ...c,
    speakers: speakers.filter((s) => s.start <= c.end && s.end >= c.start),
  }));
  return {
    url: canonical,
    title: String(record.video?.title ?? meeting.title),
    language: 'en',
    statements: data.length,
    characters: rows.reduce((n, r) => n + r.text.length, 0),
    speakers,
    segments,
  };
}
