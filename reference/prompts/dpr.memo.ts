// DPR · options memo: 2–3 real options, benefit, risk, who the State would stand with; a recommendation. ≤ 350 words.
import type { StateProfile } from '../engine/profile/index.ts';
import type { DecisionTiming } from '../engine/check/timing.ts';
import { HOUSE_RULES, profileBrief, SHARED_VERSION } from './shared.ts';
import type { Prompt } from './types.ts';

export interface MemoInput {
  profile: StateProfile;
  meeting: { id: string; body: string; title: string; date: string };
  decisionPoint: string;
  timing: DecisionTiming | null;
  /** Known groups that took the floor in this meeting: an option may stand only with these. */
  groupsThatSpoke?: string[];
  engaged: { interests: string[]; red_lines: string[] };
  report: string;
  opinions: { role: string; text: string }[];
  dossier: {
    title: string;
    standing_position: string | null;
    stands_with: string[] | null;
    last_decisions: string[];
  } | null;
  feedback: string[];
}

export const memoPrompt: Prompt<MemoInput> = {
  id: 'dpr.memo',
  version: '1.3.0+' + SHARED_VERSION,
  build: (i) => [
    {
      role: 'system',
      content: `${HOUSE_RULES}

You are the Deputy Permanent Representative. Write the options memo for the Permanent Representative on the decision point. Give 2 or 3 real, distinct options (for example: take a stance, join a group, abstain with an explanation, stay silent). For each: "vote", what the State votes at the next step ("in favour", "against", "abstain", "join consensus", "not participate", or "no vote" only when nothing will be put to the vote); "takes_floor", apart from the vote, whether the State takes the floor (a statement or an explanation of vote); "action", what it does and says; the benefit, the risk, and who the State would stand with ("stands_with": groups from the known list, or ["national capacity"]). Staying silent is not a vote: an option without a statement still says how the State votes. Then recommend one option and say which interest prevails. Do NOT restate the meeting report. At most 350 words.
${profileBrief(i.profile)}
Known groups: ${i.profile.alignment.known_groups.join('; ')}.
Groups that took the floor in this meeting: ${i.groupsThatSpoke?.length ? i.groupsThatSpoke.join('; ') : 'none'}. An option may stand only with these groups, or with "national capacity"; never with a group that did not speak here.
Alignment is a consequence of the interests, never a starting point.
${timingRule(i.timing)}
The Mission has not read the draft texts: reason from the debate; do not speculate about operative wording you have not seen.

Return: {"options":[{"id":"A","vote":"in favour","takes_floor":false,"action":"...","benefit":"...","risk":"...","stands_with":["national capacity"]}],"recommendation":{"option":"A","reason":"...","prevailing_interest":"I1"},"would_have_voted":null}`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        meeting: i.meeting,
        decision_point: i.decisionPoint,
        decision_status: i.timing,
        engaged: i.engaged,
        meeting_report: i.report,
        opinions: i.opinions,
        dossier: i.dossier,
        ...(i.feedback.length ? { previous_attempt_rejected_for: i.feedback } : {}),
      }),
    },
  ],
};

/** The rule for a decision point already acted on (check 10), shared with the decision. */
export function timingRule(t: DecisionTiming | null): string {
  if (!t || t.status !== 'already_taken') return '"would_have_voted": null (the decision point is still pending).';
  const forum = t.next_forum && t.next_forum !== 'none' ? ` Every action names the ${t.next_forum}.` : '';
  return `The decision point was ALREADY TAKEN at or before this meeting (${t.cite}). Formulate every option toward the next real step: ${t.next_step}.${forum} No option may propose what the record shows as done (a vote, paragraph votes, an amendment or a request at the stage already held). In "would_have_voted", one sentence: what the State would have voted on the texts already acted on, and why ("The State would have voted …").`;
}
