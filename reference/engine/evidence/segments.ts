// Transcript segmentation and the stored evidence format (version 2).

export interface TranscriptRow {
  start: number;
  text: string;
}

export interface EvidenceChunk {
  id: string;
  start: number;
  end: number;
  text: string;
  label?: string;
  url?: string;
  [key: string]: unknown;
}

export interface SegmentSummary {
  id: string;
  start?: number;
  end?: number;
  label?: string;
  url?: string;
  summary: string;
  usage?: unknown;
  [key: string]: unknown;
}

export interface EvidenceV2 {
  version: 2;
  chunks: EvidenceChunk[];
  summaries: SegmentSummary[];
  [key: string]: unknown;
}

export const MAX_SEGMENT_CHARACTERS = 10000;
export const MAX_SEGMENTS = 24;

/** Splits a transcript into at most 24 segments. Never truncates silently. */
export function segmentTranscript(rows: TranscriptRow[], max = MAX_SEGMENT_CHARACTERS): EvidenceChunk[] {
  const chunks: EvidenceChunk[] = [];
  let text = '';
  let start = 0;
  let end = 0;
  for (const row of rows) {
    const line = '[' + row.start + 's] ' + row.text;
    if (line.length > max) throw Error('Transcript sentence exceeds the safe segment limit.');
    if (text && text.length + line.length + 1 > max) {
      chunks.push({ id: 'E' + (chunks.length + 1), start, end, text });
      text = '';
    }
    if (!text) start = row.start;
    end = row.start;
    text += (text ? '\n' : '') + line;
  }
  if (text) chunks.push({ id: 'E' + (chunks.length + 1), start, end, text });
  if (!chunks.length) throw Error('Transcript contains no readable text.');
  if (chunks.length > MAX_SEGMENTS)
    throw Error('This transcript exceeds 24 segments. Choose a shorter meeting; nothing has been analysed or charged.');
  return chunks;
}

/** Parses stored evidence; returns null for legacy excerpt formats. */
export function evidenceState(value: unknown): EvidenceV2 | null {
  try {
    const parsed = JSON.parse(String(value)) as Partial<EvidenceV2> | null;
    if (parsed && parsed.version === 2 && Array.isArray(parsed.chunks)) return parsed as EvidenceV2;
  } catch {
    // Legacy runs store a plain excerpt; that is not an error.
  }
  return null;
}

interface SourceStatement {
  start?: unknown;
  speaker?: { affiliation_full?: unknown; affiliation?: unknown; function?: unknown; group?: unknown };
  paragraphs?: { sentences?: { start?: unknown; end?: unknown }[] }[];
}

export interface SpeakerSpan {
  start: number;
  end: number;
  label: string;
}

/** Speaker labels from UN Transcripts metadata. Labels are not verified identities. */
export function transcriptSpeakerIndex(statements: SourceStatement[]): SpeakerSpan[] {
  return statements.map((statement) => {
    const begin = Number(statement.start) || 0;
    const sentenceTimes = (statement.paragraphs ?? []).flatMap((p) =>
      (p.sentences ?? []).map((t) => Number(t.end) || Number(t.start) || 0),
    );
    const speaker = statement.speaker;
    const label = [speaker?.affiliation_full || speaker?.affiliation, speaker?.function, speaker?.group]
      .filter((x): x is string => typeof x === 'string' && !!x.trim())
      .join(' · ');
    return {
      start: Math.ceil(begin),
      end: Math.ceil(Math.max(begin, ...sentenceTimes)),
      label: label || 'Speaker not identified in the source',
    };
  });
}
