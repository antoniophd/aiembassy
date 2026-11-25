// Verifier comparison (2026-11-23): the claim check (check 7, prompt check.claim) sent to two models on
// the same real claims and on subtle corruptions made by code. Runs only on a database COPY; every call is
// claimed in that copy's llm_calls first (task 'probe'). Writes a JSON result next to the copy.
//   node --env-file=.env tools/verifier-compare.ts \
//     --db data/verifier/20261123/embassy.sqlite --models <checker-a>,<checker-b> [--dry]
import { realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { databasePath, nowIso, openDatabase } from '../engine/db/index.ts';
import { classifyCallError, createLlmClient } from '../engine/llm/index.ts';
import { claimPrompt } from '../prompts/check.claim.ts';
import { adoptedClaims, corruptions, sampleClaims, type SampledClaim } from './verifier-sample.ts';

const { values } = parseArgs({
  options: {
    db: { type: 'string' },
    models: { type: 'string' },
    claims: { type: 'string', default: '102' },
    'per-kind': { type: 'string', default: '5' },
    'max-calls': { type: 'string', default: '260' },
    dry: { type: 'boolean', default: false },
    tag: { type: 'string', default: 'main' },
  },
});
if (!values.db) throw Error('--db <copy> is required');
const copy = resolve(values.db);
const production = resolve(databasePath(process.env));
let same = copy === production;
try {
  same ||= realpathSync(copy) === realpathSync(production);
} catch {
  /* the production path may not resolve from here */
}
if (same) throw Error('Refusing to run on the production database; use a copy');

const db = openDatabase(copy);
const llm = createLlmClient(process.env);
if (!values.models) throw Error('--models is required: two checker models to compare, separated by a comma');
const models = values.models.split(',');
const all = adoptedClaims(db);
const sample = sampleClaims(all, Number(values.claims));
const bad = corruptions(sample, all, Number(values['per-kind']));
const maxCalls = Number(values['max-calls']);
console.log(`claims available ${all.length}, sampled ${sample.length}, corruptions ${bad.length}`);
const planned = (sample.length + bad.length) * models.length;
if (planned > maxCalls) throw Error(`Plan needs ${planned} calls, over the limit of ${maxCalls}`);

interface Verdict {
  model: string;
  verdict: string | null; // supported | not_supported | contradicted | null (no valid answer)
  reason: string | null;
  error: string | null; // output | provider | invalid_verdict
  inputTokens: number | null;
  outputTokens: number | null;
  ms: number | null;
}
const results: { item: string; kind: 'real' | 'corrupt'; verdicts: Verdict[] }[] = [];
let sent = 0;

async function check(item: string, claim: string, segment: SampledClaim['segment'], model: string): Promise<Verdict> {
  const id = `probe|verifier|${values.tag}|${item}|${model}`;
  db.prepare(
    `INSERT INTO llm_calls (id, purpose, provider, model_requested, reasoning, state, claimed_at, task, prompt_id, prompt_version)
     VALUES (?, 'verifier.claim', ?, ?, 0, 'claimed', ?, 'probe', ?, ?)`,
  ).run(id, llm.target().provider, model, nowIso(), claimPrompt.id, claimPrompt.version);
  sent++;
  try {
    const r = await llm.generate({ messages: claimPrompt.build({ claim, segment }), maxTokens: 1500, model });
    const out = r.output as { verdict?: string; reason?: string };
    const ok = ['supported', 'not_supported', 'contradicted'].includes(String(out?.verdict));
    db.prepare(
      `UPDATE llm_calls SET state='complete', model_used=?, input_tokens=?, output_tokens=?, duration_ms=?, finished_at=?,
         error_kind=?, error=? WHERE id=?`,
    ).run(
      r.model,
      r.usage.inputTokens,
      r.usage.outputTokens,
      r.durationMs,
      nowIso(),
      ok ? null : 'output',
      ok ? null : 'Invalid verdict',
      id,
    );
    return {
      model,
      verdict: ok ? out.verdict! : null,
      reason: out?.reason ?? null,
      error: ok ? null : 'invalid_verdict',
      inputTokens: r.usage.inputTokens,
      outputTokens: r.usage.outputTokens,
      ms: r.durationMs,
    };
  } catch (e) {
    const kind = classifyCallError(e);
    db.prepare(`UPDATE llm_calls SET state='failed', error_kind=?, error=?, finished_at=? WHERE id=?`).run(
      kind,
      String((e as Error).message),
      nowIso(),
      id,
    );
    if (kind === 'config') throw e; // key or credit: stop
    return {
      model,
      verdict: null,
      reason: String((e as Error).message),
      error: kind,
      inputTokens: null,
      outputTokens: null,
      ms: null,
    };
  }
}

if (!values.dry) {
  for (const c of sample) {
    const verdicts: Verdict[] = [];
    for (const m of models) verdicts.push(await check(`real:${c.key}`, c.claim, c.segment, m));
    results.push({ item: c.key, kind: 'real', verdicts });
  }
  for (const [i, b] of bad.entries()) {
    const verdicts: Verdict[] = [];
    for (const m of models) verdicts.push(await check(`corrupt:${i}:${b.source}`, b.corrupted, b.segment, m));
    results.push({ item: `${i}:${b.source}`, kind: 'corrupt', verdicts });
  }
}
const out = join(dirname(copy), values.dry ? 'verifier-plan.json' : `verifier-result-${values.tag}.json`);
writeFileSync(
  out,
  JSON.stringify(
    {
      at: nowIso(),
      models,
      calls: sent,
      sample: sample.map(({ segment: _s, ...c }) => c),
      corruptions: bad.map(({ segment, ...b }) => ({ ...b, cite: segment.label })),
      results,
    },
    null,
    1,
  ),
);
console.log(`calls sent ${sent}; written ${out}`);
db.close();
