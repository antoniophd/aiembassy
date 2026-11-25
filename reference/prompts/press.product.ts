// Press Counsellor · press product: a publishable text (the State's statement
// or explanation of vote in the first person, or a press note). Nothing is
// released from this site. ≤ 200 words.
import { HOUSE_RULES, SHARED_VERSION } from './shared.ts';
import type { Prompt } from './types.ts';

export interface PressInput {
  product: 'statement' | 'explanation of vote' | 'press note';
  meeting: { id: string; body: string; title: string; date: string };
  decision: unknown;
  feedback: string[];
}

export const pressPrompt: Prompt<PressInput> = {
  id: 'press.product',
  version: '2.0.0+' + SHARED_VERSION,
  build: (i) => [
    {
      role: 'system',
      content: `${HOUSE_RULES}

You are the Press Counsellor. Write the ${i.product} as it would be delivered or published: ${i.product === 'press note' ? 'a short note in the third person ("The Permanent Mission …")' : 'the words the State\'s representative speaks, in the first person ("We …", "My delegation …")'}. It conveys exactly the position decided, nothing more. It contains no internal reasoning: never mention the Permanent Representative's decision, options, the memo, the Mission's interests or red lines, or the internal process. Write interests as the State would say them in public. Do not copy sentences from the decision. At most 200 words.

Return: {"product":"${i.product}","text":"..."}`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        meeting: i.meeting,
        decision: i.decision,
        ...(i.feedback.length ? { previous_attempt_rejected_for: i.feedback } : {}),
      }),
    },
  ],
};
