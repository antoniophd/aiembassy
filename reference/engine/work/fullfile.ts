// Phase C tasks of a full file: claim checks (7), opinions, options memo, the
// two independent decisions, red-line checks (8) and the press product. Each
// makes one call; deterministic checks (3–6) run on the output before it is
// accepted.
import { checkCoherence } from '../check/coherence.ts';
import { transaction } from '../db/index.ts';
import { checkCopy } from '../check/copy.ts';
import {
  checkDecision,
  checkMemo,
  cap,
  decisionText,
  memoText,
  redLinesAdded,
  parseDecision,
  parseMemo,
  StructureError,
  type Decision,
  type Memo,
} from '../check/decision.ts';
import { checkStandsWith, checkVotedWith, groupsInMeeting, memoGroupsSpoke } from '../check/groups.ts';
import {
  checkDesk,
  checkLanguage,
  DRAFTS_NOT_READ,
  onceDraftsNotRead,
  OPINION_OVERLAP,
  outsideEngaged,
  overlap,
} from '../check/language.ts';
import { namedWithoutEntry } from '../check/record.ts';
import { checkTiming, type DecisionTiming } from '../check/timing.ts';
import { wordCount } from '../check/source.ts';
import { BODY_LABELS } from '../ingest/scope.ts';
import { markByLine } from './dossier-mark.ts';
import { checkerFor } from './second-check.ts';
import { claimPrompt } from '../../prompts/check.claim.ts';
import { redLinePrompt } from '../../prompts/check.redline.ts';
import { opinionPrompt } from '../../prompts/counsellor.opinion.ts';
import { memoPrompt } from '../../prompts/dpr.memo.ts';
import { decisionPrompt } from '../../prompts/pr.decision.ts';
import type { Prompt } from '../../prompts/types.ts';
import { allRejections, rejectCall } from './calls.ts';
import { loadMaterial } from './context.ts';
import { acceptedDocument, storeDocument, type DocumentRow } from './documents.ts';
import { reportEntries, type MeetingReport } from './report-doc.ts';
import { docBase, send, type TaskContext } from './tasks.ts';

export interface FileMaterial {
  report: DocumentRow;
  decisionPoint: string;
  timing: DecisionTiming | null;
  engaged: { interests: string[]; red_lines: string[] };
  opinions: { role: string; doc: DocumentRow }[];
  memo: DocumentRow | undefined;
  dossier: {
    title: string;
    standing_position: string | null;
    stands_with: string[] | null;
    last_decisions: string[];
  } | null;
}

export function fileMaterial(ctx: Pick<TaskContext, 'db'>, fileId: string, meetingId: string): FileMaterial {
  const db = ctx.db;
  const report = acceptedDocument(db, fileId, meetingId, 'report') as DocumentRow;
  const triage = acceptedDocument(db, fileId, meetingId, 'triage') as DocumentRow;
  const t = JSON.parse(triage.body_json) as {
    decisionPoint?: string;
    decisionStatus?: DecisionTiming | null;
    engaged: FileMaterial['engaged'];
  };
  const file = db.prepare('SELECT opinions_json, dossier_id FROM files WHERE id = ?').get(fileId) as {
    opinions_json: string | null;
    dossier_id: string | null;
  };
  const roles = JSON.parse(file.opinions_json ?? '[]') as string[];
  const opinions = roles
    .map((role) => ({ role, doc: acceptedDocument(db, fileId, meetingId, 'opinion', role) }))
    .filter((o): o is { role: string; doc: DocumentRow } => !!o.doc);
  const d = file.dossier_id
    ? (db.prepare('SELECT title, standing_position, stands_with FROM dossiers WHERE id = ?').get(file.dossier_id) as
        { title: string; standing_position: string | null; stands_with: string | null } | undefined)
    : undefined;
  const last = file.dossier_id
    ? (
        db
          .prepare(
            `SELECT position, stands_with, change FROM dossier_events WHERE dossier_id = ? AND file_id <> ?
             ORDER BY created_at DESC LIMIT 3`,
          )
          .all(file.dossier_id, fileId) as { position: string; stands_with: string; change: string }[]
      ).map((e) => `${e.position} (stands with ${JSON.parse(e.stands_with).join(', ')}; ${e.change})`)
    : [];
  return {
    report,
    decisionPoint: t.decisionPoint ?? '',
    timing: t.decisionStatus ?? null,
    engaged: t.engaged,
    opinions,
    memo: acceptedDocument(db, fileId, meetingId, 'options_memo'),
    dossier: d
      ? {
          title: d.title,
          standing_position: d.standing_position,
          stands_with: d.stands_with ? (JSON.parse(d.stands_with) as string[]) : null,
          last_decisions: last,
        }
      : null,
  };
}

export const meetingBrief = (ctx: TaskContext) => {
  const m = loadMaterial(ctx.db, ctx.key.meetingId).meeting;
  return { id: m.id, body: BODY_LABELS[m.body], title: m.title, date: m.date };
};

/** Failures of the previous rejected attempt of this task, fed to the regeneration. */
export function feedback(ctx: TaskContext, kind: string): string[] {
  if (ctx.decision.secondChance) return allRejections(ctx, kind);
  const row = ctx.db
    .prepare(
      `SELECT c.error FROM llm_calls c WHERE c.file_id = ? AND c.task = ? AND c.meeting_id = ? AND c.ref = ?
       AND c.error_kind IN ('check','output') ORDER BY c.rowid DESC LIMIT 1`,
    )
    .get(ctx.key.fileId, kind, ctx.key.meetingId, ctx.key.ref) as { error: string } | undefined;
  return row ? row.error.split(' | ').slice(0, 12) : [];
}

const checkerDoc = (ctx: TaskContext, call: { id: string; result: NonNullable<unknown> }, prompt: Prompt<never>) => ({
  ...docBase(ctx, call as never, prompt, 'check'),
  lowConfidence: null,
});

export async function runClaim(ctx: TaskContext): Promise<void> {
  const [, , index] = ctx.key.ref.split(':');
  const m = loadMaterial(ctx.db, ctx.key.meetingId);
  // The report only (a resumed part's report has no triage of its own: it is the root's).
  const reportRow = acceptedDocument(ctx.db, ctx.key.fileId, ctx.key.meetingId, 'report') as DocumentRow;
  const report = JSON.parse(reportRow.body_json) as { claims: { claim: string; cite: string }[] };
  const checker = checkerFor(ctx.db, reportRow as never); // fallback report: second checker (2026-11-23)
  const claim = report.claims[Number(index)];
  const seg = m.segments.find((s) => s.label === claim?.cite);
  if (!claim || !seg) throw Error('Claim or segment missing for ' + ctx.key.ref);
  const call = await send(
    ctx,
    'check',
    claimPrompt,
    {
      claim: claim.claim,
      segment: { label: seg.label, speakers: [...new Set(seg.speakers.map((x) => x.label))], text: seg.text },
    },
    checker.maxTokens,
    false,
    checker.use,
  );
  if (!call.result) return;
  const verdict = (call.result.output as { verdict?: string })?.verdict;
  if (!['supported', 'not_supported', 'contradicted'].includes(String(verdict)))
    return rejectCall(ctx.db, call.id, 'output', 'Invalid verdict');
  transaction(ctx.db, () =>
    storeDocument(ctx.db, {
      ...checkerDoc(ctx, call as never, claimPrompt as Prompt<never>),
      kind: 'check',
      body: {
        check: 'claim',
        claim: claim.claim,
        cite: claim.cite,
        ...(call.result!.output as object),
        second_checker: checker.second,
      },
      text: `${verdict}: ${claim.claim} [${claim.cite}]`,
    }),
  );
}

export async function runOpinion(ctx: TaskContext): Promise<void> {
  const f = fileMaterial(ctx, ctx.key.fileId, ctx.key.meetingId);
  const role = ctx.team.roles.find((r) => r.id === ctx.key.ref);
  if (!role) throw Error('Unknown role ' + ctx.key.ref);
  const call = await send(
    ctx,
    role.id,
    opinionPrompt,
    {
      profile: ctx.profile,
      role,
      meeting: meetingBrief(ctx),
      decisionPoint: f.decisionPoint,
      timing: f.timing,
      engaged: f.engaged,
      others: f.opinions.filter((o) => o.role !== role.id).map((o) => o.role),
      report: f.report.text,
      dossier: f.dossier,
      feedback: feedback(ctx, 'opinion'),
    },
    3000,
  );
  if (!call.result) return;
  const out = call.result.output as { opinion?: unknown; red_lines?: unknown };
  // The legal opinion's first line is added by code; a model that writes it too does not get it twice.
  const raw = String(out?.opinion ?? '').trim();
  if (!raw) return rejectCall(ctx.db, call.id, 'output', 'Opinion missing');
  const copy = checkCopy(raw, [f.report.text, ...f.opinions.map((o) => o.doc.text)]);
  const failures = [
    ...(copy.pass ? [] : [`copy: ${Math.round(copy.ratio * 100)}% of sentences repeat earlier documents`]),
    ...(wordCount(raw) > cap('opinion') ? [`length: ${wordCount(raw)} words; hard cap ${cap('opinion')}`] : []),
    ...checkLanguage(raw, 'the opinion'),
    ...outsideEngaged(out?.red_lines, f.engaged, 'the opinion'),
    ...checkDesk(raw, role.id),
    ...f.opinions
      .filter((o) => o.role !== role.id && overlap(raw, o.doc.text) > OPINION_OVERLAP)
      .map(
        (o) =>
          `overlap: ${Math.round(overlap(raw, o.doc.text) * 100)} % of this opinion's distinctive words repeat the ${o.role} opinion (limit ${OPINION_OVERLAP * 100} %); give only what your desk adds`,
      ),
  ];
  // While the drafts are not read, the legal opinion says so in its first line.
  const text = role.id === 'legal' ? onceDraftsNotRead(`${DRAFTS_NOT_READ}\n\n${raw}`) : raw;
  store(ctx, call, opinionPrompt as Prompt<never>, role.id, 'opinion', call.result.output, text, { copy }, failures);
}

export async function runMemo(ctx: TaskContext): Promise<void> {
  const f = fileMaterial(ctx, ctx.key.fileId, ctx.key.meetingId);
  const spoke = groupsInMeeting(loadMaterial(ctx.db, ctx.key.meetingId).segments, ctx.profile).map((g) => g.group);
  const call = await send(
    ctx,
    'dpr',
    memoPrompt,
    {
      profile: ctx.profile,
      meeting: meetingBrief(ctx),
      decisionPoint: f.decisionPoint,
      timing: f.timing,
      groupsThatSpoke: spoke,
      engaged: f.engaged,
      report: f.report.text,
      opinions: f.opinions.map((o) => ({ role: o.role, text: o.doc.text })),
      dossier: f.dossier,
      feedback: feedback(ctx, 'memo'),
    },
    10000,
    true,
  );
  if (!call.result) return;
  let memo: Memo;
  try {
    memo = parseMemo(call.result.output);
  } catch (e) {
    if (e instanceof StructureError) return rejectCall(ctx.db, call.id, 'output', e.message);
    throw e;
  }
  const text = memoText(memo);
  const copy = checkCopy(text, [f.report.text, ...f.opinions.map((o) => o.doc.text)]);
  const failures = [
    ...(copy.pass ? [] : [`copy: ${Math.round(copy.ratio * 100)}% of sentences repeat earlier documents`]),
    ...checkMemo(memo, wordCount(text), ctx.profile),
    ...checkTiming(
      f.timing,
      'memo',
      memo.options.map((o) => ({ label: 'option ' + o.id, text: o.action })),
      memo.would_have_voted,
    ),
    ...checkLanguage(text, 'the memo'),
    ...memoGroupsSpoke(memo, spoke),
  ];
  store(ctx, call, memoPrompt as Prompt<never>, 'dpr', 'options_memo', memo, text, { copy }, failures);
}

export async function runDecision(ctx: TaskContext): Promise<void> {
  const f = fileMaterial(ctx, ctx.key.fileId, ctx.key.meetingId);
  if (!f.memo) throw Error('Memo missing');
  const memo = JSON.parse(f.memo.body_json) as Memo;
  const material = loadMaterial(ctx.db, ctx.key.meetingId);
  const groups = groupsInMeeting(material.segments, ctx.profile);
  const call = await send(
    ctx,
    'pr',
    decisionPrompt,
    {
      profile: ctx.profile,
      meeting: meetingBrief(ctx),
      decisionPoint: f.decisionPoint,
      timing: f.timing,
      engaged: f.engaged,
      report: f.report.text,
      opinions: f.opinions.map((o) => ({ role: o.role, text: o.doc.text })),
      memo,
      // Every segment where a group spoke; excerpts of the first four only, to keep the prompt short.
      groups: groups.map((g) => ({
        ...g,
        segments: g.segments.map((s, i) => (i < 4 ? s : { label: s.label, speaker: s.speaker, excerpt: '' })),
      })),
      dossier: f.dossier,
      feedback: feedback(ctx, 'decision'),
    },
    // 24,000 tokens: the JSON is about 2,000, the rest reasoning (2026-11-16). The writer reasons normally, the
    // fallback with effort "low" (2026-11-19).
    24000,
    ctx.decision.fallback ? 'low' : true,
  );
  if (!call.result) return;
  let d: Decision;
  try {
    d = markByLine(ctx, parseDecision(call.result.output), f.dossier);
  } catch (e) {
    if (e instanceof StructureError) return rejectCall(ctx.db, call.id, 'output', e.message);
    throw e;
  }
  const text = decisionText(d, ctx.profile);
  const copy = checkCopy(text, [f.report.text, ...f.opinions.map((o) => o.doc.text), f.memo.text]);
  const reportBody = JSON.parse(f.report.body_json) as MeetingReport;
  const report = {
    positions: reportEntries({
      ...reportBody,
      briefers: reportBody.briefers ?? [],
      introductions: reportBody.introductions ?? [],
      group_statements: reportBody.group_statements ?? [],
      positions: reportBody.positions ?? [],
    }),
  };
  const prose = [d.position, d.why, ...d.rejected.map((r) => r.why), d.stands_with_reason, d.differs_on?.text ?? '']
    .concat(
      d.group_positions.map((g) => g.position),
      [d.would_have_voted ?? '', d.reopens_if],
    )
    .join('\n');
  const failures = [
    ...(copy.pass ? [] : [`copy: ${Math.round(copy.ratio * 100)}% of sentences repeat earlier documents`]),
    ...checkDecision(d, wordCount(text), memo, ctx.profile, f.dossier),
    ...checkStandsWith(d, groups, material.segments),
    ...checkCoherence(d, { body: material.meeting.body, segments: material.segments }),
    ...checkVotedWith(d, report.positions ?? [], material.segments),
    ...checkTiming(f.timing, 'decision', [{ label: 'the position', text: d.position }], d.would_have_voted),
    ...checkLanguage(prose, 'the decision'),
    ...namedWithoutEntry(prose, material.segments, report.positions, material.meeting.body).map(
      (n) => `report: the decision names ${n}, which has no entry in the meeting report`,
    ),
  ];
  // A red line the triage did not mark may be named by the decision that applies it (2026-11-19): it is
  // kept, recorded as added by the decision (shown in Metrics only) and checked like every red line (step 8).
  const body = { ...d, red_lines_added: redLinesAdded(d.red_lines, f.engaged, ctx.profile) };
  store(ctx, call, decisionPrompt as Prompt<never>, 'pr', 'decision', body, text, { copy }, failures);
}

export async function runRedLine(ctx: TaskContext): Promise<void> {
  const [, decisionId, redLineId] = ctx.key.ref.split(':');
  const decision = ctx.db
    .prepare('SELECT body_json, llm_call_id FROM documents WHERE id = ?')
    .get(decisionId as string) as {
    body_json: string;
    llm_call_id: string;
  };
  const red = ctx.profile.red_lines.find((r) => r.id === redLineId);
  if (!red || !decision) throw Error('Red line or decision missing for ' + ctx.key.ref);
  const checker = checkerFor(ctx.db, decision); // fallback decision: second checker (2026-11-23)
  const call = await send(
    ctx,
    'check',
    redLinePrompt,
    { red_line: red, decision: JSON.parse(decision.body_json) },
    checker.maxTokens,
    false,
    checker.use,
  );
  if (!call.result) return;
  const crosses = (call.result.output as { crosses?: unknown })?.crosses;
  if (typeof crosses !== 'boolean') return rejectCall(ctx.db, call.id, 'output', 'Invalid answer');
  transaction(ctx.db, () =>
    storeDocument(ctx.db, {
      ...checkerDoc(ctx, call as never, redLinePrompt as Prompt<never>),
      kind: 'check',
      body: { check: 'red_line', red_line: red.id, ...(call.result!.output as object), second_checker: checker.second },
      text: `${red.id} ${crosses ? 'CROSSED' : 'not crossed'}: ${String((call.result!.output as { reason?: unknown }).reason ?? '')}`,
    }),
  );
}

export function store(
  ctx: TaskContext,
  call: { id: string; result: unknown },
  prompt: Prompt<never>,
  role: string,
  kind: 'opinion' | 'options_memo' | 'decision' | 'press',
  body: unknown,
  text: string,
  extra: Record<string, unknown>,
  failures: string[],
): void {
  transaction(ctx.db, () => {
    storeDocument(ctx.db, {
      ...docBase(ctx, call as never, prompt, role),
      kind,
      body: { ...(body as object), _checks: { ...extra, failures } },
      text,
    });
    if (failures.length) rejectCall(ctx.db, call.id, 'check', failures.join(' | '));
  });
}
