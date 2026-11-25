// Lead counsellor · cable to Capital (2026-11-13): the telegram with
// which the Mission reports what happened. Written from the accepted report
// and, on full files, the opinions, memo and decision; the transcript is not
// read again. Capital is addressed but never answers. Aims at 900 words, one or
// two pages; the check allows 450 to 1,500 (2026-11-24).
import { HOUSE_RULES, SHARED_VERSION } from './shared.ts';
import type { Prompt } from './types.ts';

export interface CableInput {
  meeting: { id: string; body: string; title: string; date: string };
  report: string;
  /** Full files only. */
  file: {
    opinions: { role: string; text: string }[];
    memo: string;
    decision: unknown;
    next_step: string | null;
  } | null;
  feedback: string[];
}

export const cablePrompt: Prompt<CableInput> = {
  id: 'counsellor.cable',
  version: '1.7.0+' + SHARED_VERSION,
  build: (i) => [
    {
      role: 'system',
      content: `${HOUSE_RULES}

You are the counsellor who covered this meeting. Write the cable with which the Permanent Mission reports to Capital what happened. Capital is the addressee; it does not answer or instruct.
Cable prose in English: plain numbered paragraphs, no bullet points, no segment marks such as [E3] (the report carries the sources), no classification marks, no mention of models, prompts or internal codes.
- "subject": one line.
- "summary": paragraph 1, one paragraph with the gist.
- "paragraphs": 2 to 6 numbered paragraphs, one per topic, each with a short "title". Synthesise; do not repeat the report's list of delegations.
- "assessment": one or two paragraphs of assessment for the Mission. ${i.file ? 'Include the position adopted, with whom the State coincides (or that it acts in national capacity), and the next step.' : 'Say what to watch.'}
Do not use numbers the report marks "unclear in the transcript", nor any sequence that reads like garbled years ("in 2025, 24, and 23"). Use only what the report${i.file ? ', the opinions, the memo and the decision' : ''} say. Every delegation, figure, tally and document symbol you mention must appear in the report; name only delegations that have an entry of their own there (a briefer, an introduction, a group statement or a position), not those named only in agreement or disagreement.
${i.file ? 'Give "option" and "stands_with" exactly as in the decision.' : '"option" and "stands_with" are null.'}
Length: aim for about 900 words in all (one or two pages), never more than 1,500. Budget: summary about 120 words; 4 or 5 paragraphs of about 130 words each; assessment about 160 words. Write new sentences: do not reuse the report's sentences.

Return: {"subject":"...","summary":"...","paragraphs":[{"title":"...","text":"..."}],"assessment":["..."],"option":${i.file ? '"<the decision\'s option>"' : 'null'},"stands_with":${i.file ? '["<each entry of the decision\'s stands_with>"]' : 'null'}}`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        meeting: i.meeting,
        meeting_report: i.report,
        ...(i.file
          ? {
              opinions: i.file.opinions,
              options_memo: i.file.memo,
              decision: i.file.decision,
              next_step: i.file.next_step,
            }
          : {}),
        ...(i.feedback.length ? { previous_attempt_rejected_for: i.feedback } : {}),
      }),
    },
  ],
};
