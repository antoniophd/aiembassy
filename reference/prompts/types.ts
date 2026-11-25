// A prompt: id + version recorded on every document it produces.
import type { ChatMessage } from '../engine/llm/types.ts';

export interface Prompt<I> {
  id: string;
  version: string;
  build(input: I): ChatMessage[];
}
