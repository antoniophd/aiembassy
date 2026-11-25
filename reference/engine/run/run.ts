// A run, under the lock: ingest new transcripts, then work the queue step by
// step until nothing eligible is left or the budget is reached. Interrupted
// or repeated runs never repeat finished work (ledger + accepted documents).
import { randomUUID } from 'node:crypto';
import { nowIso, type Db } from '../db/index.ts';
import { ingestWindow, type IngestResult } from '../ingest/store.ts';
import { newYorkDate, offsetDate, weekStart } from '../ingest/scope.ts';
import { fetchIndex } from '../ingest/un-transcripts.ts';
import { executeStep, type Services } from '../queue/execute.ts';
import { planFile, type Step } from '../queue/plan.ts';
import type { FileRow } from '../work/context.ts';
import { acquireLock, releaseLock } from './lock.ts';

export interface RunOptions {
  trigger: 'timer' | 'manual';
  maxMinutes: number;
  maxCalls: number;
  ingest: boolean;
  /** Restrict work to these meeting ids (tests, targeted runs). */
  only?: string[];
}

export interface RunSummary {
  runId: string;
  outcome: 'completed' | 'budget' | 'failed';
  steps: number;
  calls: number;
  ingest: (Omit<IngestResult, 'ingested'> & { ingested: number }) | null;
  halted: string | null;
  error: string | null;
}

export const runOptionsFromEnv = (env: Record<string, string | undefined>): Omit<RunOptions, 'trigger'> => ({
  maxMinutes: Number(env.RUN_MAX_MINUTES) || 120,
  maxCalls: Number(env.RUN_MAX_CALLS) || 400,
  ingest: true,
});

/** The next step across all files, oldest meeting first. */
export function nextStep(db: Db, runId: string, only?: string[], redLines: string[] = []): Step | null {
  const files = db
    .prepare(
      `SELECT f.* FROM files f JOIN meetings m ON m.id = f.meeting_id
       WHERE f.status IN ('queued','triaged','in_progress') ORDER BY m.date, m.id`,
    )
    .all() as unknown as FileRow[];
  for (const file of files) {
    if (only && !only.includes(file.meeting_id)) continue;
    const step = planFile(db, file, runId, redLines);
    if (step) return step;
  }
  return null;
}

export async function runOnce(s: Services, options: RunOptions): Promise<RunSummary> {
  const runId = randomUUID();
  const owner = 'run:' + runId;
  if (!acquireLock(s.db, owner, options.maxMinutes + 15)) throw Error('Another run holds the lock; nothing done.');
  const started = Date.now();
  s.db.prepare(`INSERT INTO runs (id, trigger, started_at) VALUES (?, ?, ?)`).run(runId, options.trigger, nowIso());
  const summary: RunSummary = {
    runId,
    outcome: 'completed',
    steps: 0,
    calls: 0,
    ingest: null,
    halted: null,
    error: null,
  };
  try {
    if (options.ingest) {
      const today = newYorkDate();
      const r = await ingestWindow(s.db, await fetchIndex(offsetDate(weekStart(today), -7), today), today);
      summary.ingest = { ...r, ingested: r.ingested.length };
    }
    for (;;) {
      if (summary.calls >= options.maxCalls || Date.now() - started > options.maxMinutes * 60_000) {
        summary.outcome = 'budget';
        break;
      }
      const step = nextStep(
        s.db,
        runId,
        options.only,
        s.profile.red_lines.map((r) => r.id),
      );
      if (!step) break;
      const result = await executeStep(s, step, runId);
      summary.steps++;
      if (result.called) summary.calls++;
      if (result.halted) {
        summary.halted = result.halted;
        summary.outcome = 'failed';
        break;
      }
      if (summary.steps > options.maxCalls * 4) throw Error('Step limit exceeded without progress');
    }
  } catch (error) {
    summary.outcome = 'failed';
    summary.error = String((error as Error).message).slice(0, 500);
  } finally {
    s.db
      .prepare(`UPDATE runs SET finished_at = ?, outcome = ?, steps = ?, calls = ?, summary_json = ? WHERE id = ?`)
      .run(nowIso(), summary.outcome, summary.steps, summary.calls, JSON.stringify(summary), runId);
    releaseLock(s.db, owner);
  }
  return summary;
}
