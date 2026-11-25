// Assigned counsellor · opinion: the one thing this desk adds. ≤ 250 words.
import type { StateProfile } from '../engine/profile/index.ts';
import type { DecisionTiming } from '../engine/check/timing.ts';
import { HOUSE_RULES, profileBrief, SHARED_VERSION } from './shared.ts';
import type { Prompt } from './types.ts';

/** What each desk covers (2026-11-13). */
const DESK: Record<string, string> = {
  legal:
    'Legal desk: the competence of the body, the legal value of the text (recommendation, mandate, binding or not), the applicable law, and the legal arguments delegations made. No economic, trade or commercial arguments.',
  economic:
    'Economic desk: economic, environmental and budgetary consequences only (financing, programme budget implications, trade, climate). No legal or political arguments.',
  political: 'Political desk: positions, groups, votes and the balance of support. No legal or economic arguments.',
};

export interface OpinionInput {
  others?: string[];
  profile: StateProfile;
  role: { id: string; title: string; function: string };
  meeting: { id: string; body: string; title: string; date: string };
  decisionPoint: string;
  timing: DecisionTiming | null;
  engaged: { interests: string[]; red_lines: string[] };
  report: string;
  dossier: { title: string; standing_position: string | null; stands_with: string[] | null } | null;
  feedback: string[];
}

export const opinionPrompt: Prompt<OpinionInput> = {
  id: 'counsellor.opinion',
  version: '1.2.0+' + SHARED_VERSION,
  build: (i) => [
    {
      role: 'system',
      content: `${HOUSE_RULES}

You are the ${i.role.title} (${i.role.function}). The meeting report is written; do NOT summarise the meeting or repeat its sentences. Give the one thing your desk adds on the decision point, in your own field only, and say what it means for the State's interests. At most 250 words.
${DESK[i.role.id] ?? ''}
Other opinions on this file: ${i.others?.length ? 'already written by ' + i.others.join(', ') + '; do not repeat their points' : 'none yet'}.
${profileBrief(i.profile)}
The Mission has not read the draft texts: reason from the debate only. Do not speculate about operative or preambular wording you have not seen.${i.role.id === 'legal' ? ' Your opinion is published after the line "Based on the debate; the draft text was not reviewed."; do not repeat it.' : ''}
If "decision_status" is "already_taken", the vote is over: write about what it means now and about the next step (${i.timing?.next_step ?? 'the next step'}), not about how to vote at the meeting already held.
Mention a red line only if it is listed in "engaged" and the matter really touches it; put its id in "red_lines". Do not close with red lines the subject does not engage.

Return: {"opinion":"...","objection":false,"interests":["I1"],"red_lines":[]}`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        meeting: i.meeting,
        decision_point: i.decisionPoint,
        decision_status: i.timing,
        engaged: i.engaged,
        meeting_report: i.report,
        dossier: i.dossier,
        ...(i.feedback.length ? { previous_attempt_rejected_for: i.feedback } : {}),
      }),
    },
  ],
};
