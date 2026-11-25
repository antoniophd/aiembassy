// The single scope rule: completed Security Council and General Assembly
// meetings (plenary and the six Main Committees) with a published English
// transcript on UN Transcripts. Adapted from the v1 engine (main).
//
// Bodies are identified by the index slug, as observed in the live index
// (https://transcripts.un.org/en/meetings.json, inspected 2026-11-12):
//   sc/<meeting>                         Security Council
//   ga/<session>/<meeting>               General Assembly plenary
//   ga/c<1-6>/<session>/<meeting>        First … Sixth Committee
// Any of these may end in /<part> (2, 3, …): a resumed part of the same
// meeting, published as a separate recording with its own transcript.
// The index also carries a `body` label; it must agree with the slug.

export const SCOPE_ID = 'sc-ga-transcripts-v2';
export const UN_ORIGIN = 'https://transcripts.un.org';

export const BODIES = ['security_council', 'ga_plenary', 'ga_c1', 'ga_c2', 'ga_c3', 'ga_c4', 'ga_c5', 'ga_c6'] as const;
export type Body = (typeof BODIES)[number];

/** The `body` label the index uses for each body. */
export const BODY_LABELS: Record<Body, string> = {
  security_council: 'Security Council',
  ga_plenary: 'General Assembly',
  ga_c1: 'First Committee',
  ga_c2: 'Second Committee',
  ga_c3: 'Third Committee',
  ga_c4: 'Fourth Committee',
  ga_c5: 'Fifth Committee',
  ga_c6: 'Sixth Committee',
};

/**
 * A cited meeting named by its own body (2026-11-23): "Third Committee, 41st meeting", "General
 * Assembly, 30th plenary meeting", "Security Council, 10260th meeting". The UN title says "plenary meeting"
 * for committee meetings too; only the Assembly's own meetings are plenary.
 */
export function meetingRef(title: string, body: string): string | undefined {
  const n = /(\d+(?:st|nd|rd|th)(?: and \d+(?:st|nd|rd|th))?) (?:plenary )?meetings?\b/i.exec(title)?.[1];
  if (!n) return undefined;
  const noun = `${body === 'ga_plenary' ? 'plenary ' : ''}meeting${n.includes(' and ') ? 's' : ''}`;
  return `${BODY_LABELS[body as Body] ?? body}, ${n} ${noun}`;
}

/** The body without a meeting number, for a press release (2026-11-25). */
export function organName(body: string): string {
  if (body === 'security_council') return 'the Security Council';
  if (body === 'ga_plenary') return 'the General Assembly';
  return `the ${BODY_LABELS[body as Body] ?? body} of the General Assembly`;
}

/** "the Third Committee's 45th meeting", "the General Assembly's 30th plenary meeting" (2026-11-25). */
export function meetingPossessive(title: string, body: string): string | undefined {
  const ref = meetingRef(title, body);
  if (!ref) return undefined;
  const [organ, rest] = ref.split(/,\s*/, 2) as [string, string];
  return `the ${organ}'s ${rest}`;
}

export interface MeetingIdentity {
  body: Body;
  /** General Assembly session number; null for the Security Council. */
  session: number | null;
  /** Meeting number as published in the slug. */
  number: number;
  /** 1 for the first recording; 2, 3, … for resumed parts. */
  part: number;
}

/** Parses an index slug; null when it is not in scope. */
export function identifySlug(slug: string): MeetingIdentity | null {
  const PART = '(?:\\/([2-9]|[1-9]\\d))?$';
  const part = (p: string | undefined): number => (p ? Number(p) : 1);
  let m = new RegExp('^sc\\/(\\d+)' + PART).exec(slug);
  if (m) return { body: 'security_council', session: null, number: Number(m[1]), part: part(m[2]) };
  m = new RegExp('^ga\\/(\\d+)\\/(\\d+)' + PART).exec(slug);
  if (m) return { body: 'ga_plenary', session: Number(m[1]), number: Number(m[2]), part: part(m[3]) };
  m = new RegExp('^ga\\/c([1-6])\\/(\\d+)\\/(\\d+)' + PART).exec(slug);
  if (m) return { body: ('ga_c' + m[1]) as Body, session: Number(m[2]), number: Number(m[3]), part: part(m[4]) };
  return null;
}

/** Slugs under sc/ or ga/ that match no known pattern are reported, never guessed. */
export function isUnrecognisedCandidate(slug: string): boolean {
  return /^(sc|ga)\//.test(slug) && !identifySlug(slug);
}

export function newYorkDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

export function offsetDate(date: string, days: number): string {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `date` (weeks run Monday to Sunday). */
export function weekStart(date: string): string {
  const weekday = (new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7;
  return offsetDate(date, -weekday);
}

/** A URL on the UN Transcripts origin, English path, no credentials. */
export function isTrustedTranscriptUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === UN_ORIGIN && !url.username && !url.password && url.pathname.startsWith('/en/');
  } catch {
    return false;
  }
}
