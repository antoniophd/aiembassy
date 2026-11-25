import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  classifyCallError,
  createLlmClient,
  IncompleteOutputError,
  modelFor,
  resolveTarget,
} from '../engine/llm/index.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function capture(response: unknown, status = 200): { calls: { url: string; body: Record<string, unknown> }[] } {
  const log = { calls: [] as { url: string; body: Record<string, unknown> }[] };
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    log.calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return Response.json(response, { status });
  }) as typeof fetch;
  return log;
}

test('provider and base URL default to Ollama; the model is named by the environment', () => {
  const target = resolveTarget({ OLLAMA_API_KEY: 'k', LLM_MODEL: 'writer-model' });
  assert.deepEqual(target, {
    provider: 'ollama',
    baseUrl: 'https://ollama.com',
    model: 'writer-model',
    apiKey: 'k',
  });
});

test('per-role model override and generic key take precedence', () => {
  const env = { LLM_API_KEY: 'generic', OLLAMA_API_KEY: 'legacy', LLM_MODEL: 'base', LLM_MODEL_PR: 'ambassador-model' };
  assert.equal(resolveTarget(env, 'pr').model, 'ambassador-model');
  assert.equal(resolveTarget(env, 'sc').model, 'base');
  assert.equal(resolveTarget(env).apiKey, 'generic');
});

test('Ollama adapter sends the legacy request shape and reports provenance', async () => {
  const log = capture({
    model: 'writer-model',
    message: { content: '{"ok":true}' },
    prompt_eval_count: 3,
    eval_count: 4,
  });
  const result = await createLlmClient({ OLLAMA_API_KEY: 'k', LLM_MODEL: 'writer-model' }).generate({
    messages: [{ role: 'user', content: 'x' }],
    maxTokens: 50,
    purpose: 'sc',
  });
  assert.equal(log.calls[0]?.url, 'https://ollama.com/api/chat');
  assert.deepEqual(log.calls[0]?.body, {
    model: 'writer-model',
    messages: [{ role: 'user', content: 'x' }],
    stream: false,
    think: false,
    format: 'json',
    options: { num_predict: 50, temperature: 0.2 },
  });
  assert.deepEqual(result.output, { ok: true });
  assert.deepEqual(result.usage, { inputTokens: 3, outputTokens: 4 });
  assert.equal(result.provider, 'ollama');
  assert.ok(result.durationMs >= 0);
});

test('OpenAI-compatible adapter uses chat completions with JSON mode', async () => {
  const log = capture({
    model: 'm',
    choices: [{ message: { content: '{"a":1}' } }],
    usage: { prompt_tokens: 1, completion_tokens: 2 },
  });
  const client = createLlmClient({
    LLM_PROVIDER: 'openai-compatible',
    LLM_BASE_URL: 'https://api.example.test/v1',
    LLM_API_KEY: 'k',
    LLM_MODEL: 'm',
  });
  const result = await client.generate({ messages: [{ role: 'user', content: 'x' }], maxTokens: 10 });
  assert.equal(log.calls[0]?.url, 'https://api.example.test/v1/chat/completions');
  assert.deepEqual(log.calls[0]?.body.response_format, { type: 'json_object' });
  assert.deepEqual(result.usage, { inputTokens: 1, outputTokens: 2 });
});

test('incomplete JSON keeps the raw text for a bounded repair', async () => {
  capture({ message: { content: '{"title":"cut' } });
  await assert.rejects(
    createLlmClient({ OLLAMA_API_KEY: 'k', LLM_MODEL: 'm' }).generate({ messages: [], maxTokens: 1 }),
    (error: unknown) =>
      error instanceof IncompleteOutputError &&
      error.invalidOutput === '{"title":"cut' &&
      /incomplete document/.test(error.message),
  );
});

test('provider errors keep the wording recovery rules classify', async () => {
  capture({}, 429);
  await assert.rejects(
    createLlmClient({ OLLAMA_API_KEY: 'k', LLM_MODEL: 'm' }).generate({ messages: [], maxTokens: 1 }),
    /quota or rate limit/,
  );
  capture({}, 503);
  await assert.rejects(
    createLlmClient({ LLM_PROVIDER: 'openai-compatible', LLM_API_KEY: 'k', LLM_MODEL: 'm' }).generate({
      messages: [],
      maxTokens: 1,
    }),
    /temporarily unavailable/,
  );
});

test('unknown providers are refused before any request', async () => {
  const log = capture({});
  await assert.rejects(
    createLlmClient({ LLM_PROVIDER: 'nope', LLM_API_KEY: 'k', LLM_MODEL: 'm' }).generate({
      messages: [],
      maxTokens: 1,
    }),
    /Unsupported model provider/,
  );
  assert.equal(log.calls.length, 0);
});

test('reasoning switch and explicit model are sent per call', async () => {
  const log = capture({ model: 'other-model', message: { content: '{}' } });
  await createLlmClient({ LLM_API_KEY: 'k', LLM_MODEL: 'm' }).generate({
    messages: [],
    maxTokens: 5,
    purpose: 'dpr',
    model: 'other-model',
    reasoning: true,
  });
  assert.equal(log.calls[0]?.body.model, 'other-model');
  assert.equal(log.calls[0]?.body.think, true);
});

test('writer, checker and fallback models come from the environment', () => {
  const env = { LLM_MODEL: 'w', LLM_MODEL_PR: 'w-pr', LLM_MODEL_CHECK: 'c', LLM_MODEL_FALLBACK: 'f' };
  assert.equal(modelFor(env, 'writer', 'pr'), 'w-pr');
  assert.equal(modelFor(env, 'writer', 'dpr'), 'w');
  assert.equal(modelFor(env, 'check'), 'c');
  assert.equal(modelFor(env, 'fallback'), 'f');
  assert.equal(modelFor({ ...env, LLM_MODEL_CHECK_FALLBACK: 'c2' }, 'check_fallback'), 'c2');
  for (const use of ['check', 'check_fallback', 'fallback', 'writer'] as const)
    assert.throws(() => modelFor({}, use), /is not set/);
});

test('errors are classified for the fallback rule', async () => {
  const client = createLlmClient({ LLM_API_KEY: 'k', LLM_MODEL: 'm' });
  const kindOf = async (status: number, body: unknown = {}) => {
    capture(body, status);
    return client.generate({ messages: [], maxTokens: 1 }).then(
      () => 'ok',
      (e: unknown) => classifyCallError(e),
    );
  };
  assert.equal(await kindOf(503), 'provider');
  assert.equal(await kindOf(429), 'provider');
  assert.equal(await kindOf(404), 'provider');
  assert.equal(await kindOf(401), 'config');
  assert.equal(await kindOf(402), 'config');
  assert.equal(await kindOf(200, { message: { content: 'not json' } }), 'output');
  assert.equal(classifyCallError(new TypeError('fetch failed')), 'provider');
});

test('reasoning leaked before </think> is dropped; anything else stays invalid', async () => {
  capture({ message: { content: 'The user wants JSON.</think>{"ok": true}' } });
  const r = await createLlmClient({ LLM_API_KEY: 'k', LLM_MODEL: 'm' }).generate({ messages: [], maxTokens: 5 });
  assert.deepEqual(r.output, { ok: true });
  capture({ message: { content: 'thinking</think>\n```json\n{"a":1}\n```' } });
  assert.deepEqual(
    (await createLlmClient({ LLM_API_KEY: 'k', LLM_MODEL: 'm' }).generate({ messages: [], maxTokens: 5 })).output,
    {
      a: 1,
    },
  );
  capture({ message: { content: 'Here you go: {"ok": true}' } });
  await assert.rejects(
    createLlmClient({ LLM_API_KEY: 'k', LLM_MODEL: 'm' }).generate({ messages: [], maxTokens: 5 }),
    IncompleteOutputError,
  );
});
