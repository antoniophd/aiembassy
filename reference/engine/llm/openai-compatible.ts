// Any OpenAI-compatible chat completions API (OpenAI, OpenRouter, vLLM, …).
// Error texts keep the keywords the recovery rules use to classify failures.
import {
  errorKindForStatus,
  IncompleteOutputError,
  ModelCallError,
  parseModelJson,
  MAX_INVALID_OUTPUT_CHARS,
  REQUEST_TIMEOUT_MS,
  TEMPERATURE,
  type GenerateRequest,
  type LlmTarget,
  type ProviderAdapter,
} from './types.ts';

function statusMessage(status: number, model: string): string {
  if (status === 401) return 'Model provider rejected the key.';
  if (status === 403) return 'Model provider denied access to this model.';
  if (status === 404 || status === 410)
    return 'Model ' + model + ' is unavailable or retired. Check the configured model.';
  if (status === 402) return 'Model provider requires available credits; no purchase was made.';
  if (status === 429) return 'Model provider quota or rate limit reached.';
  if (status >= 500)
    return 'Model provider is temporarily unavailable (HTTP ' + status + '). Completed work remains saved.';
  return 'Model request failed (HTTP ' + status + ').';
}

interface ChatCompletion {
  model?: string;
  choices?: { message?: { content?: unknown } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export const openAiCompatibleAdapter: ProviderAdapter = {
  name: 'openai-compatible',
  async generate(target: LlmTarget, request: GenerateRequest) {
    if (!target.apiKey) throw new ModelCallError('Model provider key is not configured', 'config');
    let response: Response;
    try {
      response = await fetch(target.baseUrl.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + target.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: target.model,
          messages: request.messages,
          max_tokens: request.maxTokens,
          temperature: TEMPERATURE,
          response_format: { type: 'json_object' },
        }),
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      console.error('Model transport:', String((error as Error).message).replaceAll(target.apiKey, '[redacted]'));
      throw new ModelCallError(
        'Model provider timed out or was unreachable. Completed work remains saved.',
        'provider',
      );
    }
    if (!response.ok)
      throw new ModelCallError(
        statusMessage(response.status, target.model),
        errorKindForStatus(response.status),
        response.status,
      );
    const body = (await response.json()) as ChatCompletion;
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new IncompleteOutputError('Model provider returned no text.', '');
    let output: unknown;
    try {
      output = parseModelJson(content);
    } catch {
      throw new IncompleteOutputError(
        'Model provider returned an incomplete document; no output accepted.',
        content.slice(0, MAX_INVALID_OUTPUT_CHARS),
      );
    }
    return {
      output,
      usage: { inputTokens: body.usage?.prompt_tokens ?? null, outputTokens: body.usage?.completion_tokens ?? null },
      model: body.model || target.model,
    };
  },
};
