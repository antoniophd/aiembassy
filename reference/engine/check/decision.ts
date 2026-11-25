// Checks 4, 5 and 6 on the options memo, the decision and the press product.
// Pure: no model. Each returns the list of failures (empty = pass).
import { lineMarkFailures } from './line-mark.ts';
import type { StateProfile } from '../profile/index.ts';
import { isKnownGroup } from '../profile/index.ts';
import { wordCount } from './source.ts';

export const GUIDE = { opinion: 250, options_memo: 350, decision: 300, position: 60, press: 200 } as const;
export const cap = (kind: keyof typeof GUIDE): number => GUIDE[kind] * 2;

/** What the State votes at the next step; "no vote" only when nothing is put to the vote (2026-11-13). */
export const VOTES = ['in favour', 'against', 'abstain', 'join consensus', 'not participate', 'no vote'] as const;
export type Vote = (typeof VOTES)[number];

export interface MemoOption {
  id: string;
  /** What the State votes at the next step. Silence is not a vote. */
  vote: Vote;
  /** Whether the State takes the floor (a statement or an explanation of vote), apart from the vote. */
  takes_floor: boolean;
  action: string;
  benefit: string;
  risk: string;
  stands_with: string[];
}
export interface Memo {
  options: MemoOption[];
  recommendation: { option: string; reason: string; prevailing_interest: string };
  /** When the decision point was already taken: what the State would have voted, and why. */
  would_have_voted: string | null;
}
/** A group on the decision point: the same position, a different one, or it did not address the point. */
export type Stance = 'same' | 'different' | 'not_addressed';
export const PRESS = ['none', 'statement', 'explanation of vote', 'press note', 'stakeout lines'] as const;
export interface Decision {
  position: string;
  option: string;
  why: string;
  rejected: { option: string; why: string }[];
  interests: string[];
  red_lines: string[];
  stands_with: string[];
  stands_with_reason: string;
  /** Known groups that took the floor: did they defend the position the State adopts? (stands_with rule) */
  /** `opposes`: with stance "different", the group takes the opposite position (opposite vote, rejects the text or the forum). */
  group_positions: { group: string; cite: string; position: string; stance: Stance; opposes?: boolean }[];
  /** By text: the States that, by the report, voted the same way, each with its segment and any partial abstention. */
  voted_with: { text: string; states: { state: string; cite: string; note: string | null }[] }[];
  /** The vote and the floor of the option chosen. */
  vote: Vote | null;
  takes_floor: boolean | null;
  /** When the decision point was already taken: what the State would have voted, and why. */
  would_have_voted: string | null;
  /** Only with "national capacity" when some group spoke: the nearest group and where the State differs. */
  closest_to: string | null;
  differs_on: { text: string; cite: string } | null;
  change: 'first' | 'maintains' | 'revises';
  /** With "revises": what changed in the State's line, one sentence (2026-11-23). */
  line_change?: string | null;
  reopens_if: string;
  press: (typeof PRESS)[number];
}

export class StructureError extends Error {}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const normVote = (v: unknown): Vote => {
  const s = str(v)
    .toLowerCase()
    .replace(/^vote /, '')
    .replace('favor', 'favour')
    .replace(/^yes$/, 'in favour');
  const x = s === 'abstention' || s === 'abstains' ? 'abstain' : s === 'no' ? 'against' : s;
  return ((VOTES as readonly string[]).includes(x) ? x : '') as Vote;
};

/** voted_with by text; earlier decisions had one flat list of States. */
export function votedWithOf(v: unknown): Decision['voted_with'] {
  const xs = Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
  const state = (p: Record<string, unknown>) => ({
    state: str(p.state),
    cite: str(p.cite).replace(/^\[|\]$/g, ''),
    note: str(p.note) || null,
  });
  if (xs.every((x) => x && typeof x === 'object' && 'state' in x))
    return xs.length ? [{ text: '', states: xs.map(state) }] : [];
  return xs
    .map((x) => ({
      text: str(x?.text),
      states: (Array.isArray(x?.states) ? (x.states as Record<string, unknown>[]) : []).map(state),
    }))
    .filter((t) => t.states.length); // a text with no State that voted the same way is not listed
}

/** "L/12: Arvenia [E1], Belmora [E4] (abstained on PP2 and OP1); L/8: Corvalia [E2]" (invented names) */
export const votedWithText = (d: Pick<Decision, 'voted_with'>): string =>
  d.voted_with
    .map(
      (t) =>
        (t.text ? t.text + ': ' : '') +
        t.states.map((v) => `${v.state} [${v.cite}]${v.note ? ` (${v.note})` : ''}`).join(', '),
    )
    .join('; ');

/** Stance of a group entry; earlier decisions recorded only same: true / false. */
export function stanceOf(p: Record<string, unknown>): Stance {
  const s = str(p.stance)
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (s === 'same' || s === 'same_position') return 'same';
  if (s === 'not_addressed' || s === 'did_not_address' || s === 'did_not_address_this_item') return 'not_addressed';
  if (s === 'different' || s === 'different_position') return 'different';
  return p.same === true || p.same === 'true' ? 'same' : 'different';
}

/** The stance as shown: "different position" becomes "opposes the State's position" when it does. */
export const stanceText = (g: Record<string, unknown>): string =>
  stanceOf(g) === 'different' && g.opposes === true ? "opposes the State's position" : STANCE_LABEL[stanceOf(g)];

export const STANCE_LABEL: Record<Stance, string> = {
  same: 'same position',
  different: 'different position',
  not_addressed: 'did not address this item',
};
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter(Boolean) : typeof v === 'string' && v.trim() ? [v.trim()] : [];

export function parseMemo(raw: unknown): Memo {
  const o = (raw ?? {}) as Record<string, unknown>;
  const options = (Array.isArray(o.options) ? o.options : []).map((x) => {
    const p = (x ?? {}) as Record<string, unknown>;
    return {
      id: str(p.id),
      vote: normVote(p.vote),
      takes_floor: p.takes_floor === true || p.takes_floor === 'true',
      action: str(p.action),
      benefit: str(p.benefit),
      risk: str(p.risk),
      stands_with: list(p.stands_with),
    };
  });
  const r = (o.recommendation ?? {}) as Record<string, unknown>;
  const memo = {
    options,
    recommendation: { option: str(r.option), reason: str(r.reason), prevailing_interest: str(r.prevailing_interest) },
    would_have_voted: str(o.would_have_voted) || null,
  };
  if (options.length < 2 || options.length > 3) throw new StructureError('A memo needs 2 or 3 options');
  if (options.some((p) => !p.id || !p.action || !p.benefit || !p.risk || !p.stands_with.length))
    throw new StructureError('Every option needs id, action, benefit, risk and stands_with');
  if (options.some((p) => !p.vote))
    throw new StructureError(`Every option says what the State votes: ${VOTES.join(', ')}; silence is not a vote`);
  if (new Set(options.map((p) => p.id)).size !== options.length) throw new StructureError('Option ids repeat');
  if (!options.some((p) => p.id === memo.recommendation.option))
    throw new StructureError('The recommendation must name one of the options');
  return memo;
}

export function parseDecision(raw: unknown): Decision {
  const o = (raw ?? {}) as Record<string, unknown>;
  const d: Decision = {
    position: str(o.position),
    option: str(o.option),
    why: str(o.why),
    rejected: (Array.isArray(o.rejected) ? o.rejected : []).map((x) => {
      const p = (x ?? {}) as Record<string, unknown>;
      return { option: str(p.option), why: str(p.why) };
    }),
    interests: list(o.interests),
    red_lines: list(o.red_lines),
    stands_with: list(o.stands_with),
    stands_with_reason: str(o.stands_with_reason),
    group_positions: (Array.isArray(o.group_positions) ? o.group_positions : []).map((x) => {
      const p = (x ?? {}) as Record<string, unknown>;
      return {
        group: str(p.group),
        cite: str(p.cite).replace(/^\[|\]$/g, ''),
        position: str(p.position),
        stance: stanceOf(p),
        opposes: stanceOf(p) === 'different' && (p.opposes === true || p.opposes === 'true'),
      };
    }),
    voted_with: votedWithOf(o.voted_with),
    vote: normVote(o.vote) || null,
    takes_floor: typeof o.takes_floor === 'boolean' ? o.takes_floor : null,
    would_have_voted: str(o.would_have_voted) || null,
    closest_to: str(o.closest_to) || null,
    differs_on: (() => {
      const x = (o.differs_on ?? null) as Record<string, unknown> | null;
      const text = x && typeof x === 'object' ? str(x.text) : str(o.differs_on);
      return text ? { text, cite: x && typeof x === 'object' ? str(x.cite) : '' } : null;
    })(),
    change: str(o.change) as Decision['change'],
    line_change: str(o.line_change) || null,
    reopens_if: str(o.reopens_if),
    press: (str(o.press) || 'none') as Decision['press'],
  };
  if (!d.position || !d.option || !d.why || !d.stands_with.length || !d.reopens_if)
    throw new StructureError('A decision needs position, option, why, stands_with and reopens_if');
  // The model chooses only between "maintains" and "revises"; "first" is set by code (markChange) when the
  // dossier has no standing position (2026-11-19). An empty or "first" mark is read there.
  if (d.change && !['first', 'maintains', 'revises'].includes(d.change))
    throw new StructureError('change must be maintains or revises');
  if (!(PRESS as readonly string[]).includes(d.press)) throw new StructureError('Invalid press');
  if (d.voted_with.some((t) => t.states.some((v) => !v.state || !v.cite)))
    throw new StructureError('voted_with needs state and cite');
  if (/no formal outcome was recorded/i.test(d.position)) throw new StructureError('A finding is not a position');
  return d;
}

const groupFailures = (profile: StateProfile, groups: string[], where: string): string[] =>
  groups.filter((g) => !isKnownGroup(profile, g)).map((g) => `profile: unknown group "${g}" in ${where}`);

export function checkMemo(memo: Memo, words: number, profile: StateProfile): string[] {
  const f: string[] = [];
  if (words > cap('options_memo')) f.push(`length: ${words} words; hard cap ${cap('options_memo')}`);
  for (const p of memo.options) f.push(...groupFailures(profile, p.stands_with, 'option ' + p.id));
  const ids = new Set(profile.interests.map((i) => i.id));
  if (memo.recommendation.prevailing_interest && !ids.has(memo.recommendation.prevailing_interest))
    f.push(`profile: unknown interest ${memo.recommendation.prevailing_interest}`);
  return f;
}

export interface StandingPosition {
  stands_with: string[] | null;
}

const hasStanding = (standing: StandingPosition | null | undefined): boolean =>
  !!standing?.stands_with && standing.stands_with.length > 0;

/**
 * The dossier mark set by code (2026-11-19): "first" when the dossier has no standing position, whatever
 * the model wrote; otherwise the model's "maintains" or "revises" is kept (and checked by checkDecision).
 */
export function markChange<D extends Pick<Decision, 'change'>>(d: D, standing: StandingPosition | null | undefined): D {
  return hasStanding(standing) ? d : { ...d, change: 'first' };
}

/** Red lines of the profile the decision names and the triage did not mark (2026-11-19). */
export function redLinesAdded(named: string[], engaged: { red_lines: string[] }, profile: StateProfile): string[] {
  const known = new Set(profile.red_lines.map((r) => r.id));
  return [...new Set(named)].filter((r) => known.has(r) && !engaged.red_lines.includes(r));
}

const sameGroups = (a: string[], b: string[]): boolean => {
  const n = (x: string[]) => [...new Set(x.map((s) => s.toLowerCase().trim()))].sort().join('|');
  return n(a) === n(b);
};

/** Checks 4, 5 and 6 on a decision. */
export function checkDecision(
  d: Decision,
  words: number,
  memo: Memo,
  profile: StateProfile,
  standing: StandingPosition | null,
): string[] {
  const f: string[] = [];
  if (words > cap('decision')) f.push(`length: ${words} words; hard cap ${cap('decision')}`);
  if (wordCount(d.position) > cap('position'))
    f.push(`length: position ${wordCount(d.position)} words; hard cap ${cap('position')}`);
  const chosen = memo.options.find((p) => p.id === d.option);
  if (!chosen) f.push(`structure: option ${d.option} is not in the memo`);
  else if (chosen.vote && (d.vote !== chosen.vote || d.takes_floor !== chosen.takes_floor))
    f.push(
      `structure: option ${d.option} votes "${chosen.vote}" and ${chosen.takes_floor ? 'takes' : 'does not take'} the floor; give the same "vote" and "takes_floor"`,
    );
  f.push(...checkReopens(d.reopens_if));
  const interests = new Set(profile.interests.map((i) => i.id));
  const redLines = new Set(profile.red_lines.map((r) => r.id));
  if (!d.interests.length) f.push('profile: the decision names no interest');
  for (const i of d.interests) if (!interests.has(i)) f.push(`profile: unknown interest ${i}`);
  for (const r of d.red_lines) if (!redLines.has(r)) f.push(`profile: unknown red line ${r}`);
  f.push(...groupFailures(profile, d.stands_with, 'the decision'));
  const has = hasStanding(standing);
  if (has && d.change !== 'maintains' && d.change !== 'revises')
    f.push('dossier: the dossier has a standing position; say "maintains" or "revises"');
  if (!has && d.change !== 'first') f.push(`dossier: "${d.change}" but the dossier has no standing position`);
  // The mark follows the State's line, not the groups (2026-11-23): "revises" says what changed.
  if (has) f.push(...lineMarkFailures(d));
  return f;
}

/** What reopens a file is an event the body can produce: a vote, an amendment, a new draft, a report, a decision. */
const BODY_EVENT =
  /\b(adopt\w*|vot\w+|amend\w*|draft\w*|resolution|report\w*|decid\w+|decision|defer\w*|reject\w*|request\w*|session|plenary|Council|Assembly|Committee|mandate|renew\w*|withdraw\w*|table[sd]?|introduc\w+|recommend\w*)\b/i;
export function checkReopens(text: string): string[] {
  if (/\bthe State (would|will|may|should)\b|\bif the State\b/i.test(text))
    return ['reopens_if: name an event the body can produce, not what the State would do'];
  if (!BODY_EVENT.test(text))
    return ['reopens_if: name an event the body can produce (a vote, an amendment, a new draft, a report, a decision)'];
  return [];
}

export function decisionText(d: Decision, profile?: StateProfile): string {
  const interest = (id: string) => profile?.interests.find((i) => i.id === id)?.text.replace(/\.$/, '') ?? id;
  const red = (id: string) => profile?.red_lines.find((r) => r.id === id)?.text.replace(/\.$/, '') ?? id;
  return [
    `Position: ${d.position}`,
    `Option chosen: ${d.option}. ${d.why}`,
    ...d.rejected.map((r) => `Rejected ${r.option}: ${r.why}`),
    ...(d.would_have_voted ? [`Would have voted: ${d.would_have_voted}`] : []),
    `Stands with: ${d.stands_with.join(', ')}. ${d.stands_with_reason}`,
    ...(d.closest_to
      ? [`Closest to: ${d.closest_to}. Differs on: ${d.differs_on?.text ?? ''} [${d.differs_on?.cite ?? ''}]`]
      : []),
    ...d.group_positions.map((g) => `${g.group} [${g.cite}]: ${stanceText(g)}. ${g.position}`),
    ...(d.vote ? [`Vote: ${d.vote}. Takes the floor: ${d.takes_floor ? 'yes' : 'no'}.`] : []),
    ...(d.voted_with.length ? [`Voted the same way: ${votedWithText(d)}.`] : []),
    `Interests: ${d.interests.map(interest).join('; ')}${d.red_lines.length ? '. Red lines in play: ' + d.red_lines.map(red).join('; ') : ''}.`,
    `Against the dossier: ${d.change}${d.line_change ? ` (${d.line_change.replace(/\.$/, '')})` : ''}. Reopens if: ${d.reopens_if}`,
    `Press: ${d.press}.`,
  ].join('\n');
}

export function memoText(m: Memo): string {
  return [
    ...m.options.map(
      (p) =>
        `Option ${p.id}: Vote: ${p.vote}. Takes the floor: ${p.takes_floor ? 'yes' : 'no'}. ${p.action} Benefit: ${p.benefit} Risk: ${p.risk} Stands with: ${p.stands_with.join(', ')}.`,
    ),
    `Recommendation: option ${m.recommendation.option}. ${m.recommendation.reason}`,
    ...(m.would_have_voted ? [`Would have voted: ${m.would_have_voted}`] : []),
  ].join('\n');
}

/** Check 9 · stability: same option and same stands_with. */
export const stable = (a: Decision, b: Decision): boolean =>
  a.option === b.option && sameGroups(a.stands_with, b.stands_with);
