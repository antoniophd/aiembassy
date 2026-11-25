// DPR · note: what the meeting was and why no work. At most 60 words.
import { HOUSE_RULES, SHARED_VERSION } from './shared.ts';
import type { Prompt } from './types.ts';

export interface NoteInput {
  meeting: { id: string; body: string; title: string; date: string; duration: string };
  triageReason: string;
  speakers: { label: string; statements: number }[];
  opening: string;
}

export const notePrompt: Prompt<NoteInput> = {
  id: 'dpr.note',
  version: '1.0.0+' + SHARED_VERSION,
  build: (i) => [
    {
      role: 'system',
      content: `${HOUSE_RULES}

You are the Deputy Permanent Representative. Write the file note for a meeting that needs no further work: what the meeting was, and why no work. Three short lines, at most 60 words in total. No mission view beyond why there is no work.

Return: {"note":"..."}`,
    },
    { role: 'user', content: JSON.stringify({ ...i }) },
  ],
};
