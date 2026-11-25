// Lead counsellor · segment summary: the working material for the report.
import { HOUSE_RULES, SHARED_VERSION } from './shared.ts';
import type { Prompt } from './types.ts';

export interface SummaryInput {
  meeting: { id: string; body: string; title: string };
  segment: { label: string; speakers: string[]; text: string };
}

export const summaryPrompt: Prompt<SummaryInput> = {
  id: 'counsellor.summary',
  version: '1.0.0+' + SHARED_VERSION,
  build: (i) => [
    {
      role: 'system',
      content: `${HOUSE_RULES}

Summarise one segment of a meeting transcript for the meeting report. For each speaker, give who spoke (exactly as their speaker label), what they said, positions taken, proposals, and any decision or vote. Copy figures, dates and resolution numbers exactly as written in the text. Quote at most a few short phrases, word for word. Do not interpret. At most 300 words.

Return: {"points":[{"speaker":"label","text":"..."}],"outcome":"decision, vote or none in this segment"}`,
    },
    { role: 'user', content: JSON.stringify(i) },
  ],
};
