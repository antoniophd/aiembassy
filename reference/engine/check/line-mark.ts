// The dossier mark (2026-11-23): "maintains" or "revises" depends only on the State's line (the sense of its
// vote, its stance and its conditions), never on the groups it coincides with. "revises" needs the line to change:
// another vote on the same text, or a different stance on the same question. Different texts with the same line
// are "maintains". A change of groups is said apart, in one sentence ("This time it coincides with …").
// By code where the record decides it; otherwise the decision's own mark, which must then say what changed.
import type { Decision } from './decision.ts';

export type LineBasis = 'code: same text, other vote' | 'code: other texts, same vote' | 'decision';

type Line = Pick<Decision, 'position' | 'would_have_voted' | 'voted_with' | 'vote'> & { line_change?: string | null };

/** Document symbols of the texts a decision acts on (L.5, L.16/Rev.1, S/2099/123, A/C.3/99/L.7). */
export function textsOf(d: Line): Set<string> {
  const all = [d.position, d.would_have_voted ?? '', ...(d.voted_with ?? []).map((v) => v.text)].join(' ');
  const out = new Set<string>();
  for (const m of all.matchAll(/\b(?:A\/[\w.]+\/)?L\.?\s?(\d+)(\/Rev\.?\s?\d+)?|\bS\/\d{4}\/\d+/g)) {
    const s = m[0].startsWith('S/') ? m[0] : `L.${m[1]}${m[2] ? '/Rev.' + m[2].replace(/\D/g, '') : ''}`;
    out.add(s);
  }
  return out;
}

/** The sense of a vote: in favour, against, abstain, or none (no vote, not participating, consensus). */
export function voteSense(v: string | null | undefined): 'in favour' | 'against' | 'abstain' | 'none' {
  const s = (v ?? '').toLowerCase();
  if (/abstain/.test(s)) return 'abstain';
  if (/against/.test(s)) return 'against';
  if (/favou?r|\byes\b/.test(s)) return 'in favour';
  return 'none';
}

/**
 * The mark of a decision against the earlier decision of its dossier (the standing one). With no earlier decision
 * the mark is "first" (set elsewhere, markChange) and nothing is done here.
 */
export function lineMark<D extends Line & { change: Decision['change'] }>(
  prev: Line | null,
  cur: D,
): D & { line_change: string | null; change_basis: LineBasis } {
  if (!prev || cur.change === 'first')
    return { ...cur, line_change: cur.line_change ?? null, change_basis: 'decision' };
  const a = textsOf(prev);
  const b = textsOf(cur);
  const shared = [...b].filter((t) => a.has(t));
  const before = voteSense(prev.vote);
  const now = voteSense(cur.vote);
  if (shared.length && before !== now && before !== 'none' && now !== 'none')
    return {
      ...cur,
      change: 'revises',
      line_change: `It now votes ${now} on ${shared.join(', ')}, where it voted ${before}.`,
      change_basis: 'code: same text, other vote',
    };
  if (a.size && b.size && !shared.length && before === now)
    return { ...cur, change: 'maintains', line_change: null, change_basis: 'code: other texts, same vote' };
  return { ...cur, line_change: cur.line_change ?? null, change_basis: 'decision' };
}

/** "revises" must say what changed in the line. */
export function lineMarkFailures(d: { change: string; line_change?: string | null }): string[] {
  return d.change === 'revises' && !d.line_change?.trim()
    ? [
        'dossier: "revises" needs "line_change": what changed in the State\'s line (another vote on the same text, or a different stance on the same question); with the same line, mark it "maintains"',
      ]
    : [];
}

const list = (g: string[]) => (g.length > 1 ? `${g.slice(0, -1).join(', ')} and ${g.at(-1)}` : (g[0] ?? ''));
const national = (g: string[]) => g.length === 1 && g[0]!.toLowerCase() === 'national capacity';

/** The change of groups, said apart from the mark; null when the groups are the same. */
export function coincidesNote(before: string[], now: string[]): string | null {
  const n = (x: string[]) => [...new Set(x.map((s) => s.toLowerCase().trim()))].sort().join('|');
  if (n(before) === n(now)) return null;
  const was = national(before) ? 'it acted in national capacity' : `with ${list(before)}`;
  return national(now)
    ? `This time it acts in national capacity (before: ${was}).`
    : `This time it coincides with ${list(now)} (before: ${was}).`;
}
