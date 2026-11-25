// Ollama Cloud native chat API. Reproduces the legacy client, including its
// error messages, which recovery rules recognise by text.
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
  const messages: Record<number, string> = {
    401: 'Ollama rejected the key.',
    403: 'Ollama denied access to this model.',
    404: 'Ollama model ' + model + ' is unavailable or retired. Check the configured model.',
    410: 'Ollama retired ' + model + '. Select an available model before retrying.',
    429: 'Ollama quota or rate limit reached.',
    402: 'Ollama requires available credits; no purchase was made.',
    500: 'Ollama service failed. Completed work remains saved.',
    503: 'Ollama is temporarily unavailable. Completed work remains saved.',
  };
  return messages[status] || 'Ollama request failed (HTTP ' + status + ').';
}

interface OllamaChatResponse {
  model?: string;
  message?: { content?: unknown };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export const ollamaAdapter: ProviderAdapter = {
  name: 'ollama',
  async generate(target: LlmTarget, request: GenerateRequest) {
    if (!target.apiKey) throw new ModelCallError('Ollama key is not configured', 'config');
    let response: Response;
    try {
      response = await fetch(target.baseUrl.replace(/\/$/, '') + '/api/chat', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + target.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: target.model,
          messages: request.messages,
          stream: false,
          think: typeof request.reasoning === 'string' ? request.reasoning : request.reasoning === true,
          format: 'json',
          options: { num_predict: request.maxTokens, temperature: TEMPERATURE },
        }),
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      console.error('Ollama transport:', String((error as Error).message).replaceAll(target.apiKey, '[redacted]'));
      throw new ModelCallError('Ollama timed out or was unreachable. Completed work remains saved.', 'provider');
    }
    if (!response.ok)
      throw new ModelCallError(
        statusMessage(response.status, target.model),
        errorKindForStatus(response.status),
        response.status,
      );
    const body = (await response.json()) as OllamaChatResponse;
    const content = body.message?.content;
    if (typeof content !== 'string') throw new IncompleteOutputError('Ollama returned no text.', '');
    let output: unknown;
    try {
      output = parseModelJson(content);
    } catch {
      throw new IncompleteOutputError(
        'Ollama returned an incomplete document' +
          (body.done_reason === 'length' ? ' (stopped at the token limit)' : '') +
          '; no output accepted.',
        content.slice(0, MAX_INVALID_OUTPUT_CHARS),
      );
    }
    return {
      output,
      usage: { inputTokens: body.prompt_eval_count ?? null, outputTokens: body.eval_count ?? null },
      model: body.model || target.model,
    };
  },
};
