// Sends one minimal call to each configured model (writer, checker, fallback)
// to confirm the identifiers and that the plan includes them. Each call is
// claimed in llm_calls first.
//   node --env-file=.env cli/probe-models.ts
import { randomUUID } from 'node:crypto';
import { databasePath, nowIso, openDatabase } from '../engine/db/index.ts';
import { classifyCallError, createLlmClient, modelFor } from '../engine/llm/index.ts';

const env = process.env;
const db = openDatabase(databasePath(env));
const llm = createLlmClient(env);
for (const use of ['writer', 'check', 'fallback'] as const) {
  const model = modelFor(env, use);
  for (const reasoning of use === 'writer' ? [false, true] : [false]) {
    const id = 'probe|' + use + '|' + (reasoning ? 'think' : 'plain') + '|' + randomUUID();
    db.prepare(
      `INSERT INTO llm_calls (id, purpose, provider, model_requested, reasoning, state, claimed_at, task)
       VALUES (?, ?, ?, ?, ?, 'claimed', ?, 'probe')`,
    ).run(id, 'probe.' + use, llm.target().provider, model, reasoning ? 1 : 0, nowIso());
    try {
      const r = await llm.generate({
        messages: [{ role: 'user', content: 'Return the JSON object {"ok": true} and nothing else.' }],
        maxTokens: 800,
        model,
        reasoning,
      });
      db.prepare(
        `UPDATE llm_calls SET state='complete', model_used=?, input_tokens=?, output_tokens=?, duration_ms=?, finished_at=? WHERE id=?`,
      ).run(r.model, r.usage.inputTokens, r.usage.outputTokens, r.durationMs, nowIso(), id);
      console.log(
        `${use.padEnd(8)} ${model.padEnd(22)} reasoning=${reasoning} ok model_used=${r.model} output=${JSON.stringify(r.output)} ${r.durationMs} ms`,
      );
    } catch (e) {
      db.prepare(`UPDATE llm_calls SET state='failed', error_kind=?, error=?, finished_at=? WHERE id=?`).run(
        classifyCallError(e),
        String((e as Error).message),
        nowIso(),
        id,
      );
      console.log(`${use.padEnd(8)} ${model.padEnd(22)} reasoning=${reasoning} FAILED: ${(e as Error).message}`);
    }
  }
}
db.close();
