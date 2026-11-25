// Lead counsellor · meeting report with segment citations: key points for the
// Mission, then sections by kind of meeting. No recommendation.
import type { StateProfile } from '../engine/profile/index.ts';
import type { DecisionTiming } from '../engine/check/timing.ts';
import { HOUSE_RULES, profileInWords, SHARED_VERSION } from './shared.ts';
import type { Prompt } from './types.ts';

export interface ReportInput {
  profile: StateProfile;
  /** Security Council, General Assembly plenary or a Main Committee. */
  council: boolean;
  decisionPoint: string | null;
  decisionStatus: DecisionTiming | null;
  /** "name": the meeting named by its own body ("Third Committee, 41st meeting"), not the UN title's wording. */
  meeting: { id: string; body: string; title: string; name: string; date: string; duration: string; part: number };
  speakers: string[];
  summaries: { label: string; speakers: string[]; summary: unknown }[];
  maxWords: number;
  lowConfidence: string | null;
  feedback: string[];
}

export const reportPrompt: Prompt<ReportInput> = {
  id: 'counsellor.report',
  version: '2.8.0+' + SHARED_VERSION,
  build: (i) => [
    {
      role: 'system',
      content: `${HOUSE_RULES}

You are the lead counsellor. Write the meeting report. No recommendation.
${profileInWords(i.profile)}
Structure:
- "key_points": "Key points for the Mission", 2 to 4 sentences on what in this meeting touches the State's interests, each with its segments. Name an interest in words only where the meeting really touches it.
- "decision_outcome": ${i.decisionPoint ? `one sentence with the result of the texts of the decision point (${JSON.stringify(i.decisionPoint)}) as recorded in this transcript, with its segment; if this transcript does not record it, say "The outcome of … is not recorded in this transcript." with no cites.` : 'one sentence with the result of the main texts acted on, with its segment, or null if none was acted on.'} Key points plus this sentence: 3 to 5 in all.
- "meeting_type": "briefing", "debate" or "action" (texts adopted or voted, or explanations of vote).
- "issues": what was discussed.
${i.council ? '- "briefers": those who briefed the Council (UN officials, envoys, civil society). Not Council members, not the President.' : '- "briefers": always empty here (briefers exist only in the Security Council).\n- "introductions": delegations that introduced a draft, with its symbol in "draft".'}
- "positions": each delegation's distinct position, with the draft it concerns in "draft" (its symbol) or null for a general statement; ${i.council ? 'they are grouped by draft.' : 'at an action meeting these are the explanations of vote, grouped by draft.'}
- "group_statements": EVERY statement delivered on behalf of a group or of several States (a regional or political group and its members, "<a State> and my own country", a list of States), always kept: the speaker in "delegation", "on_behalf_of" (the group, or a list of States such as "<State>, <State> … and <State>" shortened to the group's description), the text it concerns in "draft", and what it said.
${i.council ? '- The President and the Secretary of the meeting are never briefers or positions. Secretariat officials who brief the Council (an Under- or Assistant Secretary-General, a Special Representative, an envoy) are briefers.' : '- Presiding officers (Chair, President, Vice-Chair, Rapporteur) and the secretariat are never introductions or positions.'}
- A delegation you name in "agreement" or "disagreement" needs no entry of its own, but it must speak in a segment that line cites.
- "agreement", "disagreement": only where several delegations converge or clash.
- "outcome": what was formally recorded (adopted, vote, statement, none). "No formal outcome was recorded" is valid.
- "votes": one entry for EVERY text acted on: "draft" (symbol), "result" ("adopted without a vote", "adopted", "rejected"), and, when the transcript gives the tally of the text as a whole, "in_favour", "against", "abstentions" exactly as announced, with the segment. If the announced tally is garbled or incomplete, do not interpret it: "result": "adopted; tally unclear in the transcript" and the figures null. Paragraph votes are not entries.
Rules, checked automatically against the transcript:
- Every item cites the segment(s) it comes from in "cites", e.g. ["E3"]. Use only labels supplied.
- "speaker" and "delegation" must be written exactly as a speaker label that appears in the cited segment.
- Figures, dates and resolution numbers must be copied exactly as they appear in the cited segment. Put a word-for-word quotation in double quotes only if it appears verbatim in the cited segment.
- "claims": the material claims of the report, one per entry, each with the one segment that supports it.
- Length: at most ${i.maxWords} words in total. Each item at most 45 words. When several delegations take the same position, write one item for the group of them in "agreement" or "disagreement" and keep "positions" for distinct positions (at most 25 entries). At most 15 claims.
- When a sequence of numbers in the transcript is ambiguous (years that look like counts, such as "in 2025, 24, and 23", or a garbled tally), do not use it: omit it or write "unclear in the transcript".
- Before returning, check: every text the transcript shows voted as a whole has its tally in "votes"; every statement on behalf of a group or of several States is in "group_statements"; every delegation named in "agreement" or "disagreement" speaks in a segment that line cites.
- Write about the meeting: never mention the material you were given ("supplied segments", "summaries"), never write interest or red-line ids.
- "title": the meeting's name exactly as in "meeting.name" (for example "Third Committee, 41st meeting"), a colon, then the subject in a few words. The UN title calls committee meetings "plenary meetings"; write "plenary" only if "meeting.name" does.
- If "previous_attempt_rejected_for" is present, fix exactly those points: cite the segment where a figure appears, remove what appears in no segment, shorten if too long.

Return:
{"title":"...","key_points":[{"text":"...","cites":["E1"]}],"decision_outcome":{"text":"...","cites":["E4"]},"meeting_type":"action","issues":[{"text":"...","cites":["E1"]}],"briefers":${i.council ? '[{"speaker":"label","text":"...","cites":["E1"]}]' : '[]'},"introductions":[{"delegation":"label","draft":"<symbol>","text":"...","cites":["E1"]}],"positions":[{"draft":"<symbol>","delegation":"label","text":"...","cites":["E2"]}],"agreement":[{"text":"...","cites":["E2"]}],"disagreement":[{"text":"...","cites":["E3"]}],"group_statements":[{"delegation":"label","on_behalf_of":"<the group>","draft":"<symbol>","text":"...","cites":["E5"]}],"outcome":{"text":"...","cites":["E4"]},"votes":[{"draft":"<symbol>","result":"adopted","in_favour":0,"against":0,"abstentions":0,"cites":["E7"]}],"claims":[{"claim":"...","cite":"E2"}]}`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        meeting: i.meeting,
        ...(i.decisionPoint ? { decision_point: i.decisionPoint, decision_status: i.decisionStatus } : {}),
        speaker_labels: i.speakers,
        segment_summaries: i.summaries,
        ...(i.lowConfidence ? { transcript_warning: i.lowConfidence } : {}),
        ...(i.feedback.length ? { previous_attempt_rejected_for: i.feedback } : {}),
      }),
    },
  ],
};
