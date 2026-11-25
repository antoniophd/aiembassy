// Deterministic source check of a meeting report (the design,
// checks 1, 2 and 4). No model. Every item is verified against the text and
// speaker index of the segments it cites.
import type { Segment } from '../work/context.ts';

export interface CitedItem {
  section: string;
  text: string;
  cites: string[];
  /** Speaker or delegation named by the item, checked against the speaker index. */
  speaker?: string;
}

export interface CheckFailure {
  rule: 'references' | 'figures' | 'quotes' | 'attribution' | 'length' | 'structure' | 'language';
  section: string;
  detail: string;
}

export interface SourceCheck {
  pass: boolean;
  failures: CheckFailure[];
  stats: { items: number; cites: number; figures: number; quotes: number; attributions: number; words: number };
}

export const normalise = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9%']+/g, ' ')
    .trim();

const NUMBER = /\d[\d,.]*\d%?|\d%?/g;
const bareNumber = (t: string): string => t.replace(/,/g, '').replace(/\.$/, '').replace(/%$/, '');

const UNITS =
  'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(
    ' ',
  );
const TENS = 'twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');

/** Numbers 0–99 written in words (automatic transcripts often spell them out). */
export function spelledNumbers(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(
    `\\b(?:(${TENS.join('|')})(?:[- ](${UNITS.slice(1, 10).join('|')}))?|(${UNITS.join('|')}))\\b`,
    'gi',
  );
  for (const m of text.matchAll(re)) {
    if (m[3]) out.push(String(UNITS.indexOf(m[3].toLowerCase())));
    else if (m[1])
      out.push(String((TENS.indexOf(m[1].toLowerCase()) + 2) * 10 + (m[2] ? UNITS.indexOf(m[2].toLowerCase()) : 0)));
  }
  return out;
}

/** Strips the [123s] timestamps segmentation adds; they are not figures of the meeting. */
export const withoutTimestamps = (text: string): string => text.replace(/\[\d+s\]/g, ' ');

/** Every number in a text, as whole tokens (commas, final dot and % removed), digits or words. */
export function numberTokens(text: string): Set<string> {
  const clean = withoutTimestamps(text);
  return new Set([...[...clean.matchAll(NUMBER)].map((m) => bareNumber(m[0])), ...spelledNumbers(clean)]);
}

/** Numeric tokens worth checking: two or more digits, or a percentage. */
export function figures(text: string): string[] {
  const out = new Set<string>();
  const withoutCitations = text.replace(/\[E\d+\]/g, ' ');
  for (const m of withoutCitations.matchAll(NUMBER)) {
    const token = m[0].replace(/,/g, '').replace(/\.$/, '');
    if (/^\d$/.test(token)) continue;
    out.add(token);
  }
  return [...out];
}

/**
 * Numbers that are part of a reference, not a figure of the meeting: a document symbol ("L.12",
 * "L/12", "A/C.3/99/L.12"), or the number after resolution, decision, rule, agenda item, article or
 * paragraph ("resolution 99/151", "Resolutions 9901 and 9902", "agenda items 47, 49 and 50").
 * A reference must appear somewhere in the transcript, not necessarily in the cited segment
 * (2026-11-16: a vote on a text recorded in one segment, its symbol read out only in the one before).
 */
const REFERENCE =
  /\b(?:L|Rev)\s*[./]\s*\d+|\b(?:resolutions?|decisions?|rules?|(?:agenda\s+)?items?|articles?|paragraphs?)\s+\d[\d/]*(?:\s*(?:,|and|,\s*and)\s*\d[\d/]*)*/gi;
export function referenceNumbers(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of withoutTimestamps(text).matchAll(REFERENCE))
    for (const n of m[0].matchAll(/\d+/g)) if (n[0].length >= 2) out.add(n[0]);
  return out;
}

/** Phrases in double quotes of three words or more. */
export function quotes(text: string): string[] {
  const found = [...text.matchAll(/"([^"]{3,400})"/g), ...text.matchAll(/\u201c([^\u201d]{3,400})\u201d/g)];
  return found.map((m) => m[1] ?? '').filter((q) => normalise(q).split(' ').length >= 3);
}

function speakerMatches(name: string, segment: Segment): boolean {
  const n = normalise(name);
  if (!n) return false;
  return segment.speakers.some((s) =>
    s.label
      .split(' · ')
      .map(normalise)
      .some((part) => part && (part === n || part.includes(n) || n.includes(part))),
  );
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * `metadata`: the meeting title and date; figures that appear there (meeting
 * number, year, session) need no segment support.
 */
export function checkSources(
  items: CitedItem[],
  segments: Segment[],
  maxWords: number,
  words: number,
  metadata = '',
): SourceCheck {
  const known = numberTokens(metadata);
  const transcriptReferences = referenceNumbers(segments.map((s) => s.text).join('\n'));
  const byLabel = new Map(segments.map((s) => [s.label, s]));
  const numbersBySegment = segments.map((s) => ({ label: s.label, numbers: numberTokens(s.text) }));
  /** Where a figure does appear: a hint for the regeneration, never a pass. */
  const whereIs = (bare: string): string => {
    const found = numbersBySegment.filter((x) => x.numbers.has(bare)).map((x) => x.label);
    return found.length ? `; it appears in ${found.slice(0, 5).join(', ')}` : '; it appears in no segment';
  };
  const failures: CheckFailure[] = [];
  const stats = { items: items.length, cites: 0, figures: 0, quotes: 0, attributions: 0, words };
  for (const item of items) {
    const cited = item.cites.map((c) => byLabel.get(c));
    stats.cites += item.cites.length;
    const missing = item.cites.filter((c, i) => !cited[i]);
    if (!item.cites.length) failures.push({ rule: 'references', section: item.section, detail: 'no segment cited' });
    if (missing.length)
      failures.push({ rule: 'references', section: item.section, detail: 'unknown segment ' + missing.join(', ') });
    const sources = cited.filter((s): s is Segment => !!s);
    if (!sources.length) continue;
    const numbers = numberTokens(sources.map((s) => s.text).join('\n'));
    const norm = normalise(withoutTimestamps(sources.map((s) => s.text).join('\n')));
    const itemReferences = referenceNumbers(item.text);
    for (const f of figures(item.text)) {
      stats.figures++;
      const bare = bareNumber(f);
      const reference = itemReferences.has(bare) && transcriptReferences.has(bare);
      if (!numbers.has(bare) && !known.has(bare) && !reference)
        failures.push({
          rule: 'figures',
          section: item.section,
          detail: `"${f}" not in ${item.cites.join(', ')}${whereIs(bare)}`,
        });
    }
    for (const q of quotes(item.text)) {
      stats.quotes++;
      if (!norm.includes(normalise(q)))
        failures.push({
          rule: 'quotes',
          section: item.section,
          detail: `quotation not verbatim in ${item.cites.join(', ')}: "${q.slice(0, 80)}"`,
        });
    }
    if (item.speaker !== undefined) {
      stats.attributions++;
      if (!sources.some((s) => speakerMatches(item.speaker as string, s)))
        failures.push({
          rule: 'attribution',
          section: item.section,
          detail: `"${item.speaker}" is not a speaker label in ${item.cites.join(', ')}`,
        });
    }
  }
  if (words > maxWords * 2)
    failures.push({ rule: 'length', section: 'report', detail: `${words} words; hard cap ${maxWords * 2}` });
  return { pass: failures.length === 0, failures, stats };
}
