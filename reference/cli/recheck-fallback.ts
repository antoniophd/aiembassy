// Files marked "written by the fallback model, of the same family as the checker" (2026-11-23): the
// fallback documents that a model check covers (a report's claims, decision A's red lines) are checked again by
// the second checker, and the mark is computed again. Nothing else is redone; a failed check is reported, never
// acted on. Without --run it only counts the calls.
//   node --env-file=.env cli/recheck-fallback.ts [--run] [--max-calls N]
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { databasePath, openDatabase } from '../engine/db/index.ts';
import { createLlmClient } from '../engine/llm/index.ts';
import { loadProfile, loadTeam } from '../engine/profile/index.ts';
import { acquireLock, releaseLock } from '../engine/run/lock.ts';
import type { TaskKey } from '../engine/work/calls.ts';
import type { FileRow } from '../engine/work/context.ts';
import { acceptedDocument } from '../engine/work/documents.ts';
import { runClaim, runRedLine } from '../engine/work/fullfile.ts';
import { FALLBACK_LINE, fallbackDocuments, refreshFallbackMark } from '../engine/work/second-check.ts';

const { values } = parseArgs({ options: { run: { type: 'boolean' }, 'max-calls': { type: 'string', default: '60' } } });
const env = process.env;
const db = openDatabase(databasePath(env));
const profile = loadProfile();
const team = loadTeam();
const redLines = profile.red_lines.map((r) => r.id);

const files = db
  .prepare(`SELECT * FROM files WHERE low_confidence = 1 AND instr(low_confidence_reason, ?) > 0 ORDER BY meeting_id`)
  .all(FALLBACK_LINE) as unknown as FileRow[];
const second = (d: { body_json: string } | undefined) =>
  !!d && (JSON.parse(d.body_json) as { second_checker?: boolean }).second_checker === true;
const plan: { file: FileRow; meetingId: string; task: 'claim' | 'redline'; ref: string }[] = [];
const uncovered: string[] = [];
for (const f of files) {
  for (const d of fallbackDocuments(db, f)) {
    if (d.kind === 'report') {
      const n = ((JSON.parse(d.body_json) as { claims?: unknown[] }).claims ?? []).length;
      for (let i = 0; i < n; i++) {
        const ref = `claim:${d.id}:${i}`;
        if (!second(acceptedDocument(db, f.id, d.meeting_id, 'check', ref)))
          plan.push({ file: f, meetingId: d.meeting_id, task: 'claim', ref });
      }
    } else if (d.kind === 'decision' && d.ref === 'A') {
      for (const r of redLines) {
        const ref = `redline:${d.id}:${r}`;
        if (!second(acceptedDocument(db, f.id, d.meeting_id, 'check', ref)))
          plan.push({ file: f, meetingId: d.meeting_id, task: 'redline', ref });
      }
    } else uncovered.push(`${f.meeting_id}: ${d.kind}${d.ref ? ' ' + d.ref : ''} (no model check covers it)`);
  }
}
const per = new Map<string, number>();
for (const p of plan) per.set(p.file.meeting_id, (per.get(p.file.meeting_id) ?? 0) + 1);
console.log(`files ${files.length}; calls ${plan.length}`);
for (const [m, n] of per) console.log(`  ${m}: ${n}`);
for (const u of uncovered) console.log(`  kept: ${u}`);

if (values.run) {
  if (plan.length > Number(values['max-calls'])) throw Error(`${plan.length} calls, over --max-calls`);
  const owner = 'recheck-fallback-' + randomUUID();
  if (!acquireLock(db, owner, 60)) throw Error('A run holds the lock; try later');
  const runId = randomUUID();
  db.prepare(`INSERT INTO runs (id, trigger, started_at) VALUES (?, 'manual', ?)`).run(runId, new Date().toISOString());
  let outcome = 'failed';
  try {
    const llm = createLlmClient(env);
    for (const p of plan) {
      const key: TaskKey = {
        fileId: p.file.id,
        task: p.task,
        meetingId: p.meetingId,
        ref: p.ref,
        epoch: p.file.epoch,
      };
      const last = db
        .prepare(
          'SELECT MAX(attempt) AS a FROM llm_calls WHERE file_id = ? AND task = ? AND meeting_id = ? AND ref = ?',
        )
        .get(key.fileId, key.task, key.meetingId, key.ref) as { a: number | null };
      const ctx = {
        db,
        llm,
        env,
        profile,
        team,
        runId,
        key,
        decision: { kind: 'call' as const, attempt: (last.a ?? 0) + 1, fallback: false, round: 0 },
        owner: p.file,
        workFile: p.file,
      };
      await (p.task === 'claim' ? runClaim(ctx) : runRedLine(ctx));
      const d = acceptedDocument(db, key.fileId, key.meetingId, 'check', key.ref);
      const b = d ? (JSON.parse(d.body_json) as { verdict?: string; crosses?: boolean }) : {};
      const ok = second(d) && (p.task === 'claim' ? b.verdict === 'supported' : b.crosses === false);
      if (!ok)
        console.log(
          `  ${p.file.meeting_id} ${p.ref}: ${second(d) ? (b.verdict ?? `crosses=${b.crosses}`) : 'no answer'}`,
        );
    }
    for (const f of files)
      console.log(`  ${f.meeting_id}: ${refreshFallbackMark(db, f.id, redLines) ? 'mark cleared' : 'mark kept'}`);
    outcome = 'completed';
  } finally {
    const n = db.prepare('SELECT COUNT(*) AS n FROM llm_calls WHERE run_id = ?').get(runId) as { n: number };
    db.prepare('UPDATE runs SET finished_at = ?, outcome = ?, calls = ?, steps = ? WHERE id = ?').run(
      new Date().toISOString(),
      outcome,
      n.n,
      n.n,
      runId,
    );
    releaseLock(db, owner);
  }
}
db.close();
