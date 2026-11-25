// Coherence of a decision (2026-11-19), checked by code. (1) On a
// recorded vote in a body the State belongs to, the decision says yes, no or
// abstain: "no vote" (or consensus, or not participating) is not valid. On a
// point already taken the vote is read from what the State would have voted.
// (2) stands_with names only groups whose position matches the State's vote or
// position: when the State abstains or takes no side, it cannot stand with
// groups that took one. A group's side is read from its position in the
// decision's group_positions. Pure: no model.
import type { Body } from '../ingest/scope.ts';
import type { Decision } from './decision.ts';
import { NATIONAL, type SegmentLike } from './groups.ts';
import { transcriptTallies } from './record.ts';

export type Side = 'in favour' | 'against' | 'abstain';

/** The State is a member of the General Assembly and its committees, not of the Council (profile, at_the_un). */
export const stateVotesIn = (body: Body | null | undefined): boolean => !!body && body !== 'security_council';

/** A tally line: "130 in favour, 17 against, 25 abstentions", in figures. */
const TALLY_LINE = /\b\d+\s+in favou?r\b.{0,40}\b(\d+\s+against|against,?\s+\d+)/i;

/** The transcript records a recorded vote: a tally announced, or "recorded vote" said. */
export const recordedVote = (segments: SegmentLike[]): boolean =>
  transcriptTallies(segments).length > 0 ||
  segments.some((s) => /\brecorded vote\b/i.test(s.text) || s.text.split('\n').some((l) => TALLY_LINE.test(l)));

const FAVOUR =
  /\b(in favou?r|vote[sd]? yes|yes vote|support(s|ed)? (the )?(draft|resolution|text)|for the (draft|resolution))\b/i;
const AGAINST = /\b(against|vote[sd]? no|no vote on|reject(s|ed)? the (draft|resolution|text))\b/i;
const ABSTAIN = /\babstain(s|ed|ing)?\b|\babstention\b/i;
/** The State keeps out of the dispute's substance: "takes no side", "neutral on the merits". */
const NO_SIDE =
  /\b(takes? no side|no side on|not take (a )?side|neutral (on|about|as to)|no position on the (merits|substance)|does not take a position)\b/i;

/** The side a text states, or null (several sides, or none). */
export function sideOf(text: string): Side | null {
  const sides = (
    [
      [ABSTAIN, 'abstain'],
      [AGAINST, 'against'],
      [FAVOUR, 'in favour'],
    ] as const
  )
    .filter(([re]) => re.test(text))
    .map(([, s]) => s);
  return sides.length === 1 ? sides[0]! : sides.includes('abstain') ? 'abstain' : null;
}

/** The State's vote on the record: the decision's vote, or, when that is not a side, what it would have voted. */
export function stateSide(d: Pick<Decision, 'vote' | 'would_have_voted'>): Side | null {
  if (d.vote === 'in favour' || d.vote === 'against' || d.vote === 'abstain') return d.vote;
  return d.would_have_voted ? sideOf(d.would_have_voted) : null;
}

export interface CoherenceContext {
  body: Body | null | undefined;
  segments: SegmentLike[];
}

/** Failures, empty = pass. */
export function checkCoherence(d: Decision, ctx: CoherenceContext): string[] {
  const f: string[] = [];
  const side = stateSide(d);
  if (stateVotesIn(ctx.body) && recordedVote(ctx.segments) && !side)
    f.push(
      `vote: the texts were put to a recorded vote in a body the State belongs to; say in favour, against or abstain ` +
        `(in "vote", or in "would_have_voted" when the point was already taken), not "${d.vote ?? 'nothing'}"`,
    );
  const named = d.stands_with.filter((g) => g.toLowerCase() !== NATIONAL);
  if (!named.length) return f;
  // A State that votes yes or no took a side on the vote, even if it keeps out of the merits of the dispute.
  const noSide = side === 'abstain' || (!side && NO_SIDE.test(d.position));
  for (const g of named) {
    const entry = d.group_positions.find((x) => x.group.toLowerCase() === g.toLowerCase());
    const theirs = entry ? sideOf(entry.position) : null;
    const neutral = entry ? NO_SIDE.test(entry.position) : false;
    if (noSide) {
      if (theirs !== 'abstain' && !neutral)
        f.push(
          `stands_with: the State ${side === 'abstain' ? 'abstains' : 'takes no side'}; ${g} took one ` +
            `("${(entry?.position ?? '').slice(0, 80)}"); name only groups that also abstained or took no side, else "${NATIONAL}"`,
        );
    } else if (side && theirs && theirs !== side)
      f.push(`stands_with: the State votes ${side}; ${g} ${theirs === 'abstain' ? 'abstained' : `voted ${theirs}`}`);
  }
  return f;
}
