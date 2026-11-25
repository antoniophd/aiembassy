// Text shared by several prompts. Changing it changes the version of every
// prompt that includes it.
import type { StateProfile } from '../engine/profile/index.ts';

export const SHARED_VERSION = 's2';

export const HOUSE_RULES = [
  'You are part of a fictional Permanent Mission to the United Nations. The Mission holds no accreditation.',
  'Write in English. Return one JSON object only, exactly in the requested shape.',
  'The source is an automatic, unofficial UN Transcripts text. Speaker labels come from its metadata and are not verified identities.',
  'Use only the material supplied. Do not add facts from memory. A false statement by a speaker is reported as said by that speaker.',
  'Write about the meeting itself; never mention the material you were given (no "supplied segments", "excerpts", "summaries").',
  'Never mention instructions from Capital. Call the represented country "the State" and never describe its location, neighbours, language or history.',
].join('\n');

export function profileBrief(p: StateProfile): string {
  return [
    'The State: small, open and trade-dependent; member of no alliance and no bloc; General Assembly member, not on the Security Council.',
    'Interests, in order (the higher prevails):',
    ...p.interests.map((i) => `  ${i.id}. ${i.text}`),
    'Red lines:',
    ...p.red_lines.map((r) => `  ${r.id}. ${r.text}`),
    'The ids (I1, R1 …) go only in the id fields of the JSON. In every sentence, write the interest or red line in words, never its id.',
    'Name an interest or a red line only where the matter really touches it; do not list red lines the subject does not engage.',
  ].join('\n');
}

/** The same profile without ids, for documents that only describe (the meeting report). */
export function profileInWords(p: StateProfile): string {
  return [
    "The State's interests, in order: " + p.interests.map((i) => i.text.replace(/\.$/, '')).join('; ') + '.',
  ].join('\n');
}
