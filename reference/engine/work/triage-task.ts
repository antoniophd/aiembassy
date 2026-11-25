// DPR · triage task: one call, deterministic rules, then the file moves to
// `triaged` in the same transaction that stores the triage document.
import { randomUUID } from 'node:crypto';
import { nowIso, transaction } from '../db/index.ts';
import { triagePrompt } from '../../prompts/dpr.triage.ts';
import type { Prompt } from '../../prompts/types.ts';
import { allRejections, rejectCall } from './calls.ts';
import { loadMaterial, speakerList, type MeetingMaterial } from './context.ts';
import { storeDocument } from './documents.ts';
import { actionMarkers } from '../check/timing.ts';
import { docBase, meetingFacts, send, type TaskContext } from './tasks.ts';
import { rewindFrom } from './reopen.ts';
import { applyTriageRules, TriageOutputError, type Triage } from './triage-rules.ts';

interface Candidate {
  id: string;
  title: string;
  date: string;
  reason: string;
}

/** Earlier parts of the same meeting, and meetings with an identical transcript. */
export function duplicateCandidates(
  ctx: TaskContext,
  m: MeetingMaterial,
): { list: Candidate[]; identical: string | null } {
  const x = m.meeting;
  const parts = ctx.db
    .prepare(
      `SELECT m.id, m.title, m.date FROM meetings m JOIN files f ON f.meeting_id = m.id
       WHERE m.body = ? AND m.number = ? AND m.session IS ? AND m.part < ? ORDER BY m.part`,
    )
    .all(x.body, x.number, x.session, x.part) as { id: string; title: string; date: string }[];
  const same = ctx.db
    .prepare(
      `SELECT m.id, m.title, m.date FROM transcripts t JOIN meetings m ON m.id = t.meeting_id
       WHERE t.sha256 = ? AND t.meeting_id <> ? AND (m.date < ? OR (m.date = ? AND m.id < ?))`,
    )
    .all(m.transcript.sha256, x.id, x.date, x.date, x.id) as { id: string; title: string; date: string }[];
  return {
    list: [
      ...parts.map((p) => ({ ...p, reason: 'earlier part of the same meeting number' })),
      ...same.map((p) => ({ ...p, reason: 'identical transcript' })),
    ],
    identical: same[0]?.id ?? null,
  };
}

/** Follows duplicate_of links to the first part. */
export function rootMeeting(ctx: Pick<TaskContext, 'db'>, meetingId: string): string {
  let id = meetingId;
  for (let i = 0; i < 10; i++) {
    const next = ctx.db.prepare('SELECT duplicate_of FROM files WHERE meeting_id = ?').get(id) as
      { duplicate_of: string | null } | undefined;
    if (!next?.duplicate_of) return id;
    id = next.duplicate_of;
  }
  return id;
}

/** The opening of the transcript with segment labels, so the triage can cite them. */
const labelledOpening = (m: MeetingMaterial, chars = 8000): string =>
  m.segments
    .map((s) => `[${s.label}]\n${s.text}`)
    .join('\n')
    .slice(0, chars);

const slug = (t: string): string =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

export async function runTriage(ctx: TaskContext): Promise<void> {
  const m = loadMaterial(ctx.db, ctx.key.meetingId);
  const dossiers = ctx.db.prepare('SELECT id, title FROM dossiers ORDER BY title').all() as {
    id: string;
    title: string;
  }[];
  const candidates = duplicateCandidates(ctx, m);
  const last = ctx.db
    .prepare(
      `SELECT error FROM llm_calls WHERE file_id = ? AND task = 'triage' AND epoch = ? AND error_kind = 'output'
       ORDER BY rowid DESC LIMIT 1`,
    )
    .get(ctx.key.fileId, ctx.key.epoch) as { error: string } | undefined;
  const call = await send(
    ctx,
    'dpr',
    triagePrompt,
    {
      profile: ctx.profile,
      meeting: meetingFacts(m),
      length: { characters: m.transcript.characters, segments: m.segments.length, lowConfidence: m.lowConfidenceLine },
      speakers: speakerList(m.speakers),
      opening: labelledOpening(m),
      actionMarkers: actionMarkers(m.segments),
      dossiers,
      duplicateCandidates: candidates.list,
      feedback: ctx.decision.secondChance
        ? allRejections(ctx, 'triage', 12)
        : last
          ? last.error.split(' | ').slice(0, 8)
          : [],
    },
    12000, // reasoning on: 6,000 cut 6 of 177 triage calls on 2026-11-13 (longest accepted 5,926)
    true,
  );
  if (!call.result) return;
  let triage: Triage;
  try {
    triage = applyTriageRules(
      call.result.output,
      {
        body: m.meeting.body,
        durationSeconds: m.meeting.duration_seconds,
        speakers: new Set(m.speakers.map((x) => x.label)).size,
        dossierIds: dossiers.map((d) => d.id),
        duplicateCandidates: candidates.list.map((c) => c.id),
        identicalTranscriptOf: candidates.identical,
        segments: m.segments,
      },
      ctx.profile,
      ctx.team,
    );
  } catch (error) {
    if (error instanceof TriageOutputError) return rejectCall(ctx.db, call.id, 'output', error.message);
    throw error;
  }
  // Resumed parts always point at the first part of the session (the root).
  if (triage.duplicateOf) {
    const root = rootMeeting(ctx, triage.duplicateOf);
    if (root !== triage.duplicateOf) {
      triage.adjustments.push(`duplicate_of ${triage.duplicateOf} -> ${root}: first part of the session`);
      triage.duplicateOf = root;
    }
  }
  const at = nowIso();
  transaction(ctx.db, () => {
    storeDocument(ctx.db, {
      ...docBase(ctx, call, triagePrompt as Prompt<never>, 'dpr'),
      kind: 'triage',
      body: triage,
      text: [
        ...(m.lowConfidenceLine ? [m.lowConfidenceLine] : []),
        `Level: ${triage.level}. Lead: ${triage.lead}. ${triage.reason}`,
        ...(triage.decisionStatus
          ? [
              triage.decisionStatus.status === 'already_taken'
                ? `Decision point already taken [${triage.decisionStatus.cite}]. Next step: ${triage.decisionStatus.next_step?.replace(/\.$/, '')}.`
                : triage.decisionStatus.status === 'not_recorded'
                  ? 'Decision point: its adoption or vote is not recorded in this transcript; treated as pending.'
                  : `Decision point pending [${triage.decisionStatus.cite}].`,
            ]
          : []),
        ...(triage.duplicateOf ? [`Same session as ${triage.duplicateOf}.`] : []),
      ].join('\n'),
    });
    let dossierId = triage.dossier.id;
    if (!dossierId && triage.dossier.newTitle) {
      dossierId = 'dossier:' + (slug(triage.dossier.newTitle) || randomUUID());
      ctx.db
        .prepare(
          `INSERT INTO dossiers (id, title, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
        )
        .run(dossierId, triage.dossier.newTitle, at, at);
    }
    // A meeting that joins a dossier holding decisions of later meetings: those decide again, in order.
    if (dossierId && triage.level === 'full_file') rewindFrom(ctx.db, dossierId, m.meeting.id, null);
    ctx.db
      .prepare(
        `UPDATE files SET status = 'triaged', level = ?, lead = ?, opinions_json = ?, press = ?, press_reason = ?,
           dossier_id = ?, duplicate_of = ?, low_confidence = MAX(low_confidence, ?),
           low_confidence_reason = CASE WHEN ? IS NULL THEN low_confidence_reason
             WHEN low_confidence_reason IS NULL THEN ? ELSE ? || ' ' || low_confidence_reason END,
           profile_version = ?, team_version = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        triage.level,
        triage.lead,
        JSON.stringify(triage.opinions),
        triage.press ? 1 : 0,
        triage.pressReason || null,
        dossierId,
        triage.duplicateOf,
        m.lowConfidenceLine ? 1 : 0,
        m.lowConfidenceLine,
        m.lowConfidenceLine,
        m.lowConfidenceLine,
        ctx.profile.version,
        ctx.team.version,
        at,
        ctx.owner.id,
      );
    // A resumed part with a short transcript lowers the confidence of the first part's file.
    if (triage.duplicateOf && m.lowConfidenceLine)
      ctx.db
        .prepare(
          `UPDATE files SET low_confidence = 1, low_confidence_reason = COALESCE(low_confidence_reason, ?)
           WHERE meeting_id = ?`,
        )
        .run(`Resumed part ${m.meeting.id}: ${m.lowConfidenceLine}`, triage.duplicateOf);
  });
}
