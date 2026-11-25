// Press Counsellor · press pack (2026-11-25): one document, three parts, when the decision asks for a
// public line. Stakeout remarks (the Permanent Representative, first person, 120–180 words, then one likely
// question with a short answer), a press release (third person, 200–300 words, with a quote coherent with the
// remarks) and a social media post (≤ 280 characters, no platform, no emoji, at most one hashtag). The examples
// carry placeholders, never real values. Nothing is released from this site.
import { HOUSE_RULES, SHARED_VERSION } from './shared.ts';
import type { Prompt } from './types.ts';

export interface PressPackInput {
  /** `name`: the meeting by its real body ('Third Committee, 45th meeting'); only the Assembly's own are plenary. */
  meeting: {
    id: string;
    body: string;
    title: string;
    date: string;
    name: string;
    /** "the Third Committee's 45th meeting": how the remarks and the post refer to the meeting. */
    reference: string;
    /** "the Third Committee of the General Assembly": how the release names the body, with no meeting number. */
    organ: string;
  };
  /** How each text was adopted, from the report: a text adopted without a vote was not voted on. */
  adoption: { draft: string; withoutVote: boolean }[];
  /** The decision as adopted: option, vote, position, stands_with, press. */
  decision: unknown;
  /** The meeting report's outcome and key points: the facts the pack may use. */
  facts: string;
  feedback: string[];
}

export const PACK_LIMITS = {
  remarks: { min: 120, max: 180 },
  question: { max: 30 },
  answer: { max: 60 },
  release: { min: 200, max: 300 },
  social: { maxChars: 280, hashtags: 1 },
} as const;

const SHAPE = `{"option":"<the option decided>","vote":"<the vote decided, or null>",
"stakeout":{"remarks":"<what the Permanent Representative says>","question":"<a likely question>","answer":"<a short answer>"},
"release":{"headline":"<headline>","dateline":"New York, <day month year>","body":"<3 to 5 sentences: what happened, in <organ>>\\n\\n<3 to 5 sentences: the State's position; \\"<the quote>\\", the Permanent Representative said.>\\n\\n<3 to 5 sentences: what comes next>","quote":"<one or two sentences of the remarks that say why, word for word>"},
"social":"<the post>"}`;

export const pressPackPrompt: Prompt<PressPackInput> = {
  id: 'press.pack',
  version: '1.2.0+' + SHARED_VERSION,
  build: (i) => [
    {
      role: 'system',
      content: `${HOUSE_RULES}

You are the Press Counsellor. Write the press pack for the position decided: one document, three parts.

1. Stakeout remarks: what the Permanent Representative says to journalists at a media stakeout. First person ("I", "we", "my country"), to be said aloud, short sentences, the main message in the first sentence. ${PACK_LIMITS.remarks.min} to ${PACK_LIMITS.remarks.max} words: aim at about 160, in 12 to 15 short sentences (count them; fewer than ${PACK_LIMITS.remarks.min} words is rejected). Plain words, as spoken to a camera: say what the State voted and why, in sentences a journalist understands at once. No procedural jargon: no "explanation of vote", "operative paragraph", "preambular paragraph", "no-action motion", "agenda item", no document symbols. Name the subject ("the text on <subject>"), not its symbol. Then one question the press would likely ask (at most ${PACK_LIMITS.question.max} words) and a brief answer (at most ${PACK_LIMITS.answer.max} words).
2. Press release: third person ("The Permanent Mission of the State …"). A headline and a dateline with the place and the date of the meeting, then three short paragraphs separated by a blank line: (1) what happened, "in ${i.meeting.organ}" (the release never gives the meeting number: not "${i.meeting.reference}"); (2) the State's position and one quote of the Permanent Representative; (3) what comes next. The quote gives the reason: one or two sentences taken word for word from the stakeout remarks that say why the State acted, never the headline again or the list of texts. Put it in double quotes in paragraph 2 and repeat it in "quote". ${PACK_LIMITS.release.min} to ${PACK_LIMITS.release.max} words, headline and dateline included: aim at about 260, each paragraph 3 to 5 sentences. Name the Permanent Representative as the speaker of the quote.
3. Social media post: at most ${PACK_LIMITS.social.maxChars} characters. Name no platform, use no emoji, at most ${PACK_LIMITS.social.hashtags} hashtag.

Rules for all three parts:
- Outside the release, refer to the meeting as in "meeting.reference" ("at <the body>'s <number> meeting"), never "<body>, <number> meeting"; write "plenary meeting" only for a meeting of the General Assembly itself. The UN title says "plenary" for committee meetings too; do not copy it.
- Voting is not joining a consensus. For a text in "adoption" with "withoutVote": true, the State "joined the consensus on" it or "supported" it; it did not vote. Write "voted" only for a text that was put to a vote, and never "voted in favour of the <n> texts" when one of them was adopted without a vote.
- The same option and the same vote as the decision; say the vote as decided, never another.
- Use only the names, figures and document symbols that appear in the decision or in the facts given. Invent none.
- Name no delegation or group in a critical tone: no blame, regret or reproach aimed at anyone. Speak for the State.
- Never mention the decision, options, memo, interests, red lines, checks, models, agents, AI tools, this site or any internal process. Write as the State speaks and publishes.
- Do not copy sentences from the decision.

Example of plain stakeout remarks, with placeholders only:
"Today my country <voted in favour of / voted against / abstained on / joined the consensus on> the text on <subject>. We did so because <the reason, in one plain sentence>. <What the text does, in everyday words>. <Why it matters to people>. <What we will do next>."

Example of the shape, with placeholders only (write real text in place of each <…>):
${SHAPE}`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        meeting: i.meeting,
        decision: i.decision,
        adoption: i.adoption,
        facts: i.facts,
        ...(i.feedback.length ? { previous_attempt_rejected_for: i.feedback } : {}),
      }),
    },
  ],
};
