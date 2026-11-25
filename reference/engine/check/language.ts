// Language of visible text: no internal codes
// (interest and red-line ids such as I6 or R2), no talk of the machinery
// ("supplied segments", "segment summaries"); and, while the draft texts are
// not read, no reasoning about operative language nobody has seen. Pure.

const CODES = /\b[IR][1-9]\d?\b/g;
const MACHINERY =
  /\bsupplied (segments?|material|excerpts?|summar(y|ies)|text)\b|\bsegment summar(y|ies)\b|\b(in|from) the (supplied )?excerpts?\b|\bthe material supplied\b|\bthe segments? (provided|given)\b/i;
/** Speculation about the drafts' wording, which the Mission has not read. */
const UNSEEN_TEXT =
  /\b(any|the|its) (operative|preambular|binding) (language|wording|text|paragraphs?)\b|\boperative language\b|\bif the (draft|text|resolution) (contains|includes|implies|creates|adds)\b|\blanguage (implying|that implies|creating)\b/i;

/** Failures for one visible text; `where` names it in the message. */
export function checkLanguage(text: string, where: string, opts: { draftsRead?: boolean } = {}): string[] {
  const f: string[] = [];
  const codes = [...new Set(text.match(CODES) ?? [])];
  if (codes.length)
    f.push(`language: ${where} uses internal codes (${codes.join(', ')}); write the interest or red line in words`);
  const m = MACHINERY.exec(text);
  if (m) f.push(`language: ${where} mentions the machinery ("${m[0]}"); write about the meeting, not the material`);
  if (!opts.draftsRead) {
    const u = UNSEEN_TEXT.exec(text);
    if (u)
      f.push(
        `language: ${where} speculates about the draft's wording ("${u[0]}"); the draft text was not reviewed, reason from the debate`,
      );
  }
  return f;
}

/** The legal opinion's first line while the drafts are not read. */
export const DRAFTS_NOT_READ = 'Based on the debate; the draft text was not reviewed.';

/** Deterministic cleanup: the lead line once, however many times the model or the code wrote it. */
export function onceDraftsNotRead(text: string): string {
  const esc = DRAFTS_NOT_READ.replace(/[.;]/g, '\\$&');
  const lead = new RegExp(`^(\\s*${esc}\\s*)+`, 'i');
  return lead.test(text) ? `${DRAFTS_NOT_READ}\n\n${text.replace(lead, '')}` : text;
}

/** Red lines named outside the triage's engaged list. */
export function outsideEngaged(v: unknown, engaged: { red_lines: string[] }, where: string): string[] {
  const named = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const off = named.filter((r) => !engaged.red_lines.includes(r));
  return off.length
    ? [`profile: ${where} names red lines the matter does not engage (${off.join(', ')}); drop them`]
    : [];
}

/** The legal opinion stays in its field: no economic, trade or commercial arguments. */
const ECONOMIC =
  /\b(trade|trade-dependent|supply chains?|economic(ally)?|commerce|commercial|markets?|investments?|connectivity|digital trade|exports?|imports?)\b/i;

/** The head noun of a proper name of an organ, commission, body or document. */
const NAME_HEAD =
  'Council|Commission|Committee|Assembly|Organi[sz]ation|Conference|Board|Fund|Programme|Program|Office|Agency|Court|Tribunal|Forum|Bank|Union|Secretariat|Mission|Panel|Group|Partnership|Agreement|Convention|Treaty|Charter|Covenant|Protocol|Declaration|Statute|Agenda|Report|Resolution|Decision|Strategy|Framework|Plan|Compact';
const CAP = "[A-Z][A-Za-z'’-]*";
const LINK = '(?:and|of|the|on|for|in|to|against|de)';
/**
 * Proper names of organs, commissions, bodies and documents, read by their head noun ("Economic and Social
 * Council", "World Trade Organization", "Committee on Economic, Social and Cultural Rights"), and acronyms
 * ("ECOSOC", "UNCTAD").
 */
const PROPER_NAME = new RegExp(
  `\\b(?:${CAP}\\s+(?:${LINK}\\s+)*)*(?:${NAME_HEAD})\\b(?:\\s+(?:of|on|for|against)\\s+(?:the\\s+)?(?:${CAP},?(?:\\s+(?:${LINK}\\s+)*)?)+)?|\\b[A-Z]{2,}[a-z]?\\b|\\b(?:ECOSOC|Ecosoc)\\b`,
  'g',
);
/** A text without proper names of organs, bodies and documents: a name is never an argument of any field (2026-11-19). */
export const withoutProperNames = (text: string): string => text.replace(PROPER_NAME, ' ');

export function checkDesk(text: string, role: string): string[] {
  const m = role === 'legal' ? ECONOMIC.exec(withoutProperNames(text)) : null;
  return m ? [`desk: the legal opinion uses an economic argument ("${m[0]}"); keep to the legal questions`] : [];
}

const STOP = new Set(
  "about above after again against because before being between could every their there these those through under where which while would should state states state's assembly united nations meeting plenary committee".split(
    ' ',
  ),
);
const words = (t: string) =>
  new Set(
    t
      .toLowerCase()
      .match(/[a-z][a-z'-]{5,}/g)
      ?.map((w) => w.replace(/(ing|ed|es|s)$/, ''))
      .filter((w) => !STOP.has(w)) ?? [],
  );
/** Share of the distinctive words of `text` already used by `earlier` (0–1). */
export function overlap(text: string, earlier: string): number {
  const a = words(text);
  const b = words(earlier);
  if (!a.size) return 0;
  return [...a].filter((w) => b.has(w)).length / a.size;
}
/** Two opinions of one file may not cover the same ground (2026-11-13). */
// Unrelated opinions measured 0.17–0.20; two opinions that repeated each other 0.31–0.36 (2026-11-19).
export const OPINION_OVERLAP = 0.35; // 0.30 until the operator raised it on 2026-11-19

/** A press product is publishable: no internal reasoning; statements in the first person. */
const INTERNAL =
  /\bPermanent Representative (has )?decided\b|\bhas decided\b|\bthe decision\b|\boptions? [A-C]\b|\b(options|internal) memo\b|\binternal (draft|check|reasoning)\b|\bred lines?\b|\bnot for release\b/i;
export function checkPress(text: string, product: string): string[] {
  const f = checkLanguage(text, 'the press text');
  const m = INTERNAL.exec(text);
  if (m) f.push(`press: "${m[0]}" is internal; write the text as it would be delivered or published`);
  if (product !== 'press note' && !/\b(we|our|us|my delegation|my country)\b/i.test(text))
    f.push(`press: a ${product} is spoken by the State's representative, in the first person`);
  return f;
}
