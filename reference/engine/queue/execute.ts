// Executes one step. Model output is validated by code; a document and the
// status change it implies are written in one transaction.
import { nowIso, transaction, type Db } from '../db/index.ts';
import type { LlmClient, LlmEnvironment } from '../llm/index.ts';
import type { StateProfile, Team } from '../profile/index.ts';
import { counsellorRole, runNote, runReport, runSummary, type TaskContext } from '../work/tasks.ts';
import { runTriage } from '../work/triage-task.ts';
import { adoptFile, rejectLater } from '../work/adopt.ts';
import { runClaim, runDecision, runMemo, runOpinion, runRedLine } from '../work/fullfile.ts';
import { runPress } from '../work/press-task.ts';
import { runPressPack } from '../work/press-pack-task.ts';
import { runCable } from '../work/cable-task.ts';
import { acceptedDocument } from '../work/documents.ts';
import { refreshFallbackMark } from '../work/second-check.ts';
import type { Step } from './plan.ts';

export interface Services {
  db: Db;
  llm: LlmClient;
  env: LlmEnvironment;
  profile: StateProfile;
  team: Team;
}

export type StepResult = { called: boolean; halted?: string };

export function setStatus(db: Db, fileId: string, status: string, reason: string | null): void {
  db.prepare('UPDATE files SET status = ?, status_reason = ?, updated_at = ? WHERE id = ?').run(
    status,
    reason,
    nowIso(),
    fileId,
  );
}

export async function executeStep(s: Services, step: Step, runId: string): Promise<StepResult> {
  if (step.type === 'halt') return { called: false, halted: step.reason };
  const redLines = s.profile.red_lines.map((r) => r.id);
  if (step.type === 'status') {
    transaction(s.db, () => setStatus(s.db, step.file.id, step.status, step.reason));
    if (step.status === 'reported') refreshFallbackMark(s.db, step.file.id, redLines);
    return { called: false };
  }
  if (step.type === 'reject') {
    rejectLater(s.db, step.file, step.callId, step.documentId, step.reason);
    return { called: false };
  }
  if (step.type === 'adopt') {
    adoptFile(s.db, step.file, redLines);
    refreshFallbackMark(s.db, step.file.id, redLines);
    if (step.note)
      s.db.prepare('UPDATE files SET status_reason = ? WHERE id = ?').run(step.note.slice(0, 500), step.file.id);
    return { called: false };
  }
  const workFile = s.db.prepare('SELECT * FROM files WHERE id = ?').get(step.key.fileId) as unknown as typeof step.file;
  const ctx: TaskContext = {
    ...s,
    runId,
    key: step.key,
    decision: step.decision,
    owner: step.file,
    workFile,
  };
  switch (step.key.task) {
    case 'triage':
      await runTriage(ctx);
      break;
    case 'note':
      await runNote(ctx);
      break;
    case 'summary':
      await runSummary(ctx, counsellorRole(workFile));
      break;
    case 'report':
      await runReport(ctx, counsellorRole(workFile));
      break;
    case 'claim':
      await runClaim(ctx);
      break;
    case 'opinion':
      await runOpinion(ctx);
      break;
    case 'memo':
      await runMemo(ctx);
      break;
    case 'decision':
      await runDecision(ctx);
      break;
    case 'redline':
      await runRedLine(ctx);
      break;
    case 'cable':
      await runCable(ctx);
      break;
    case 'press': {
      if (step.key.ref === 'pack') {
        await runPressPack(ctx);
        break;
      }
      const a = acceptedDocument(s.db, workFile.id, workFile.meeting_id, 'decision', 'A');
      const p = a ? (JSON.parse(a.body_json) as { press?: string }).press : 'none';
      await runPress(ctx, p === 'explanation of vote' ? p : 'statement');
      break;
    }
  }
  return { called: true };
}
