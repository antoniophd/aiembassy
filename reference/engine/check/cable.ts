// The cable (2026-11-13): parsing, the text rendered by code, and the
// deterministic checks: every delegation, figure, tally and document symbol
// is in the accepted report; on full files the assessment keeps the
// decision's option and stands_with; no internal codes, no model names, no
// segment marks; 450–1,500 words (2026-11-24); new text against the report. Pure.
import { checkCopy } from './copy.ts';
import { isOfficer, type SegmentLike } from './groups.ts';
import {
  ambiguousSequences,
  namedWithoutEntry,
  removeName,
  usesAmbiguous,
  type CodeRepair,
  type Entry,
} from './record.ts';
import type { Body } from '../ingest/scope.ts';
import { checkLanguage } from './language.ts';
import { wordCount } from './source.ts';

export interface Cable {
  subject: string;
  summary: string;
  paragraphs: { title: string; text: string }[];
  assessment: string[];
  option: string | null;
  stands_with: string[] | null;
}

export class CableError extends Error {}
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function parseCable(raw: unknown): Cable {
  const o = (raw ?? {}) as Record<string, unknown>;
  const c: Cable = {
    subject: str(o.subject),
    summary: str(o.summary),
    paragraphs: (Array.isArray(o.paragraphs) ? o.paragraphs : []).map((p) => ({
      title: str((p as Record<string, unknown>)?.title),
      text: str((p as Record<string, unknown>)?.text),
    })),
    assessment: (Array.isArray(o.assessment) ? o.assessment : [o.assessment]).map(str).filter(Boolean),
    option: str(o.option) || null,
    stands_with: Array.isArray(o.stands_with) ? o.stands_with.map(str).filter(Boolean) : null,
  };
  if (!c.subject || !c.summary || !c.assessment.length)
    throw new CableError('A cable needs subject, summary and assessment');
  if (c.paragraphs.length < 1 || c.paragraphs.some((p) => !p.title || !p.text))
    throw new CableError('A cable needs numbered paragraphs, each with a title and text');
  return c;
}

const DATE = (d: string) =>
  new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** The cable as shown: header, then numbered paragraphs (Summary, topics, Assessment). */
export function renderCable(c: Cable, date: string): string {
  const n = c.paragraphs.length;
  return [
    'FROM: Permanent Mission, New York',
    'TO: Capital',
    `DATE: ${DATE(date)}`,
    `SUBJECT: ${c.subject}`,
    '',
    '## 1. Summary',
    c.summary,
    ...c.paragraphs.flatMap((p, i) => ['', `## ${i + 2}. ${p.title}`, p.text]),
    '',
    `## ${n + 2}. Assessment`,
    ...c.assessment.flatMap((a, i) => (i ? ['', a] : [a])),
  ].join('\n');
}

/** The prose a reader sees (header and numbering excluded). */
const prose = (c: Cable): string =>
  [c.subject, c.summary, ...c.paragraphs.flatMap((p) => [p.title, p.text]), ...c.assessment].join('\n');

const MODELS =
  /\b(deepseek|kimi|glm|qwen|llama|gpt-?\d*|claude|gemini|mistral|ollama|language model|AI model|the model)\b/i;
const SYMBOL = /\b(A\/[A-Z0-9.]+(?:\/[A-Z0-9.]+)*|S\/RES\/\d+|S\/\d{4}\/\d+|L\s?[./-]?\s?\d{1,3})\b/g;
const normSymbol = (s: string) => {
  const l = /^L\s?[./-]?\s?(\d{1,3})$/i.exec(s);
  return l ? 'L' + l[1] : s.toUpperCase().replace(/\s/g, '');
};
const NUMBER = /\b\d{1,3}(?:,\d{3})+\b|\b\d+(?:\.\d+)?\b/g;
/** Figures, leaving out the numbers inside document symbols (checked as symbols). */
const numbers = (t: string) => new Set((t.replace(SYMBOL, ' ').match(NUMBER) ?? []).map((x) => x.replace(/,/g, '')));

/** Bounds of the check (2026-11-24); the prompt aims at 900 words, one or two pages. */
export const CABLE_WORDS = { min: 450, max: 1500 };

export interface CableContext {
  reportText: string;
  /** The meeting's title and date: their figures need not be in the report (as in the source check). */
  metadata?: string;
  segments: SegmentLike[];
  decision: { option: string; stands_with: string[] } | null;
  /** The report's own entries (briefers, introductions, group statements, positions). */
  entries?: Entry[];
  body?: Body | null;
}

export function checkCable(c: Cable, ctx: CableContext): string[] {
  const f: string[] = [];
  const text = prose(c);
  const words = wordCount(text);
  if (words < CABLE_WORDS.min || words > CABLE_WORDS.max)
    f.push(`length: ${words} words; a cable has 450 to 1,500 words`);
  if (/\[E\d{1,2}\]/.test(text)) f.push('cable: no segment marks such as [E3]; the report carries the sources');
  if (/^\s*[-*•]\s/m.test(text)) f.push('cable: prose paragraphs, no bullet points');
  const m = MODELS.exec(text);
  if (m) f.push(`cable: "${m[0]}" names the machinery; remove it`);
  f.push(...checkLanguage(text, 'the cable', { draftsRead: true }));
  // Every figure, symbol and delegation must be in the accepted report.
  const reportNumbers = numbers(ctx.reportText + ' ' + (ctx.metadata ?? '').replace(/-/g, ' '));
  const extra = [...numbers(text)].filter((x) => !reportNumbers.has(x));
  if (extra.length) f.push(`cable: figures not in the report (${extra.slice(0, 8).join(', ')})`);
  const unclear = usesAmbiguous(text, ambiguousSequences(ctx.segments));
  if (unclear.length)
    f.push(
      `cable: ${unclear.join(', ')} come from an ambiguous sequence in the transcript; omit them or say they are unclear`,
    );
  const reportSymbols = new Set((ctx.reportText.match(SYMBOL) ?? []).map(normSymbol));
  const symbols = [...new Set((text.match(SYMBOL) ?? []).map(normSymbol))].filter((s) => !reportSymbols.has(s));
  if (symbols.length) f.push(`cable: document symbols not in the report (${symbols.join(', ')})`);
  const lower = ctx.reportText.toLowerCase();
  const names = new Set<string>();
  for (const s of ctx.segments)
    for (const sp of s.speakers) {
      if (isOfficer(sp.label, ctx.body)) continue;
      const base = (sp.label.split('·')[0] ?? sp.label)
        .trim()
        .replace(/\s*\(.*\)$/, '')
        .replace(/ of America$/, '');
      if (base.length >= 4) names.add(base);
    }
  const missing = [...names].filter(
    (n) =>
      new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text) &&
      !lower.includes(n.toLowerCase()),
  );
  if (missing.length) f.push(`cable: delegations not in the report (${missing.join(', ')})`);
  // A delegation the cable names needs an entry of its own in the report (2026-11-16).
  if (ctx.entries)
    for (const n of namedWithoutEntry(text, ctx.segments, ctx.entries, ctx.body).filter(
      (x) => !missing.some((y) => y.toLowerCase() === x.replace(/\s*\(.*\)$/, '')),
    ))
      f.push(`cable: ${n} has no entry of its own in the report; name only delegations with a position there`);
  // On full files the assessment keeps the decision.
  if (ctx.decision) {
    const norm = (xs: string[] | null) => [...new Set((xs ?? []).map((x) => x.toLowerCase()))].sort().join('|');
    if (c.option !== ctx.decision.option || norm(c.stands_with) !== norm(ctx.decision.stands_with))
      f.push(
        `cable: the assessment must keep the decision (option ${ctx.decision.option}, stands with ${ctx.decision.stands_with.join(', ')}); the cable said: option ${c.option ?? 'none'}, stands with ${(c.stands_with ?? []).join(', ') || 'none'}`,
      );
  }
  const copy = checkCopy(text, [ctx.reportText]);
  if (!copy.pass) f.push(`copy: ${Math.round(copy.ratio * 100)}% of sentences repeat the report`);
  return f;
}

/**
 * A delegation the cable names without an entry of its own in the report is removed from the cable by code,
 * not a reason to reject it (2026-11-19): from a list of names, or the sentence that names it. Mutates
 * the cable; returns each repair. The subject keeps its text if the removal would empty it (then the check
 * still rejects it).
 */
export function repairCableNames(
  c: Cable,
  segments: SegmentLike[],
  entries: Entry[],
  body?: Body | null,
): CodeRepair[] {
  const repairs: CodeRepair[] = [];
  for (const name of namedWithoutEntry(prose(c), segments, entries, body)) {
    const fix = (section: string, t: string): string => {
      const out = removeName(t, name);
      if (out !== t) repairs.push({ section, name, action: 'name_removed' });
      return out;
    };
    const subject = fix('subject', c.subject);
    if (subject.trim()) c.subject = subject;
    c.summary = fix('summary', c.summary);
    c.paragraphs = c.paragraphs.map((p, i) => ({ ...p, text: fix(`paragraph ${i + 2}`, p.text) }));
    c.assessment = c.assessment.map((a) => fix('assessment', a)).filter((a) => a.trim());
  }
  return repairs;
}
