// Whether the decision point has already been acted on (the design, check
// 10). The triage says pending or already_taken and cites the segment that
// shows it; when already taken, the memo and the decision address the next
// real step and say what the State would have voted, and no option or
// position proposes again what the record shows as done. Pure: no model.
import type { SegmentLike } from './groups.ts';

/**
 * "not_recorded" (2026-11-19): the transcript does not record the adoption or the vote (it may have
 * happened at another meeting, or the transcript stops before it); no cite needed, and the file goes on as
 * pending instead of failing.
 */
export type DecisionStatus = 'pending' | 'already_taken' | 'not_recorded';
/** Where the next real step happens; "none" when nothing further is scheduled. */
export type NextForum = 'plenary' | 'committee' | 'council' | 'none';
export const NEXT_FORUMS: NextForum[] = ['plenary', 'committee', 'council', 'none'];

export interface DecisionTiming {
  status: DecisionStatus;
  cite: string;
  /** Required when already taken: the next real step (e.g. the vote in the General Assembly plenary). */
  next_step: string | null;
  next_forum: NextForum | null;
}

/** Lines that record an action already taken: an adoption, a vote, explanations after the vote. */
export const PAST_ACTION =
  /\b(was|were|has been|have been|is|are) (adopted|rejected|retained|approved)\b|\badopted (without a vote|by (a )?(recorded )?vote|by \d+)|\bexplanations? of (the )?votes? after (the )?(vote|voting)\b|\bafter (the )?(vote|voting)\b|\bwe (voted|abstained)\b|\bvoted (in favou?r|against|yes|no)\b|\babstained\b|\bin favou?r,? \d+ against\b|\b\d+ (votes )?in favou?r\b/i;

/** Segments with a line recording a past action, with up to `perSegment` such lines each. */
export function actionMarkers(
  segments: SegmentLike[],
  perSegment = 2,
  total = 24,
): { segment: string; line: string }[] {
  const out: { segment: string; line: string }[] = [];
  for (const s of segments) {
    const lines = s.text
      .split('\n')
      .map((l) => l.replace(/^\[\d+s\]\s*/, '').trim())
      .filter((l) => PAST_ACTION.test(l))
      .slice(0, perSegment);
    for (const line of lines)
      out.push({ segment: s.label, line: line.length > 240 ? line.slice(0, 240) + ' …' : line });
    if (out.length >= total) break;
  }
  return out.slice(0, total);
}

export const showsPastAction = (seg: SegmentLike | undefined): boolean =>
  !!seg && seg.text.split('\n').some((l) => PAST_ACTION.test(l));

/** Validates the triage's decision status against the transcript. Failures, empty = pass. */
/**
 * The cited segment says so expressly: a line records a past action AND names
 * the decision point's texts (a draft number or cluster), or speaks of
 * explanations of vote after the vote. Without symbols in the decision point,
 * any recorded action counts.
 */
export function expressly(seg: SegmentLike, decisionPoint: string | null): boolean {
  const drafts = [...(decisionPoint ?? '').matchAll(/\bL\s?[./-]?\s?(\d{1,3})\b/gi)].map((m) => m[1]);
  const clusters = [...(decisionPoint ?? '').matchAll(/\bcluster\s+(\d+)/gi)].map((m) => m[1]);
  return seg.text.split('\n').some((l) => {
    if (!PAST_ACTION.test(l)) return false;
    if (!drafts.length && !clusters.length) return true;
    if (/\bafter (the )?(vote|voting)\b/i.test(l)) return true;
    return (
      drafts.some((d) => new RegExp(`\\bL\\s?[./-]?\\s?${d}\\b`, 'i').test(l)) ||
      clusters.some((c) => new RegExp(`\\bcluster\\s+${c}\\b`, 'i').test(l))
    );
  });
}

export function checkTimingCite(
  t: DecisionTiming,
  segments: SegmentLike[],
  decisionPoint: string | null = null,
): string[] {
  const f: string[] = [];
  if (t.status === 'not_recorded') return f; // no cite needed
  const seg = segments.find((s) => s.label === t.cite);
  if (!seg) f.push(`decision_status: cite ${t.cite || '(none)'} is not a segment of this meeting`);
  if (t.status === 'already_taken') {
    if (seg && !showsPastAction(seg))
      f.push(
        `decision_status: ${t.cite} does not record an adoption or a vote; cite the segment that shows it, or use "not_recorded" if the transcript does not record it`,
      );
    else if (seg && !expressly(seg, decisionPoint))
      f.push(
        `decision_status: ${t.cite} records other texts; cite the segment that says expressly that these texts were acted on (e.g. explanations of vote after the vote on them), or use "not_recorded" if the transcript does not record it`,
      );
    if (!t.next_step) f.push('decision_status: already_taken needs next_step, the next real step');
    if (!t.next_forum) f.push('decision_status: already_taken needs next_forum');
  }
  return f;
}

/** An action the State could take at a meeting: vote, abstain, consensus, sponsor, amend, paragraph votes. */
const ACTION =
  /\b(vote|votes|voting|abstain|abstains|abstaining|join(s|ing)? (the )?consensus|co-?sponsor(s|ing)?|(become|join)(s|ing)? (as )?(a )?(co-?)?sponsors?|request(s|ing)? (a )?(recorded|separate|paragraph) votes?|seek(s|ing)? (a )?(recorded|separate|paragraph) votes?|paragraph votes?|separate votes?|propose(s)? amendments?|table(s)? amendments?|amend(s|ing)?)\b/i;
const FORUM: Record<NextForum, RegExp | null> = {
  plenary: /\bplenary\b|\bGeneral Assembly\b/i,
  committee: /\bCommittee\b/,
  council: /\bCouncil\b/,
  none: null,
};
const CONDITIONAL = /\bwould have\b|\bhad it\b|\bhad the State\b/i;

/**
 * The action proposed, not described (2026-11-25): the verb opens the sentence or a clause (imperative),
 * or the State, "we", "it" acts, or it follows a modal or "to". "A divided vote is not consensus" is not one.
 */
const PROPOSAL = new RegExp(
  `(?:^|[;:,]\\s*|\\b(?:then|and|or)\\s+|\\b(?:the State|we|it|my delegation|my country)\\s+(?:will\\s+|shall\\s+|should\\s+|must\\s+|can\\s+)?|\\b(?:will|shall|should|must|to)\\s+)${ACTION.source}`,
  'i',
);

/** Whole sentences (2026-11-25: never cut at a semicolon). */
const sentences = (s: string): string[] =>
  s
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Sentences that propose acting on a point already taken: an action verb with
 * no mention of the next forum and not in the conditional ("would have").
 */
export function staleProposals(text: string, forum: NextForum | null): string[] {
  const where = FORUM[forum ?? 'none'];
  return sentences(text).filter((s) => PROPOSAL.test(s) && !CONDITIONAL.test(s) && !(where && where.test(s)));
}

/** Check 10 on a memo or a decision when the decision point was already taken. */
export function checkTiming(
  t: DecisionTiming | null,
  what: 'memo' | 'decision',
  parts: { label: string; text: string }[],
  wouldHave: string | null,
): string[] {
  if (!t || t.status !== 'already_taken') return [];
  const f: string[] = [];
  for (const p of parts)
    for (const s of staleProposals(p.text, t.next_forum))
      f.push(
        `timing: ${p.label} proposes action on a point already taken (${t.cite}): "${s.slice(0, 140)}"; address ${t.next_step ?? 'the next step'}${t.next_forum && t.next_forum !== 'none' ? ' and name the ' + t.next_forum : ''}`,
      );
  if (!wouldHave) f.push(`timing: the ${what} must say what the State would have voted and why ("would_have_voted")`);
  else if (!CONDITIONAL.test(wouldHave)) f.push('timing: "would_have_voted" must say what the State would have done');
  return f;
}
