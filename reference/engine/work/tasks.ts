// The model tasks of Phase B: triage (see triage-task.ts), note, segment
// summary and meeting report. Each makes exactly one call through the ledger.
import { transaction, type Db } from '../db/index.ts';
import { modelFor, type LlmClient, type LlmEnvironment, type Reasoning } from '../llm/index.ts';
import type { StateProfile, Team } from '../profile/index.ts';
import { BODY_LABELS, meetingRef } from '../ingest/scope.ts';
import { notePrompt } from '../../prompts/dpr.note.ts';
import { summaryPrompt } from '../../prompts/counsellor.summary.ts';
import { reportPrompt } from '../../prompts/counsellor.report.ts';
import type { Prompt } from '../../prompts/types.ts';
import { wordCount } from '../check/source.ts';
import {
  draftNumber,
  groupStatements,
  missingTallies,
  repairNamedLines,
  TALLY_UNCLEAR,
  transcriptTallies,
} from '../check/record.ts';
import type { DecisionTiming } from '../check/timing.ts';
import { callModel, rejectCall, type CallOutcome, type TaskKey } from './calls.ts';
import { loadMaterial, speakerList, type FileRow, type MeetingMaterial } from './context.ts';
import { acceptedDocument, storeDocument } from './documents.ts';
import type { Decision } from './ladder.ts';
import { checkReport, parseReport, renderReport, reportWordGuide, ReportOutputError } from './report-doc.ts';

export interface TaskContext {
  db: Db;
  llm: LlmClient;
  env: LlmEnvironment;
  profile: StateProfile;
  team: Team;
  runId: string;
  key: TaskKey;
  decision: Extract<Decision, { kind: 'call' }>;
  /** The file whose status the task advances. */
  owner: FileRow;
  /** The file that holds the documents (the first part's file for resumed parts). */
  workFile: FileRow;
}

export const NOTE_MAX_WORDS = 60;

export const counsellorRole = (f: FileRow): string => f.lead || 'political';

export const hms = (s: number | null): string =>
  s === null ? 'unknown' : `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`;

export function meetingFacts(m: MeetingMaterial) {
  const x = m.meeting;
  return {
    id: x.id,
    body: BODY_LABELS[x.body],
    title: x.title,
    date: x.date,
    duration: hms(x.duration_seconds),
    part: x.part,
  };
}

export const opening = (m: MeetingMaterial, chars = 8000): string =>
  m.segments
    .map((s) => s.text)
    .join('\n')
    .slice(0, chars);

/** Sends the call for this task. */
export function send<I>(
  ctx: TaskContext,
  role: string,
  prompt: Prompt<I>,
  input: I,
  maxTokens: number,
  reasoning: Reasoning = false,
  use: 'writer' | 'check' | 'check_fallback' = 'writer',
): Promise<CallOutcome> {
  return callModel(ctx.db, ctx.llm, ctx.env, {
    ...ctx.key,
    runId: ctx.runId,
    role,
    use,
    attempt: ctx.decision.attempt,
    fallback: ctx.decision.fallback,
    round: ctx.decision.round,
    reasoning,
    promptId: prompt.id,
    promptVersion: prompt.version,
    messages: prompt.build(input),
    maxTokens,
  });
}

/** The line a document written by the fallback model carries. */
/** No model names: they are kept in the ledger and shown in Metrics only (2026-11-13). */
export const fallbackLine = (_env: LlmEnvironment, _model: string): string =>
  'Low confidence: written by the fallback model, of the same family as the checker.';

export function docBase(ctx: TaskContext, call: CallOutcome, prompt: Prompt<never>, role: string) {
  if (!call.result) throw Error('No result');
  return {
    lowConfidence: ctx.decision.fallback ? fallbackLine(ctx.env, call.result.model) : null,
    fileId: ctx.key.fileId,
    meetingId: ctx.key.meetingId,
    ref: ctx.key.ref,
    role,
    attempt: ctx.decision.attempt,
    promptId: prompt.id,
    promptVersion: prompt.version,
    callId: call.id,
    result: call.result,
  };
}

const withLine = (line: string | null, text: string): string => (line ? line + '\n\n' + text : text);

export async function runNote(ctx: TaskContext): Promise<void> {
  const m = loadMaterial(ctx.db, ctx.key.meetingId);
  const triage = acceptedDocument(ctx.db, ctx.key.fileId, ctx.key.meetingId, 'triage');
  const reason = triage ? String((JSON.parse(triage.body_json) as { reason?: string }).reason ?? '') : '';
  const call = await send(
    ctx,
    'dpr',
    notePrompt,
    { meeting: meetingFacts(m), triageReason: reason, speakers: speakerList(m.speakers), opening: opening(m, 3000) },
    700,
  );
  if (!call.result) return;
  const note = (call.result.output as { note?: unknown })?.note;
  if (typeof note !== 'string' || !note.trim()) return rejectCall(ctx.db, call.id, 'output', 'Note missing');
  const words = wordCount(note);
  transaction(ctx.db, () => {
    storeDocument(ctx.db, {
      ...docBase(ctx, call, notePrompt as Prompt<never>, 'dpr'),
      kind: 'note',
      body: { note: note.trim(), words },
      text: withLine(m.lowConfidenceLine, note.trim()),
    });
    if (words > NOTE_MAX_WORDS * 2)
      rejectCall(ctx.db, call.id, 'check', `Note has ${words} words; hard cap ${NOTE_MAX_WORDS * 2}`);
  });
}

export async function runSummary(ctx: TaskContext, role: string): Promise<void> {
  const m = loadMaterial(ctx.db, ctx.key.meetingId);
  const seg = m.segments.find((s) => s.label === ctx.key.ref);
  if (!seg) throw Error('Unknown segment ' + ctx.key.ref);
  const call = await send(
    ctx,
    role,
    summaryPrompt,
    {
      meeting: { id: m.meeting.id, body: BODY_LABELS[m.meeting.body], title: m.meeting.title },
      segment: { label: seg.label, speakers: [...new Set(seg.speakers.map((s) => s.label))], text: seg.text },
    },
    2000,
  );
  if (!call.result) return;
  const out = call.result.output as { points?: unknown; outcome?: unknown };
  if (!Array.isArray(out?.points) || !out.points.length)
    return rejectCall(ctx.db, call.id, 'output', 'Summary has no points');
  const text = out.points
    .map((p) => {
      const x = (p ?? {}) as { speaker?: unknown; text?: unknown };
      return `${String(x.speaker ?? '')}: ${String(x.text ?? '')}`;
    })
    .join('\n');
  transaction(ctx.db, () =>
    storeDocument(ctx.db, {
      ...docBase(ctx, call, summaryPrompt as Prompt<never>, role),
      kind: 'segment_summary',
      body: out,
      text,
    }),
  );
}

export async function runReport(ctx: TaskContext, role: string): Promise<void> {
  const m = loadMaterial(ctx.db, ctx.key.meetingId);
  const summaries = m.segments.map((s) => {
    const d = acceptedDocument(ctx.db, ctx.key.fileId, ctx.key.meetingId, 'segment_summary', s.label);
    if (!d) throw Error('Summary missing for ' + s.label);
    return { label: s.label, speakers: [...new Set(s.speakers.map((x) => x.label))], summary: JSON.parse(d.body_json) };
  });
  const feedback = previousFailures(ctx);
  // The decision point of a full file (from the work file's triage), for the key points.
  const own = ctx.db.prepare('SELECT meeting_id FROM files WHERE id = ?').get(ctx.key.fileId) as { meeting_id: string };
  const triage = acceptedDocument(ctx.db, ctx.key.fileId, own.meeting_id, 'triage');
  const t = triage
    ? (JSON.parse(triage.body_json) as { decisionPoint?: string | null; decisionStatus?: DecisionTiming | null })
    : {};
  const decisionPoint = t.decisionPoint ?? null;
  const call = await send(
    ctx,
    role,
    reportPrompt,
    {
      profile: ctx.profile,
      council: m.meeting.body === 'security_council',
      decisionPoint,
      decisionStatus: t.decisionStatus ?? null,
      meeting: { ...meetingFacts(m), name: meetingRef(m.meeting.title, m.meeting.body) ?? BODY_LABELS[m.meeting.body] },
      speakers: speakerList(m.speakers).map((s) => s.label),
      summaries,
      maxWords: reportWordGuide(m.segments.length, m.meeting.body),
      lowConfidence: m.lowConfidenceLine,
      feedback,
    },
    12000,
  );
  if (!call.result) return;
  let report;
  try {
    report = parseReport(call.result.output);
    // Tallies the transcript records but the report left out are added by code, as announced; a garbled
    // announcement is never interpreted: "tally unclear in the transcript" (2026-11-13).
    const tallies = transcriptTallies(m.segments);
    for (const t of missingTallies(tallies, report.votes))
      report.votes.push({
        draft: 'L.' + t.draft,
        result: 'adopted',
        in_favour: t.in_favour,
        against: t.against ?? null,
        abstentions: t.abstentions ?? null,
        text: '',
        cites: [t.segment],
      });
    for (const t of tallies.filter((x) => x.unclear))
      for (const v of report.votes.filter((v) => draftNumber(v.draft) === t.draft)) {
        v.in_favour = v.against = v.abstentions = null;
        v.result = `${v.result.replace(/;.*$/, '')}; ${TALLY_UNCLEAR}`;
      }
    // The number of States in each group statement is counted by code from the transcript.
    const found = groupStatements(m.segments);
    for (const g of report.group_statements)
      g.states =
        found.find(
          (x) =>
            g.cites.includes(x.segment) &&
            (x.speaker.split('·')[0] ?? '').trim().toLowerCase() ===
              (g.delegation.split('·')[0] ?? '').trim().toLowerCase(),
        )?.states ?? null;
    // A delegation named in an agreement or disagreement line where it does not speak: cite added, or name
    // removed, by code (2026-11-19). Each repair is kept in the report and counted in Metrics.
    const repairs = repairNamedLines(report, m.segments, m.meeting.body);
    if (repairs.length) report.code_repairs = repairs;
  } catch (error) {
    if (error instanceof ReportOutputError) return rejectCall(ctx.db, call.id, 'output', error.message);
    throw error;
  }
  const check = checkReport(
    report,
    m.segments,
    `${m.meeting.title} ${m.meeting.date} ${m.meeting.date.replace(/-/g, ' ')}`,
    {
      body: m.meeting.body,
      decisionPoint,
    },
  );
  transaction(ctx.db, () => {
    const reportId = storeDocument(ctx.db, {
      ...docBase(ctx, call, reportPrompt as Prompt<never>, role),
      kind: 'report',
      body: report,
      text: renderReport(report, m.lowConfidenceLine, m.meeting.body),
    });
    storeDocument(ctx.db, {
      fileId: ctx.key.fileId,
      meetingId: ctx.key.meetingId,
      kind: 'check',
      ref: reportId,
      role: 'check',
      attempt: 1,
      body: { check: 'source', ...check },
      text: check.pass ? 'Source check passed.' : check.failures.map((f) => `${f.rule}: ${f.detail}`).join('\n'),
      promptId: 'check.source',
      promptVersion: '1.0.0',
      callId: null,
      result: {
        provider: 'internal',
        model: 'deterministic',
        usage: { inputTokens: null, outputTokens: null },
        durationMs: 0,
      },
    });
    if (!check.pass) rejectCall(ctx.db, call.id, 'check', `Source check failed (${check.failures.length})`);
  });
}

/** Failures of the previous report attempt, fed to the regeneration. */
function previousFailures(ctx: TaskContext): string[] {
  const last = ctx.db
    .prepare(
      // Every attempt of this epoch, newest first, so a regeneration does not reintroduce an earlier fault.
      `SELECT group_concat(c.text, char(10)) AS text FROM (
         SELECT c.text FROM documents c JOIN documents r ON c.ref IN (r.id, 'rejected:' || r.id)
         JOIN llm_calls k ON k.id = r.llm_call_id
         WHERE c.kind = 'check' AND r.file_id = ? AND r.meeting_id = ? AND r.kind = 'report' AND k.epoch = ?
         ORDER BY r.attempt DESC) c`,
    )
    .get(ctx.key.fileId, ctx.key.meetingId, ctx.key.epoch) as { text: string | null } | undefined;
  return last?.text
    ? [...new Set(last.text.split(/\n| \| /).filter((x) => x && x !== 'Source check passed.'))].slice(0, 24)
    : [];
}
