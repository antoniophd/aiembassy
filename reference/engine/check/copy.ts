// Check 3 · copy. An opinion, memo or decision sharing more than 20 % of its
// sentences with an earlier document of the file is rejected. A sentence is
// shared when it appears in an earlier document, or when most of its word
// trigrams do (Jaccard ≥ 0.6 against one earlier sentence).
import { normalise } from './source.ts';

export const COPY_LIMIT = 0.2;
const MIN_WORDS = 6;

export function sentences(text: string): string[] {
  return text
    .replace(/\[E\d+\]/g, ' ')
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => normalise(s))
    .filter((s) => s.split(' ').length >= MIN_WORDS);
}

const trigrams = (s: string): Set<string> => {
  const w = s.split(' ');
  const out = new Set<string>();
  for (let i = 0; i + 2 < w.length; i++) out.add(w[i] + ' ' + w[i + 1] + ' ' + w[i + 2]);
  return out;
};

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

export interface CopyCheck {
  pass: boolean;
  /** Share of this document's sentences found in earlier documents. */
  ratio: number;
  /** 1 − ratio: the new-text ratio shown on the Metrics view. */
  newText: number;
  shared: string[];
  sentences: number;
}

export function checkCopy(text: string, earlier: string[]): CopyCheck {
  const own = sentences(text);
  const before = earlier.flatMap(sentences);
  const whole = before.join(' \n ');
  const grams = before.map(trigrams);
  const shared = own.filter((s) => whole.includes(s) || grams.some((g) => jaccard(trigrams(s), g) >= 0.6));
  const ratio = own.length ? shared.length / own.length : 0;
  return { pass: ratio <= COPY_LIMIT, ratio, newText: 1 - ratio, shared: shared.slice(0, 5), sentences: own.length };
}
