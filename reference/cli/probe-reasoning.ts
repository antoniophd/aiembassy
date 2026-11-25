// Whether the writer model accepts a reasoning effort level (2026-11-19): the same small task sent
// with reasoning on and with effort "low"; output tokens compared. Each call is claimed in llm_calls first
// (task 'probe'). Two calls by default; `--model <id> --levels low` sends one.
//   node --env-file=.env cli/probe-reasoning.ts [--model m] [--levels true,low]
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { databasePath, nowIso, openDatabase } from '../engine/db/index.ts';
import { classifyCallError, createLlmClient, modelFor, type Reasoning } from '../engine/llm/index.ts';

const env = process.env;
const db = openDatabase(databasePath(env));
const llm = createLlmClient(env);
const { values } = parseArgs({ options: { model: { type: 'string' }, levels: { type: 'string' } } });
const model = values.model ?? modelFor(env, 'writer', 'pr');
const levels = (values.levels ?? 'true,low').split(',').map((l) => (l === 'true' ? true : (l as Reasoning)));
const task =
  'Three delegations spoke on a draft resolution. Arvenia voted in favour, Belmora abstained, Corvalia voted against. ' +
  'A State that wants humanitarian access protected but takes no side on the dispute must choose a vote. ' +
  'Return only JSON: {"vote": "yes|no|abstain", "why": "<one sentence>"}.';
for (const reasoning of levels) {
  const id = 'probe|reasoning-' + String(reasoning) + '|' + randomUUID();
  db.prepare(
    `INSERT INTO llm_calls (id, purpose, provider, model_requested, reasoning, state, claimed_at, task)
     VALUES (?, ?, ?, ?, 1, 'claimed', ?, 'probe')`,
  ).run(id, 'probe.reasoning-' + String(reasoning), llm.target().provider, model, nowIso());
  try {
    const r = await llm.generate({ messages: [{ role: 'user', content: task }], maxTokens: 6000, model, reasoning });
    db.prepare(
      `UPDATE llm_calls SET state='complete', model_used=?, input_tokens=?, output_tokens=?, duration_ms=?, finished_at=? WHERE id=?`,
    ).run(r.model, r.usage.inputTokens, r.usage.outputTokens, r.durationMs, nowIso(), id);
    console.log(
      `${model} reasoning=${String(reasoning)} ok output_tokens=${r.usage.outputTokens} ${r.durationMs} ms ${JSON.stringify(r.output)}`,
    );
  } catch (e) {
    db.prepare(`UPDATE llm_calls SET state='failed', error_kind=?, error=?, finished_at=? WHERE id=?`).run(
      classifyCallError(e),
      String((e as Error).message),
      nowIso(),
      id,
    );
    console.log(`${model} reasoning=${String(reasoning)} FAILED: ${(e as Error).message}`);
  }
}
db.close();
