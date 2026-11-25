// Checker · one closed question per red line: does the decision cross it? (check 8)
import { SHARED_VERSION } from './shared.ts';
import type { Prompt } from './types.ts';

export interface RedLineInput {
  red_line: { id: string; text: string };
  decision: unknown;
}

export const redLinePrompt: Prompt<RedLineInput> = {
  id: 'check.redline',
  version: '1.0.0+' + SHARED_VERSION,
  build: (i) => [
    {
      role: 'system',
      content: `You check one decision of a fictional state's mission to the United Nations against one of its red lines. Answer the closed question: does the decision, as written, cross this red line? Return one JSON object only.

Return: {"crosses":false,"reason":"one sentence"}`,
    },
    { role: 'user', content: JSON.stringify(i) },
  ],
};
