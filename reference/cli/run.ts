// One run: ingest, then work the queue within the budget. Same command for the
// timer and by hand. Reads the environment (LLM_API_KEY…) from the process:
//   node --env-file=.env cli/run.ts
//     [--manual] [--no-ingest] [--only id,id] [--max-calls N] [--max-minutes N]
import { parseArgs } from 'node:util';
import { databasePath, openDatabase } from '../engine/db/index.ts';
import { createLlmClient } from '../engine/llm/index.ts';
import { loadProfile, loadTeam } from '../engine/profile/index.ts';
import { checkAlerts, parseRunTimes } from '../engine/run/alerts.ts';
import { runOnce, runOptionsFromEnv } from '../engine/run/run.ts';

const { values } = parseArgs({
  options: {
    manual: { type: 'boolean' },
    'no-ingest': { type: 'boolean' },
    only: { type: 'string' },
    'max-calls': { type: 'string' },
    'max-minutes': { type: 'string' },
  },
});
const env = process.env;
const defaults = runOptionsFromEnv(env);
const db = openDatabase(databasePath(env));
try {
  const summary = await runOnce(
    { db, llm: createLlmClient(env), env, profile: loadProfile(), team: loadTeam() },
    {
      ...defaults,
      trigger: values.manual ? 'manual' : 'timer',
      ingest: !values['no-ingest'],
      maxCalls: Number(values['max-calls']) || defaults.maxCalls,
      maxMinutes: Number(values['max-minutes']) || defaults.maxMinutes,
      ...(values.only ? { only: values.only.split(',').map((s) => s.trim()) } : {}),
    },
  );
  console.log(JSON.stringify(summary, null, 2));
  // The alert check after every run (also hourly from cli/maintain.ts).
  const since = db.prepare(`SELECT value FROM settings WHERE key = 'timer:installed_at'`).get() as
    { value: string } | undefined;
  checkAlerts(db, {
    runTimes: parseRunTimes(env.RUN_TIMES),
    maxMinutes: defaults.maxMinutes,
    scheduledSince: since?.value ?? null,
  });
  process.exitCode = summary.outcome === 'failed' ? 1 : 0;
} finally {
  db.close();
}
