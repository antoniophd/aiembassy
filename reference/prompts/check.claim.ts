// Checker · one material claim against its cited segment (check 7).
import { SHARED_VERSION } from './shared.ts';
import type { Prompt } from './types.ts';

export interface ClaimInput {
  claim: string;
  segment: { label: string; speakers: string[]; text: string };
}

export const claimPrompt: Prompt<ClaimInput> = {
  id: 'check.claim',
  version: '1.0.0+' + SHARED_VERSION,
  build: (i) => [
    {
      role: 'system',
      content: `You check one claim of a meeting report against one segment of an automatic UN transcript. Judge only against the segment text: "supported" if the segment says it (a speaker's statement reported as that speaker's statement counts), "contradicted" if the segment says otherwise, "not_supported" if the segment does not contain it. Do not use outside knowledge. Return one JSON object only.

Return: {"verdict":"supported|not_supported|contradicted","reason":"one sentence"}`,
    },
    { role: 'user', content: JSON.stringify(i) },
  ],
};
