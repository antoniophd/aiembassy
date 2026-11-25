// The press pack's checks, by code (2026-11-25). Pure: no model.
//   length    remarks 120–180 words, question ≤ 30, answer ≤ 60, release 200–300 (headline and dateline
//             included), social ≤ 280 characters, no emoji, at most one hashtag
//   grounding every figure, document symbol and proper name is in the accepted documents of the file
//   coherence the same option and vote as the decision; no sentence where the State votes otherwise; the
//             release's quote is in its body and says what the remarks say
//   tone      no delegation or group named in a critical sentence; no platform, model or internal machinery
import { PACK_LIMITS } from '../../prompts/press.pack.ts';
import { sideOf, stateSide, type Side } from './coherence.ts';
import type { Decision } from './decision.ts';
import { checkLanguage } from './language.ts';
import { MEMBER_STATES, OBSERVER_STATES } from './member-states.ts';
import { wordCount } from './source.ts';
import { checkPackAdoption, checkPackQuote, checkPackRelease, type Adoption } from './press-pack-form.ts';

export interface PressPack {
  option: string;
  vote: string | null;
  stakeout: { remarks: string; question: string; answer: string };
  release: { headline: string; dateline: string; body: string; quote: string };
  social: string;
}

export class PressPackOutputError extends Error {}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The model's answer as a pack; a missing part is an output error. */
export function parsePressPack(o: unknown): PressPack {
  const x = (o ?? {}) as Record<string, Record<string, unknown> | unknown>;
  const s = (x.stakeout ?? {}) as Record<string, unknown>;
  const r = (x.release ?? {}) as Record<string, unknown>;
  const pack: PressPack = {
    option: str(x.option),
    vote: str(x.vote) || null,
    stakeout: { remarks: str(s.remarks), question: str(s.question), answer: str(s.answer) },
    release: { headline: str(r.headline), dateline: str(r.dateline), body: str(r.body), quote: str(r.quote) },
    social: str(x.social),
  };
  const missing = [
    ['stakeout.remarks', pack.stakeout.remarks],
    ['stakeout.question', pack.stakeout.question],
    ['stakeout.answer', pack.stakeout.answer],
    ['release.headline', pack.release.headline],
    ['release.dateline', pack.release.dateline],
    ['release.body', pack.release.body],
    ['release.quote', pack.release.quote],
    ['social', pack.social],
  ].filter(([, v]) => !v);
  if (missing.length) throw new PressPackOutputError(`Press pack missing ${missing.map(([k]) => k).join(', ')}`);
  return pack;
}

/** The release as published: headline, dateline, body. */
export const releaseText = (p: PressPack): string => `${p.release.headline}\n${p.release.dateline}\n${p.release.body}`;

/** Every visible part, by name. */
export const packParts = (p: PressPack): [string, string][] => [
  ['stakeout remarks', `${p.stakeout.remarks}\n${p.stakeout.question}\n${p.stakeout.answer}`],
  ['press release', releaseText(p)],
  ['social media post', p.social],
];

export function checkPackLength(p: PressPack): string[] {
  const f: string[] = [];
  const L = PACK_LIMITS;
  const words = (s: string) => wordCount(s);
  const remarks = words(p.stakeout.remarks);
  if (remarks < L.remarks.min || remarks > L.remarks.max)
    f.push(
      `length: the stakeout remarks have ${remarks} words; write ${L.remarks.min} to ${L.remarks.max}` +
        (remarks < L.remarks.min
          ? ` (add about ${160 - remarks} words: more short sentences)`
          : ` (cut about ${remarks - 160} words)`),
    );
  if (words(p.stakeout.question) > L.question.max)
    f.push(`length: the question has ${words(p.stakeout.question)} words; at most ${L.question.max}`);
  if (words(p.stakeout.answer) > L.answer.max)
    f.push(`length: the answer has ${words(p.stakeout.answer)} words; at most ${L.answer.max}`);
  const release = words(releaseText(p));
  if (release < L.release.min || release > L.release.max)
    f.push(
      `length: the press release has ${release} words with headline and dateline; write ${L.release.min} to ${L.release.max}` +
        (release < L.release.min ? ` (add about ${260 - release} words)` : ''),
    );
  const chars = [...p.social].length;
  if (chars > L.social.maxChars)
    f.push(`length: the social media post has ${chars} characters; at most ${L.social.maxChars}`);
  if (/\p{Extended_Pictographic}/u.test(p.social)) f.push('social: no emoji');
  const tags = p.social.match(/#\w+/g) ?? [];
  if (tags.length > L.social.hashtags) f.push(`social: ${tags.length} hashtags; at most ${L.social.hashtags}`);
  return f;
}

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
/** Names any press text may use: the State, the Mission's own offices, the UN and its main organs, places of work. */
const ALWAYS = new RegExp(
  `^(the )?(State|Permanent Representative|Permanent Mission|Mission|United Nations|UN|General Assembly|Security Council|(First|Second|Third|Fourth|Fifth|Sixth) Committee|Committee|Assembly|Council|Charter|Member States?|New York|Secretary-General|I|We|My|Our|Today|Mr|Ms|Madam|President|Chair|Q|A|Headline|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|${MONTHS})$`,
  'i',
);
/** Words that open a sentence without being a name. */
const OPENERS =
  /^(The|This|That|These|Those|It|Its|In|On|At|As|For|With|By|And|But|So|We|Our|My|I|Today|Tonight|Yesterday|Tomorrow|Here|There|What|Why|How|When|Where|Who|Will|Does|Do|Did|Is|Are|Was|Our|Let|Yes|No|Thank|After|Before|Together|Every|All|A|An|Both|Such|While|Once|Now|Only|Asked)$/;

/** Figures written in digits, document symbols and capitalised names used in a text. */
export function mentions(text: string): { figures: string[]; symbols: string[]; names: string[] } {
  const clean = text.replace(/#\w+/g, ' ');
  const symbols = [...clean.matchAll(/\b(?:[AS]\/[A-Z0-9][\w.\/-]*[\w]|L\.\d+(?:\/Rev\.\d+)?)/g)].map((m) => m[0]);
  const noSymbols = symbols.reduce((t, s) => t.split(s).join(' '), clean);
  const figures = [...noSymbols.matchAll(/\b\d[\d,.]*\d\b|\b\d\b/g)].map((m) => m[0].replace(/[.,]$/, ''));
  const names: string[] = [];
  const NAME = /[A-Z][\w’'-]*(?:\s+(?:of|and|the|for|de)?\s*[A-Z][\w’'-]*)*/g;
  for (const sentence of noSymbols.split(/(?<=[.!?:;"”])\s+|\n+/)) {
    for (const m of sentence.trim().matchAll(NAME)) {
      let words = m[0].split(/\s+/).filter(Boolean);
      // A single capitalised word that opens a sentence is an ordinary word as often as a name: not read.
      if (m.index === 0 && words.length === 1) continue;
      if (m.index === 0 && OPENERS.test(words[0] ?? '')) words = words.slice(1);
      while (words.length && /^(of|and|the|for|de)$/.test(words[0]!)) words = words.slice(1);
      const name = words.join(' ').replace(/[’']s$/, '');
      if (name && !ALWAYS.test(name) && !/^\d/.test(name)) names.push(name);
    }
  }
  return { figures, symbols, names };
}

/** Figures, symbols and names of the pack that are not in the accepted documents (`sources`). */
export function checkPackGrounding(p: PressPack, sources: string[], meetingDate: string): string[] {
  const corpus = norm(sources.join('\n'));
  const digits = corpus.replace(/(\d),(\d)/g, '$1$2');
  const flat = corpus.replace(/[.\s]/g, '');
  const [y, mo, d] = meetingDate.split('-');
  const dateParts = new Set([y, String(Number(mo)), String(Number(d)), d, mo]);
  const f: string[] = [];
  for (const [part, text] of packParts(p)) {
    const m = mentions(text);
    // A headline is in title case: its names are read in the body, its figures and symbols here.
    if (part === 'press release') m.names = mentions(text.split('\n').slice(1).join('\n')).names;
    for (const x of new Set(m.figures))
      if (
        !dateParts.has(x) &&
        !new RegExp(`(^|[^\\d])${x.replace(/,/g, '').replace(/\./g, '\\.')}([^\\d]|$)`).test(digits)
      )
        f.push(`grounding: the ${part} uses the figure "${x}", which is in no accepted document of the file`);
    for (const x of new Set(m.symbols))
      if (!flat.includes(norm(x).replace(/[.\s]/g, '')))
        f.push(`grounding: the ${part} cites "${x}", which is in no accepted document of the file`);
    for (const x of new Set(m.names))
      if (!corpus.includes(norm(x)))
        f.push(`grounding: the ${part} names "${x}", which is in no accepted document of the file`);
  }
  return f;
}

/** A sentence where the State itself votes ("we will vote in favour", "my delegation abstained"). */
const STATE_VOTES =
  /\b(we|I|my delegation|my country|the State|the Permanent Mission)\b[^.;!?]{0,80}\b(vote[sd]?|voting|abstain(s|ed|ing)?|support(s|ed)? the (draft|resolution|text)|join(s|ed)? (the )?consensus)\b/i;

export function checkPackCoherence(p: PressPack, d: Pick<Decision, 'option' | 'vote' | 'would_have_voted'>): string[] {
  const f: string[] = [];
  if (p.option.toUpperCase() !== String(d.option).toUpperCase())
    f.push(`coherence: the pack is written for option ${p.option || 'none'}; the decision chose option ${d.option}`);
  if ((d.vote ?? null) !== null && p.vote !== d.vote)
    f.push(`coherence: the pack says the vote is "${p.vote ?? 'none'}"; the decision says "${d.vote}"`);
  const side: Side | null = stateSide(d);
  for (const [part, text] of packParts(p))
    for (const s of text.split(/(?<=[.!?;])\s+|\n+/))
      if (STATE_VOTES.test(s)) {
        // The side is read right after the vote verb: "voted for the text on violence against women" is a vote
        // in favour, not against.
        const m = /\b(?:voted?|votes|voting)\s+(in favou?r|for|yes|against|no)\b/i.exec(s);
        const said: Side | null = m
          ? /against|no/i.test(m[1]!)
            ? 'against'
            : 'in favour'
          : /\babstain(s|ed|ing)?\b/i.test(s)
            ? 'abstain'
            : null;
        if (said && said !== side)
          f.push(
            `coherence: the ${part} says the State votes ${said}; the decision says ${side ?? d.vote ?? 'no vote'}: "${s.slice(0, 120)}"`,
          );
      }
  // Every sentence of the quote is in the body, word for word; an attribution may split it ("…," she said. "…").
  const bare = (x: string) =>
    norm(x)
      .replace(/[“”"«»,.;:!?]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const body = bare(p.release.body);
  if (!p.release.quote.split(/(?<=[.!?])\s+/).every((q) => body.includes(bare(q))))
    f.push('coherence: the quote is not in the body of the press release, word for word');
  return f;
}

/** Words of blame or reproach. */
const CRITICAL =
  /\b(regret(s|ted|table)?|deplor(e|es|ed|able)|condemn(s|ed)?|blam(e|es|ed)|fail(s|ed)? to|failure of|obstruct(s|ed|ion|ive)?|block(s|ed|ing)|irresponsib(le|ly)|unacceptabl[ey]|disappoint(ed|ing|ment)|criticis(e|es|ed)|criticiz(e|es|ed)|accus(e|es|ed)|hypocri(sy|tical)|shameful|cynical|reckless|undermin(e|es|ed|ing)|sabotag(e|es|ed)|bad faith)\b/i;
/** Platforms, models and the internal machinery. */
const MACHINE =
  /\b(AI (agents?|models?|systems?|tools?)|language models?|LLMs?|chatbots?|algorithms?|prompts?|agents of the Mission|generated by|this (site|website|platform|page)|Twitter|X\.com|Facebook|Instagram|LinkedIn|Bluesky|Threads|Mastodon|TikTok|YouTube|WhatsApp|Telegram|Weibo|tweet(s|ed)?)\b/i;
const INTERNAL =
  /\bPermanent Representative (has )?decided\b|\bthe decision\b|\boptions? [A-C]\b|\b(options|internal) memo\b|\binternal (draft|check|reasoning|process)\b|\bred lines?\b|\bnot for release\b|\bdraft (statement|release|post)\b/i;

export function checkPackTone(p: PressPack, groups: readonly string[]): string[] {
  const f: string[] = [];
  const delegations = [...MEMBER_STATES, ...OBSERVER_STATES, ...groups.filter((g) => g !== 'national capacity')];
  for (const [part, text] of packParts(p)) {
    for (const s of text.split(/(?<=[.!?;])\s+|\n+/)) {
      if (!CRITICAL.test(s)) continue;
      const named = delegations.filter((n) => new RegExp(`\\b${n.replace(/[()]/g, '\\$&')}\\b`).test(s));
      if (named.length)
        f.push(
          `tone: the ${part} names ${named.join(', ')} in a critical sentence: "${s.slice(0, 120)}"; speak for the State, blame no one`,
        );
    }
    const m = MACHINE.exec(text) ?? INTERNAL.exec(text);
    if (m) f.push(`tone: the ${part} mentions "${m[0]}"; no platform, model or internal process`);
    f.push(...checkLanguage(text, `the ${part}`));
  }
  return f;
}

/** Procedural jargon a journalist would not follow (2026-11-25): not in the stakeout remarks. */
const JARGON =
  /\b(explanations? of (the )?vote|operative paragraphs?|preambular paragraphs?|\b[OP]P ?\d+|no-action motion|agenda item|draft resolution [A-Z]\/|rule \d+ of the rules of procedure)\b/i;
const SYMBOL = /\b(?:[AS]\/[A-Z0-9][\w.\/-]*\w|L\.\d+(?:\/Rev\.\d+)?)/;

/** Plain words in the remarks; "plenary meeting" only for the Assembly's own meetings (2026-11-25). */
export function checkPackPlain(p: PressPack, body: string): string[] {
  const f: string[] = [];
  const spoken = `${p.stakeout.remarks}\n${p.stakeout.question}\n${p.stakeout.answer}`;
  const j = JARGON.exec(spoken);
  if (j)
    f.push(
      `plain: the stakeout remarks use procedural jargon ("${j[0]}"); say what the State voted and why, in plain words`,
    );
  const s = SYMBOL.exec(spoken);
  if (s) f.push(`plain: the stakeout remarks cite the symbol "${s[0]}"; name the subject of the text instead`);
  if (body !== 'ga_plenary')
    for (const [part, text] of packParts(p))
      if (/\bplenary meetings?\b/i.test(text))
        f.push(
          `body: the ${part} says "plenary meeting"; this was a meeting of a committee or the Council, not of the General Assembly itself`,
        );
  return f;
}

/** Every check; empty = pass. */
export function checkPressPack(
  p: PressPack,
  ctx: {
    decision: Decision;
    sources: string[];
    meetingDate: string;
    groups: readonly string[];
    body: string;
    /** How each text of the meeting was adopted, from the report. */
    adoption: Adoption[];
    /** The body without the meeting number ("the Third Committee of the General Assembly"). */
    organ: string;
  },
): string[] {
  return [
    ...checkPackAdoption(p, ctx.adoption),
    ...checkPackQuote(p),
    ...checkPackRelease(p, ctx.organ),
    ...checkPackPlain(p, ctx.body),
    ...checkPackLength(p),
    ...checkPackGrounding(p, ctx.sources, ctx.meetingDate),
    ...checkPackCoherence(p, ctx.decision),
    ...checkPackTone(p, ctx.groups),
  ];
}

/** The pack as one text, the three parts under their headings. */
export function renderPressPack(p: PressPack): string {
  return [
    '## Stakeout remarks',
    p.stakeout.remarks,
    `Q: ${p.stakeout.question}`,
    `A: ${p.stakeout.answer}`,
    '## Press release',
    `**${p.release.headline}**`,
    p.release.dateline,
    p.release.body,
    '## Social media post',
    p.social,
  ].join('\n\n');
}
