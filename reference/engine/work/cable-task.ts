// The cable task (2026-11-13): one call by the lead counsellor, from
// the accepted report and, on full files, opinions, memo and decision. The
// transcript is not read again (its speaker labels are used only to check
// names). If the cable fails twice the file goes on without it, noted.
import { transaction } from '../db/index.ts';
import { checkCable, parseCable, renderCable, repairCableNames, CableError } from '../check/cable.ts';
import { PAST_ACTION, type DecisionTiming } from '../check/timing.ts';
import type { SegmentLike } from '../check/groups.ts';
import { BODY_LABELS } from '../ingest/scope.ts';
import { cablePrompt } from '../../prompts/counsellor.cable.ts';
import type { Prompt } from '../../prompts/types.ts';
import { rejectCall } from './calls.ts';
import { loadMaterial } from './context.ts';
import { acceptedDocument, storeDocument, type DocumentRow } from './documents.ts';
import { reportEntries, type MeetingReport } from './report-doc.ts';
import { counsellorRole, docBase, send, type TaskContext } from './tasks.ts';
import type { Db } from '../db/index.ts';

/** Rejections after which the file goes on without a cable (one regeneration). */
export const CABLE_TRIES = 2;

export const cableRejections = (db: Db, fileId: string, meetingId: string, epoch: number): number =>
  (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM llm_calls WHERE file_id = ? AND meeting_id = ? AND task = 'cable' AND epoch = ?
         AND error_kind IN ('check','output')`,
      )
      .get(fileId, meetingId, epoch) as { n: number }
  ).n;

/**
 * What the next cable attempt is told (2026-11-23): the rejections of every earlier cable attempt of the
 * file, in all rounds (a reopened cable no longer starts blind), newest first, each reason once, at most 12.
 */
export function cableFeedback(db: Db, fileId: string, meetingId: string): string[] {
  const rows = db
    .prepare(
      `SELECT error FROM llm_calls WHERE file_id = ? AND task = 'cable' AND meeting_id = ?
       AND error_kind IN ('check','output') AND error IS NOT NULL ORDER BY rowid DESC`,
    )
    .all(fileId, meetingId) as { error: string }[];
  return [
    ...new Set(
      rows
        .flatMap((r) => r.error.split(' | '))
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].slice(0, 12);
}

/** A stored report with every section present (older reports lack some). */
export const withSections = (r: Partial<MeetingReport>): MeetingReport =>
  ({
    ...r,
    briefers: r.briefers ?? [],
    introductions: r.introductions ?? [],
    group_statements: r.group_statements ?? [],
    positions: r.positions ?? [],
    agreement: r.agreement ?? [],
    disagreement: r.disagreement ?? [],
    votes: r.votes ?? [],
  }) as MeetingReport;

interface TriageBody {
  level?: string;
  cable?: boolean;
  engaged?: { interests?: string[] };
}

/** A sentence that says a text was adopted or voted (past, not planned): "L.5 was adopted by recorded vote". */
const ADOPTED_TEXT =
  /\b(adopted|approved|voted|recorded vote|without a vote|by consensus|unanimously|rejected|vetoed)\b/i;
/** No text acted on, or only planned: "no draft was put to the vote", "will vote next week". */
const NOT_ACTED =
  /\bno (draft|text|resolution|decision|vote|action|product)\b|\bnot (adopted|voted|put to (a|the) vote|acted on)\b|\bwithout (taking )?action\b|\bdid not (adopt|vote|take action)\b|\b(will|would|shall)\b|\b(next|upcoming|ahead of|scheduled|expected|pending|deferred|postponed)\b/i;
/** Procedure, not a text of substance: the agenda, the programme of work, a report taken note of. */
const PROCEDURAL = /\b(agenda|programme of work|organization of work|provisional programme|minutes)\b/i;

/**
 * Whether the record shows a text voted or adopted (2026-11-19): read by code in the report's outcome
 * (and the decision outcome of the key points) AND in the transcript, where a line records the action. The
 * "votes" field is not used: the report fills it only for recorded tallies (8 of 59 on 2026-11-19).
 */
export function recordsAdoption(
  report: Partial<Pick<MeetingReport, 'outcome' | 'decision_outcome'>>,
  segments: SegmentLike[],
): boolean {
  // Each mention of an adoption is read in its own clause (a few words around it), so "the committee adopted
  // L.4 without a vote and then deferred two items" counts and "no text was adopted" or "the agenda was adopted" does not.
  const said = [report.outcome?.text, report.decision_outcome?.text]
    .filter((t): t is string => !!t)
    .flatMap((t) => t.split(/(?<=[.;])\s+/))
    .some((s) =>
      [...s.matchAll(new RegExp(ADOPTED_TEXT.source, 'gi'))].some((m) => {
        const clause = s.slice(Math.max(0, m.index - 45), m.index + m[0].length + 20);
        return !NOT_ACTED.test(clause) && !PROCEDURAL.test(clause);
      }),
    );
  if (!said) return false;
  return segments.some((seg) =>
    seg.text
      .split('\n')
      .map((l) => l.replace(/^\[\d+s\]\s*/, ''))
      .some((l) => PAST_ACTION.test(l) && !PROCEDURAL.test(l)),
  );
}

/**
 * The cable of a report (2026-11-16, detection 2026-11-19): the DPR marked it, the triage names a
 * concrete interest of the State, AND a text was voted or adopted, read by code in the report's outcome and in
 * the segments (recordsAdoption). A division alone ("disagreement" lines) is not enough. No model call.
 */
export function reportWantsCable(
  triage: TriageBody,
  report: Partial<MeetingReport> | null,
  segments: SegmentLike[],
): boolean {
  if (triage.level !== 'report' || triage.cable !== true || !triage.engaged?.interests?.length || !report) return false;
  return recordsAdoption(report, segments);
}

/**
 * Whether the file gets a cable: always on full files; on every Security Council report (2026-11-23:
 * whether or not a text was voted; notes, the procedural meetings, never); on other reports by the rule above.
 */
export function wantsCable(db: Db, fileId: string, meetingId: string): boolean {
  const t = acceptedDocument(db, fileId, meetingId, 'triage');
  if (!t) return false;
  const b = JSON.parse(t.body_json) as TriageBody;
  if (b.level === 'full_file') return true;
  const r = acceptedDocument(db, fileId, meetingId, 'report');
  if (!r) return false;
  if (b.level === 'report' && loadMaterial(db, meetingId).meeting.body === 'security_council') return true;
  return reportWantsCable(b, JSON.parse(r.body_json) as Partial<MeetingReport>, loadMaterial(db, meetingId).segments);
}

export async function runCable(ctx: TaskContext): Promise<void> {
  const { db, key } = ctx;
  const m = loadMaterial(db, key.meetingId);
  const accepted = (kind: Parameters<typeof acceptedDocument>[3], ref = '') =>
    acceptedDocument(db, key.fileId, key.meetingId, kind, ref);
  const report = accepted('report') as DocumentRow;
  const decision = accepted('decision', 'A');
  const triage = accepted('triage');
  const t = triage ? (JSON.parse(triage.body_json) as { decisionStatus?: DecisionTiming | null }) : {};
  const roles = JSON.parse(ctx.workFile.opinions_json ?? '[]') as string[];
  const d = decision ? (JSON.parse(decision.body_json) as { option: string; stands_with: string[] }) : null;
  const feedback = cableFeedback(db, key.fileId, key.meetingId);
  const role = counsellorRole(ctx.workFile);
  const call = await send(
    ctx,
    role,
    cablePrompt,
    {
      meeting: { id: m.meeting.id, body: BODY_LABELS[m.meeting.body], title: m.meeting.title, date: m.meeting.date },
      report: report.text,
      file: decision
        ? {
            opinions: roles
              .map((r) => ({ role: r, doc: accepted('opinion', r) }))
              .filter((o) => o.doc)
              .map((o) => ({ role: o.role, text: o.doc!.text })),
            memo: accepted('options_memo')?.text ?? '',
            decision: JSON.parse(decision.body_json),
            next_step: t.decisionStatus?.next_step ?? null,
          }
        : null,
      feedback: feedback ?? [],
    },
    6000,
  );
  if (!call.result) return;
  let cable;
  try {
    cable = parseCable(call.result.output);
  } catch (e) {
    if (e instanceof CableError) return rejectCall(db, call.id, 'output', e.message);
    throw e;
  }
  const entries = reportEntries(withSections(JSON.parse(report.body_json) as Partial<MeetingReport>));
  // Delegations without an entry of their own are removed by code before the check (2026-11-19).
  const repairs = repairCableNames(cable, m.segments, entries, m.meeting.body);
  const failures = checkCable(cable, {
    reportText: report.text,
    metadata: `${m.meeting.title} ${m.meeting.date}`,
    segments: m.segments,
    decision: d,
    entries,
    body: m.meeting.body,
  });
  transaction(db, () => {
    storeDocument(db, {
      ...docBase(ctx, call, cablePrompt as Prompt<never>, role),
      kind: 'cable',
      body: { ...cable, ...(repairs.length ? { code_repairs: repairs } : {}), _checks: { failures } },
      text: renderCable(cable, m.meeting.date),
    });
    if (failures.length) rejectCall(db, call.id, 'check', failures.join(' | '));
  });
}
