// Provider-independent model interface. Adding a provider is one adapter file.
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export interface LlmTarget {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string | undefined;
}

/** Reasoning switch or effort level for one call. */
export type Reasoning = boolean | 'low' | 'medium' | 'high';

export interface GenerateRequest {
  messages: ChatMessage[];
  maxTokens: number;
  /** Role or task name, used to pick a per-role model override. */
  purpose?: string;
  /** Explicit model for this call (e.g. checker or fallback); wins over purpose. */
  model?: string;
  /**
   * Per-call reasoning (Ollama `think`): off by default; true, or an effort level ("low", "medium", "high")
   * sent as is, for models that accept one.
   */
  reasoning?: Reasoning;
}

export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface GenerateResult {
  /** Parsed JSON object returned by the model. */
  output: unknown;
  usage: Usage;
  provider: string;
  model: string;
  durationMs: number;
}

/** Thrown when the model returned text that is not complete JSON. */
export class IncompleteOutputError extends Error {
  readonly invalidOutput: string;

  constructor(message: string, invalidOutput: string) {
    super(message);
    this.invalidOutput = invalidOutput;
  }
}

/**
 * A failed model request. `provider`: timeout, 5xx, rate limit, model
 * unavailable or not accessible: retried once on the fallback model.
 * `config`: key rejected or no credits: affects every model, no fallback.
 */
export class ModelCallError extends Error {
  readonly kind: 'provider' | 'config';
  readonly status: number | null;

  constructor(message: string, kind: 'provider' | 'config', status: number | null = null) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export type CallErrorKind = 'provider' | 'config' | 'output';

/** Classifies any error thrown by generate(). Unknown errors count as provider errors. */
export function classifyCallError(error: unknown): CallErrorKind {
  if (error instanceof IncompleteOutputError) return 'output';
  if (error instanceof ModelCallError) return error.kind;
  return 'provider';
}

export const errorKindForStatus = (status: number): 'provider' | 'config' =>
  status === 401 || status === 402 ? 'config' : 'provider';

export interface ProviderAdapter {
  readonly name: string;
  generate(target: LlmTarget, request: GenerateRequest): Promise<Omit<GenerateResult, 'durationMs' | 'provider'>>;
}

export const REQUEST_TIMEOUT_MS = 180_000;
export const TEMPERATURE = 0.2;
export const MAX_INVALID_OUTPUT_CHARS = 48_000;

/**
 * Parses the model's JSON. Some models put their
 * reasoning in the content, closed by </think>, even with thinking off; only
 * the text after the last </think> (and inside a ```json fence, if any) is
 * then considered. Nothing else is repaired.
 */
export function parseModelJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch (first) {
    const afterThink = content.includes('</think>') ? content.slice(content.lastIndexOf('</think>') + 8) : content;
    const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(afterThink);
    const candidate = (fenced?.[1] ?? afterThink).trim();
    if (candidate === content.trim()) throw first;
    return JSON.parse(candidate);
  }
}
