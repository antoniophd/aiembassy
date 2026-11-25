// What the record must keep (2026-11-13): the tally of every
// text voted as a whole, every statement made on behalf of a group or of
// several States, and an entry for every delegation the report or the
// decision names. Read from the transcript by code. Pure: no model.
import type { Body } from '../ingest/scope.ts';
import { isOfficer, type SegmentLike } from './groups.ts';
import { MEMBER_STATES, speaksForStates } from './member-states.ts';

export interface Tally {
  /** The draft's number as written after "L" (e.g. "6" for A/C.1/99/L.6). */
  draft: string;
  in_favour: number;
  against?: number | null;
  abstentions?: number | null;
  segment: string;
  /** The announcement cannot be read without interpreting it (e.g. "120 in favour, 4 abstentions, against and two abstained"). */
  unclear?: boolean;
}

const WORDS: Record<string, number> = { zero: 0, none: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const num = (s: string | undefined): number | null =>
  s === undefined ? null : /^\d+$/.test(s) ? Number(s) : (WORDS[s.toLowerCase()] ?? null);

/** "L.6", "L/34", "L-17", "L34" → "6", "34", "17", "34". */
export const draftNumber = (s: string): string | null => /\bL\s?[./-]?\s?(\d{1,3})\b/i.exec(s)?.[1] ?? null;

const PUT = /\bthose in favou?r of (the )?(draft (resolutions?|decisions?)|decisions?|resolutions?)\b(.*)/i;
const RESULT = /\b(the )?(result of the vot(e|ing)|voting result)\b/i;
const FAVOUR = /(\d+)\s+in favou?r|in favou?r,?\s+(\d+)/i;
const NUMBER_WORD = '(\\d+|zero|none|one|two|three|four|five|six)';
const AGAINST = new RegExp(`${NUMBER_WORD}\\s+against|against,?\\s+${NUMBER_WORD}`, 'i');
const ABSTAIN = new RegExp(`${NUMBER_WORD}\\s+(abstentions?|abstain(ed|ing)?)|abstentions?,?\\s+${NUMBER_WORD}`, 'i');
const count = (line: string, re: RegExp): number | null => {
  const m = re.exec(line);
  return m
    ? num(m.slice(1).find((x) => x !== undefined && /^(\d+|zero|none|one|two|three|four|five|six)$/i.test(x)))
    : null;
};
const ADOPTED = /\b(draft )?(resolution|decision)\s+(.{0,30}?L\s?[./-]?\s?\d{1,3})\b.{0,20}\b(is|was) adopted\b/i;

/**
 * Tallies of drafts voted as a whole: the chair's "those in favour of the
 * draft …", then the result; when the chair gives no symbol, the next "draft
 * resolution L.x is adopted" names it. Paragraph votes are left out.
 */
export function transcriptTallies(segments: SegmentLike[]): Tally[] {
  const out: Tally[] = [];
  // null: no whole-draft vote pending; '': a whole draft without its symbol yet.
  let pending: string | null = null;
  let unnamed: Omit<Tally, 'draft'> | null = null;
  for (const s of segments)
    for (const raw of s.text.split('\n')) {
      const line = raw.replace(/^\[\d+s\]\s*/, '');
      const put = PUT.exec(line);
      if (put) pending = draftNumber(put[4] ?? '') ?? '';
      else if (/\bthose in favou?r of\b/i.test(line)) pending = null; // a paragraph or a part
      if (RESULT.test(line)) {
        const m = FAVOUR.exec(line);
        const n = num(m?.[1] ?? m?.[2]);
        const against = count(line, AGAINST);
        const abstentions = count(line, ABSTAIN);
        // Unclear: a figure missing, or more than one figure for abstentions.
        const abstainFigures = (line.match(new RegExp(ABSTAIN.source, 'gi')) ?? []).length;
        const unclear = against === null || abstentions === null || abstainFigures > 1;
        const rest = { against, abstentions, segment: s.label, unclear };
        if (n !== null && pending) out.push({ draft: pending, in_favour: n, ...rest });
        else if (n !== null && pending === '') unnamed = { in_favour: n, ...rest };
        pending = null;
        continue;
      }
      const adopted = ADOPTED.exec(line);
      if (adopted && unnamed) {
        const d = draftNumber(adopted[3] ?? '');
        if (d) out.push({ draft: d, ...unnamed });
        unnamed = null;
      }
    }
  return out;
}

export interface VoteEntry {
  draft: string;
  in_favour: number | null;
}

/** Every whole-draft tally in the transcript must appear in the report's votes. */
export function missingTallies(tallies: Tally[], votes: VoteEntry[]): Tally[] {
  return tallies.filter(
    (t) => !votes.some((v) => draftNumber(v.draft) === t.draft && (t.unclear || v.in_favour === t.in_favour)),
  );
}

export const TALLY_UNCLEAR = 'tally unclear in the transcript';

/** A statement delivered on behalf of a group or of several States (first person, not a passing mention). */
const DELIVERS =
  /\b(I|we|delegation of [A-Z][\w ]+|[A-Z][a-z]+) (have|has) the hono(u)?r (to|of) [^.]{0,160}\bon behalf of\b|\bI (would like to|wish to|am pleased to|will now) [^.]{0,160}\bon behalf of\b|\bI (speak|deliver|make) [^.]{0,100}\bon behalf of\b/i;
const OWN = /on behalf of (my|our) (own )?(delegation|country|government)\b/i;

export interface GroupStatement {
  speaker: string;
  segment: string;
  /** Number of States named, when the statement enumerates them (counted by code). */
  states: number | null;
  /** "on behalf of …" up to 200 characters. */
  behalf: string;
}

const base = (label: string) => (label.split('·')[0] ?? label).trim().toLowerCase();

/** Enumerated names after "on behalf of": "Arvenia, Belmora, … and Corvalia" → count (≥ 3), else null. */
const COMPOUND =
  /\b(Bosnia and Herzegovina|Trinidad and Tobago|Antigua and Barbuda|Saint Kitts and Nevis|Saint Vincent and the Grenadines|Sao Tome and Principe|São Tomé and Príncipe)\b/g;

/** States whose name holds "and": the fixed spellings above and any registered with `extendMemberStates`. */
const compound = (s: string): string => {
  const extra = MEMBER_STATES.filter((n) => / and /.test(n) && !/[()]/.test(n));
  const out = s.replace(COMPOUND, (m) => m.replace(/ and /g, ' & '));
  return extra.reduce((t, n) => t.split(n).join(n.replace(/ and /g, ' & ')), out);
};

function countStates(behalf: string): number | null {
  const list = compound(behalf)
    .replace(/,?\s*(and\s+)?my own country(,\s*(the )?[A-Z][^,.;]*)?/i, '')
    .replace(/^on behalf of (the )?(following )?(member states|states|countries)?:?\s*/i, '')
    .split(/\.\s/)[0]!
    .replace(/,?\s+(and|as well as)\s+(my own country,?\s*)?(the )?/gi, ', ')
    .split(/\s*,\s*/)
    .filter((x) => /^(the )?[A-Z]/.test(x.trim()) && x.trim().split(/\s+/).length <= 6);
  const n = list.length + (/my own country/i.test(behalf) ? 1 : 0);
  return n >= 2 ? n : null;
}

/**
 * Statements on behalf of a group of States (2026-11-19): only a Member State's delegation (or the
 * European Union's) delivers one.
 * Never the presidency giving the floor ("GA · PGA … on behalf of <a group>"), the Secretariat, a
 * rapporteur ("… on behalf of the Council") or a staff body ("<staff federation> … on behalf of <itself>").
 */
export function groupStatements(segments: SegmentLike[]): GroupStatement[] {
  const out: GroupStatement[] = [];
  for (const s of segments)
    for (const sp of s.speakers) {
      if (!speaksForStates(sp.label)) continue;
      const text = s.text
        .split('\n')
        .filter((l) => {
          const t = Number(/^\[(\d+)s\]/.exec(l)?.[1] ?? NaN);
          return t >= sp.start && t <= sp.end;
        })
        .map((l) => l.replace(/^\[\d+s\]\s*/, ''))
        .join(' ');
      const m = DELIVERS.exec(text);
      if (!m || OWN.test(m[0])) continue;
      const behalf = text.slice(text.toLowerCase().indexOf('on behalf of', m.index)).slice(0, 600);
      if (out.some((x) => x.segment === s.label && base(x.speaker) === base(sp.label))) continue;
      out.push({ speaker: sp.label, segment: s.label, states: countStates(behalf), behalf: behalf.slice(0, 200) });
    }
  return out;
}

export interface Entry {
  delegation: string;
  cites: string[];
}

/** Group statements in the transcript with no entry for that speaker (a statement may run over several segments). */
export const missingGroupStatements = (found: GroupStatement[], entries: Entry[]): GroupStatement[] =>
  found.filter((g) => !entries.some((e) => base(e.delegation) === base(g.speaker)));

/** Organisations and bodies labelled by acronym ("UNXA · Commissioner-General", "ICJ · President"). */
const ACRONYM = /^[A-Z][A-Z0-9/&-]+$/;
const meetingLabels = (segments: SegmentLike[], body?: Body | null, states = false): Set<string> => {
  const labels = new Set<string>();
  for (const s of segments)
    for (const sp of s.speakers)
      if (!isOfficer(sp.label, body) && !(states && ACRONYM.test((sp.label.split('·')[0] ?? '').trim())))
        labels.add(base(sp.label));
  return labels;
};
// "Rovinia (Republic of)" is named as "Rovinia"; a name ending "of America" loses it.
const shortName = (l: string): string => l.replace(/\s*\(.*\)$/, '').replace(/ of america$/, '');
const names = (lower: string, l: string): boolean =>
  l.length >= 4 && new RegExp(`\\b${shortName(l).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower);

/** Delegations (speaker labels of the meeting) named in a text that have no entry in the report. */
export function namedWithoutEntry(
  text: string,
  segments: SegmentLike[],
  entries: Entry[],
  body?: Body | null,
): string[] {
  const have = new Set(entries.map((e) => base(e.delegation)));
  const lower = text.toLowerCase();
  return [...meetingLabels(segments, body)].filter((l) => {
    if (have.has(l) || !names(lower, l)) return false;
    const short = shortName(l);
    return ![...have].some((h) => h.startsWith(short) || short.startsWith(h.replace(/\s*\(.*\)$/, '')));
  });
}

/**
 * Agreement and disagreement lines (2026-11-16): a delegation named in a line needs no entry of its
 * own, but it must take the floor in a segment the line cites (checked against the speaker index). Bodies and
 * organisations labelled by acronym are not checked here.
 */
export function namedNotSpeaking(
  items: { text: string; cites: string[] }[],
  segments: SegmentLike[],
  body?: Body | null,
): { name: string; cites: string[] }[] {
  // Delegations only: an organisation is often the subject of a line ("support for the agency").
  const labels = meetingLabels(segments, body, true);
  const byLabel = new Map(segments.map((s) => [s.label, s]));
  const out: { name: string; cites: string[] }[] = [];
  for (const item of items) {
    const lower = item.text.toLowerCase();
    const spoke = new Set(item.cites.flatMap((c) => (byLabel.get(c)?.speakers ?? []).map((sp) => base(sp.label))));
    for (const l of labels)
      if (names(lower, l) && !spoke.has(l) && !out.some((x) => x.name === l && x.cites.join() === item.cites.join()))
        out.push({ name: l, cites: item.cites });
  }
  return out;
}

/**
 * Ambiguous number sequences (2026-11-13): a year followed by two-digit numbers in a list ("in 2025,
 * 24, and 23", most likely years garbled by the automatic transcript). Their numbers are not used: omitted
 * or marked "unclear in the transcript". A known limit of the source check, which only verifies that a
 * figure appears in its segment.
 */
// At least two numbers after the year: "in 2024, 17 states" is a clear statement.
const SEQUENCE = /\b((?:19|20)\d{2}),\s*(\d{2}),?\s*(?:and\s+)?(\d{2})\b(?:,?\s*(?:and\s+)?(\d{2})\b)?/g;
export interface AmbiguousSequence {
  year: string;
  numbers: string[];
}
export function ambiguousSequences(segments: SegmentLike[]): AmbiguousSequence[] {
  const out: AmbiguousSequence[] = [];
  for (const s of segments)
    for (const m of s.text.replace(/\[\d+s\]/g, ' ').matchAll(SEQUENCE))
      out.push({ year: m[1]!, numbers: m.slice(2).filter((x): x is string => !!x) });
  return out;
}

const UNITS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
/** "twenty-four" → "24", "fifteen" → "15" (for comparing figures written in words). */
const wordsToDigits = (t: string): string =>
  t
    .replace(
      /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[- ](one|two|three|four|five|six|seven|eight|nine)\b/gi,
      (_m, a: string, b: string) => String(TENS.indexOf(a.toLowerCase()) * 10 + UNITS.indexOf(b.toLowerCase())),
    )
    .replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/gi, (m) =>
      String(TENS.indexOf(m.toLowerCase()) * 10),
    )
    .replace(new RegExp(`\\b(${UNITS.join('|')})\\b`, 'gi'), (m) => String(UNITS.indexOf(m.toLowerCase())));

/** Numbers of an ambiguous sequence used with its year, unless the sentence says they are unclear. */
export function usesAmbiguous(text: string, seqs: AmbiguousSequence[]): string[] {
  if (!seqs.length) return [];
  const found = new Set<string>();
  for (const sentence of text.split(/(?<=[.;!?])\s+/)) {
    if (/unclear in the transcript/i.test(sentence)) continue;
    const t = wordsToDigits(sentence);
    for (const q of seqs)
      if (new RegExp(`\\b${q.year}\\b`).test(t))
        for (const n of q.numbers) if (new RegExp(`\\b${n}\\b`).test(t)) found.add(n);
  }
  return [...found];
}

/** A repair made by code instead of a rejection (2026-11-19); kept in the document and counted in Metrics. */
export interface CodeRepair {
  /** Where: "agreement", "disagreement", or the cable field ("summary", "paragraph 2", "assessment"). */
  section: string;
  name: string;
  action: 'cite_added' | 'name_removed';
  /** The segment added, for cite_added. */
  cite?: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Removes a delegation's name from a text: from a list ("A, B and C"), or, when it is not in a list, the
 * sentence that names it. "Iran (Islamic Republic of)" is also found as "Iran". Pure.
 */
export function removeName(text: string, label: string, listOnly = false): string {
  const n = `\\b${escape(shortName(label.toLowerCase()))}\\b(?:\\s*\\([^)]*\\))?`;
  const forms: [RegExp, string][] = [
    [new RegExp(`\\s*,\\s*(?:and\\s+)?(?:the\\s+)?${n}`, 'i'), ''],
    [new RegExp(`(?:the\\s+)?${n}\\s*,\\s*`, 'i'), ''],
    [new RegExp(`\\s+(?:and|as well as)\\s+(?:the\\s+)?${n}`, 'i'), ''],
    [new RegExp(`(?:the\\s+)?${n}\\s+(?:and|as well as)\\s+`, 'i'), ''],
  ];
  let out = text;
  for (let i = 0; i < 6 && new RegExp(n, 'i').test(out); i++) {
    const form = forms.find(([re]) => re.test(out));
    if (form) out = out.replace(form[0], form[1]);
    else if (listOnly) break;
    else {
      const sentences = out.split(/(?<=[.;!?])\s+/);
      const kept = sentences.filter((s) => !new RegExp(n, 'i').test(s));
      out = kept.join(' ');
      break;
    }
  }
  // A list reduced to one name may start with a lower-case letter after a removal at the start.
  return out.replace(/^\s+/, '').replace(/^[a-z]/, (c) => c.toUpperCase());
}

/**
 * Agreement and disagreement lines (2026-11-19): no longer a reason to reject the report. A delegation
 * named in a line that does not speak in the segments it cites gets, by code, a cite to a segment where it does
 * speak (the nearest one); one that does not speak in the meeting at all is removed from the line. No model
 * call. Mutates the lines; returns each repair.
 */
export function repairNamedLines(
  r: { agreement: { text: string; cites: string[] }[]; disagreement: { text: string; cites: string[] }[] },
  segments: SegmentLike[],
  body?: Body | null,
): CodeRepair[] {
  const order = new Map(segments.map((s, i) => [s.label, i]));
  const repairs: CodeRepair[] = [];
  for (const section of ['agreement', 'disagreement'] as const)
    for (const item of r[section])
      for (const { name } of namedNotSpeaking([item], segments, body)) {
        const where = segments.filter((s) => s.speakers.some((sp) => base(sp.label) === name)).map((s) => s.label);
        if (where.length) {
          const at = item.cites.map((c) => order.get(c) ?? 0);
          const dist = (l: string) => Math.min(...(at.length ? at : [0]).map((i) => Math.abs((order.get(l) ?? 0) - i)));
          const cite = [...where].sort((a, b) => dist(a) - dist(b))[0]!;
          item.cites = [...item.cites, cite].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
          repairs.push({ section, name, action: 'cite_added', cite });
        } else {
          item.text = removeName(item.text, name);
          repairs.push({ section, name, action: 'name_removed' });
        }
      }
  // A Member State named in a list of delegations ("Ghana, Peru and Brazil supported") that does not take the
  // floor in the meeting at all is removed from the list. A State named outside a list is the subject of the
  // line ("the situation in Sudan") and is left as it is.
  const spoke = new Set(segments.flatMap((s) => s.speakers.map((sp) => base(sp.label))));
  const spokeShort = new Set([...spoke].map(shortName));
  for (const section of ['agreement', 'disagreement'] as const)
    for (const item of r[section])
      for (const state of MEMBER_STATES) {
        const l = state.toLowerCase();
        if (spoke.has(l) || spokeShort.has(shortName(l)) || !names(item.text.toLowerCase(), l)) continue;
        const out = removeName(item.text, l, true);
        if (out === item.text) continue;
        item.text = out;
        repairs.push({ section, name: l, action: 'name_removed' });
      }
  r.agreement = r.agreement.filter((i) => i.text.trim());
  r.disagreement = r.disagreement.filter((i) => i.text.trim());
  return repairs;
}
