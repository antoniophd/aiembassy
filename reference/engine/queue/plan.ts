// The queue: for one file, the next step to take. Pure reads; a step makes at
// most one model call. State lives in files.status; progress inside a status
// is read from the ledger and the accepted documents.
import { createHash } from 'node:crypto';
import type { Db } from '../db/index.ts';
import { attemptRecords, baseAttempt, type TaskKey } from '../work/calls.ts';
import { fileForMeeting, loadMaterial, type FileRow, type FileStatus } from '../work/context.ts';
import { CABLE_TRIES, cableRejections, wantsCable } from '../work/cable-task.ts';
import { acceptedDocument } from '../work/documents.ts';
import { writtenByFallback } from '../work/second-check.ts';
import { decide, type Decision } from '../work/ladder.ts';
import { claimVerdicts, nextFullStep } from './plan-full.ts';

export type Step =
  | { type: 'call'; key: TaskKey; decision: Extract<Decision, { kind: 'call' }>; file: FileRow }
  | { type: 'reject'; file: FileRow; callId: string; documentId: string; reason: string }
  | { type: 'adopt'; file: FileRow; note?: string }
  | { type: 'status'; file: FileRow; status: FileStatus; reason: string | null }
  | { type: 'halt'; reason: string };

type TaskState = { done: true } | { done: false; step: Step | null };

/**
 * The documents that get a second chance (2026-11-25): those whose failure stops the file. Not the
 * summaries and checks (technical), nor the cable (two tries, then the file goes on without it).
 */
const SECOND_CHANCE_TASKS = new Set<TaskKey['task']>([
  'triage',
  'note',
  'report',
  'opinion',
  'memo',
  'decision',
  'press',
]);

function task(
  db: Db,
  file: FileRow,
  key: TaskKey,
  runId: string,
  onGiveUp: (technical: boolean) => FileStatus,
): TaskState {
  const kind =
    key.task === 'summary'
      ? 'segment_summary'
      : key.task === 'memo'
        ? 'options_memo'
        : key.task === 'claim' || key.task === 'redline'
          ? 'check'
          : key.task;
  if (acceptedDocument(db, key.fileId, key.meetingId, kind, key.ref)) return { done: true };
  // Attempts are numbered on from earlier epochs; the ladder sees this epoch only.
  const base = baseAttempt(db, key);
  const d = decide(
    attemptRecords(db, key).map((r) => ({ ...r, attempt: r.attempt - base })),
    runId,
    { secondChance: SECOND_CHANCE_TASKS.has(key.task) },
  );
  if (d.kind === 'call')
    return { done: false, step: { type: 'call', key, decision: { ...d, attempt: d.attempt + base }, file } };
  if (d.kind === 'halt') return { done: false, step: { type: 'halt', reason: d.reason } };
  if (d.kind === 'wait') return { done: false, step: null };
  return {
    done: false,
    step: { type: 'status', file, status: onGiveUp(d.technical), reason: `${key.task} ${key.ref}: ${d.reason}`.trim() },
  };
}

/** Labels of the segments the work reads: the meeting's own span (loadMaterial). */
const segmentLabels = (db: Db, meetingId: string): string[] => loadMaterial(db, meetingId).segments.map((s) => s.label);

/**
 * Summaries of every segment of `meetingId`, then the report, all inside
 * `workFile`. Returns done when the report is accepted.
 */
function reportPipeline(db: Db, owner: FileRow, workFile: FileRow, meetingId: string, runId: string): TaskState {
  const giveUp = (technical: boolean): FileStatus => (technical ? 'failed' : 'not_adopted');
  for (const ref of segmentLabels(db, meetingId)) {
    const s = task(
      db,
      owner,
      { fileId: workFile.id, task: 'summary', meetingId, ref, epoch: workFile.epoch },
      runId,
      () => 'failed',
    );
    if (!s.done) return s;
  }
  return task(
    db,
    owner,
    { fileId: workFile.id, task: 'report', meetingId, ref: '', epoch: workFile.epoch },
    runId,
    giveUp,
  );
}

export function planFile(db: Db, file: FileRow, runId: string, redLines: string[] = []): Step | null {
  const own = (t: TaskKey['task']): TaskKey => ({
    fileId: file.id,
    task: t,
    meetingId: file.meeting_id,
    ref: '',
    epoch: file.epoch,
  });
  switch (file.status) {
    case 'queued': {
      const t = task(db, file, own('triage'), runId, () => 'failed');
      return t.done ? null : t.step; // a done triage moves the file to triaged when applied
    }
    case 'triaged': {
      // Held after a new triage until the operator has seen the levels (reprocess, 2026-11-13).
      if ((file as FileRow & { hold_after_triage?: number }).hold_after_triage) return null;
      if (file.duplicate_of) return planDuplicate(db, file, runId);
      if (file.level === 'note') {
        const t = task(db, file, own('note'), runId, () => 'failed');
        return t.done ? { type: 'status', file, status: 'noted', reason: null } : t.step;
      }
      return { type: 'status', file, status: 'in_progress', reason: null };
    }
    case 'in_progress': {
      const t = reportPipeline(db, file, file, file.meeting_id, runId);
      if (!t.done) return t.step;
      if (file.level === 'report') {
        const sample = sampleClaim(db, file);
        if (sample) {
          const c = task(
            db,
            file,
            { fileId: file.id, task: 'claim', meetingId: file.meeting_id, ref: sample, epoch: file.epoch },
            runId,
            () => 'reported', // the sample never gates a report
          );
          if (!c.done) return c.step;
        }
        // The cable of a report marked by the triage; it never holds the report back.
        if (wantsCable(db, file.id, file.meeting_id) && !acceptedDocument(db, file.id, file.meeting_id, 'cable')) {
          if (cableRejections(db, file.id, file.meeting_id, file.epoch) >= CABLE_TRIES)
            return { type: 'status', file, status: 'reported', reason: 'No cable: it failed its checks twice.' };
          const c = task(
            db,
            file,
            { fileId: file.id, task: 'cable', meetingId: file.meeting_id, ref: '', epoch: file.epoch },
            runId,
            () => 'reported',
          );
          if (!c.done) return c.step;
        }
        return { type: 'status', file, status: 'reported', reason: null };
      }
      return planFull(db, file, runId, redLines);
    }
    default:
      return null;
  }
}

/** A resumed part of the same session: its report goes into the first part's file. */
function planDuplicate(db: Db, file: FileRow, runId: string): Step | null {
  const primary = fileForMeeting(db, file.duplicate_of as string);
  const reason = `Resumed part of ${file.duplicate_of}; documents in that file.`;
  if (!primary || primary.status === 'queued') return null;
  if ((primary as FileRow & { hold_after_triage?: number }).hold_after_triage) return null;
  if (primary.duplicate_of) return null; // re-linked to the root by the triage rule (see migration 0003)
  if (primary.status === 'failed' || primary.level === 'note')
    return { type: 'status', file, status: 'noted', reason: `Part of ${file.duplicate_of}; no separate work.` };
  if (!primary.level) return null;
  const t = reportPipeline(db, file, primary, file.meeting_id, runId);
  if (!t.done) return t.step;
  return { type: 'status', file, status: 'reported', reason };
}

/** Full files after the report: the Phase C pipeline (plan-full.ts). */
function planFull(db: Db, file: FileRow, runId: string, redLines: string[]): Step | null {
  const next = nextFullStep(db, file, redLines);
  if (next.kind === 'wait') return null;
  if (next.kind === 'adopt') return { type: 'adopt', file, ...(next.note ? { note: next.note } : {}) };
  if (next.kind === 'reject')
    return { type: 'reject', file, callId: next.callId, documentId: next.documentId, reason: next.reason };
  const technical = next.task === 'claim' || next.task === 'redline';
  const t = task(
    db,
    file,
    { fileId: file.id, task: next.task, meetingId: file.meeting_id, ref: next.ref, epoch: file.epoch },
    runId,
    (tech) => (tech || technical ? 'failed' : 'not_adopted'),
  );
  // A cable that cannot be written never holds the file back.
  if (next.task === 'cable' && !t.done && t.step?.type === 'status')
    return { type: 'adopt', file, note: `No cable: ${t.step.reason ?? 'gave up'}` };
  // Nor does a press pack (2026-11-25): the file is adopted without it.
  if (next.task === 'press' && next.ref === 'pack' && !t.done && t.step?.type === 'status')
    return { type: 'adopt', file, note: `No press pack: ${t.step.reason ?? 'gave up'}` };
  return t.done ? null : t.step;
}

/** One report in ten, by a hash of the meeting id, has its claims checked for the Metrics view only. */
export const inClaimSample = (meetingId: string): boolean =>
  createHash('sha256').update(meetingId).digest()[0]! % 10 === 0;

/**
 * The next unchecked claim of a sampled report, or of a report written by the fallback (every claim, by the
 * second checker; 2026-11-23), or null. It never gates the report.
 */
function sampleClaim(db: Db, file: FileRow): string | null {
  const report = acceptedDocument(db, file.id, file.meeting_id, 'report');
  if (!report || (!inClaimSample(file.meeting_id) && !writtenByFallback(db, report))) return null;
  const verdicts = claimVerdicts(db, file, report);
  const i = verdicts.findIndex((v) => v === null);
  return i < 0 ? null : `claim:${report.id}:${i}`;
}
