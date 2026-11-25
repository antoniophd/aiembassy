// The single model entry point: generate() with JSON output.
// Configuration comes from the environment. No model is hard-coded: the writer,
// the checker, the fallback and the fallback's checker are each named by whoever
// runs it (guide, chapter 3), and a missing name stops the call with a plain message.
import { ollamaAdapter } from './ollama.ts';
import { openAiCompatibleAdapter } from './openai-compatible.ts';
import type { GenerateRequest, GenerateResult, LlmTarget, ProviderAdapter } from './types.ts';

export * from './types.ts';

const ADAPTERS: Record<string, ProviderAdapter> = {
  [ollamaAdapter.name]: ollamaAdapter,
  [openAiCompatibleAdapter.name]: openAiCompatibleAdapter,
};

export const DEFAULT_PROVIDER = 'ollama';
export const DEFAULT_BASE_URL = 'https://ollama.com';

export type LlmEnvironment = Record<string, string | undefined>;

/** A model the environment must name; there is no default. */
function required(env: LlmEnvironment, name: string, what: string): string {
  const value = env[name];
  if (!value) throw Error(`${name} is not set: name the ${what} in the environment (see .env.example).`);
  return value;
}

/**
 * Resolves provider, base URL, key and model. Per-purpose overrides use
 * LLM_MODEL_<PURPOSE> (e.g. LLM_MODEL_PR). OLLAMA_API_KEY is also accepted as the key.
 */
export function resolveTarget(env: LlmEnvironment, purpose?: string): LlmTarget {
  const provider = env.LLM_PROVIDER || DEFAULT_PROVIDER;
  const override = purpose ? env['LLM_MODEL_' + purpose.toUpperCase().replace(/[^A-Z0-9]/g, '_')] : undefined;
  return {
    provider,
    baseUrl: env.LLM_BASE_URL || DEFAULT_BASE_URL,
    model: override || required(env, 'LLM_MODEL', 'writer model'),
    apiKey: env.LLM_API_KEY || env.OLLAMA_API_KEY,
  };
}

export type ModelUse = 'writer' | 'check' | 'check_fallback' | 'fallback';

/**
 * The model uses of the design: writer (per role), checker, fallback, and the checker of the fallback's
 * documents. The checker is of another family than the writer; the fallback's checker of another family
 * than the fallback. Each is named in the environment.
 */
export function modelFor(env: LlmEnvironment, use: ModelUse, role?: string): string {
  if (use === 'check') return required(env, 'LLM_MODEL_CHECK', 'checker model');
  if (use === 'check_fallback') return required(env, 'LLM_MODEL_CHECK_FALLBACK', "checker of the fallback's documents");
  if (use === 'fallback') return required(env, 'LLM_MODEL_FALLBACK', 'fallback model');
  return resolveTarget(env, role).model;
}

export function configuredModel(env: LlmEnvironment, purpose?: string): string {
  return resolveTarget(env, purpose).model;
}

export interface LlmClient {
  generate(request: GenerateRequest): Promise<GenerateResult>;
  target(purpose?: string): LlmTarget;
}

export function createLlmClient(env: LlmEnvironment): LlmClient {
  return {
    target: (purpose) => resolveTarget(env, purpose),
    async generate(request) {
      const resolved = resolveTarget(env, request.purpose);
      const target = request.model ? { ...resolved, model: request.model } : resolved;
      const adapter = ADAPTERS[target.provider];
      if (!adapter) throw Error('Unsupported model provider: ' + target.provider);
      const started = Date.now();
      const result = await adapter.generate(target, request);
      return { ...result, provider: target.provider, durationMs: Date.now() - started };
    },
  };
}
