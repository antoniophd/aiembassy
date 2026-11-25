// Press Counsellor · press pack (2026-11-25): stakeout remarks, a press release and a social media post,
// in one document (kind "press", ref "pack"), when the decision asks for a public line. Checked by code
// (press-pack.ts). Two tries, like the cable: a pack that fails twice is left out and the file is adopted without
// it, with no notice on the page.
import type { Db } from '../db/index.ts';
import {
  checkPressPack,
  parsePressPack,
  PressPackOutputError,
  renderPressPack,
  type PressPack,
} from '../check/press-pack.ts';
import type { Decision } from '../check/decision.ts';
import { BODY_LABELS, meetingPossessive, meetingRef, organName } from '../ingest/scope.ts';
import { adoptionsOf, repairReleaseReference } from '../check/press-pack-form.ts';
import { pressPackPrompt } from '../../prompts/press.pack.ts';
import type { Prompt } from '../../prompts/types.ts';
import { rejectCall } from './calls.ts';
import { loadMaterial } from './context.ts';
import { acceptedDocument, type DocKind, type DocumentRow } from './documents.ts';
import { feedback, meetingBrief, store } from './fullfile.ts';
import { send, type TaskContext } from './tasks.ts';

export const PACK_REF = 'pack';
export const PACK_TRIES = 2;
export const NO_PACK_NOTE = 'No press pack: it failed its checks twice.';

export const packRejections = (db: Db, fileId: string, meetingId: string, epoch: number): number =>
  (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM llm_calls WHERE file_id = ? AND meeting_id = ? AND task = 'press' AND ref = ?
         AND epoch = ? AND error_kind IN ('check','output')`,
      )
      .get(fileId, meetingId, PACK_REF, epoch) as { n: number }
  ).n;

const LOW = /^Low confidence:[^\n]*\n+/;

/** The accepted documents the pack may draw names, figures and symbols from. */
export function packSources(db: Db, fileId: string, meetingId: string): DocumentRow[] {
  const f = db.prepare('SELECT opinions_json FROM files WHERE id = ?').get(fileId) as { opinions_json: string | null };
  const roles = JSON.parse(f.opinions_json ?? '[]') as string[];
  const kinds: [DocKind, string][] = [
    ['triage', ''],
    ['report', ''],
    ...roles.map((r) => ['opinion', r] as [DocKind, string]),
    ['options_memo', ''],
    ['decision', 'A'],
    ['press', ''],
  ];
  return kinds.map(([k, r]) => acceptedDocument(db, fileId, meetingId, k, r)).filter((d): d is DocumentRow => !!d);
}

export async function runPressPack(ctx: TaskContext): Promise<void> {
  const decision = acceptedDocument(ctx.db, ctx.key.fileId, ctx.key.meetingId, 'decision', 'A') as DocumentRow;
  const report = acceptedDocument(ctx.db, ctx.key.fileId, ctx.key.meetingId, 'report');
  const m = loadMaterial(ctx.db, ctx.key.meetingId).meeting;
  const d = JSON.parse(decision.body_json) as Decision;
  const votes = report
    ? ((JSON.parse(report.body_json) as { votes?: { draft: string; result: string; in_favour: number | null }[] })
        .votes ?? [])
    : [];
  const adoption = adoptionsOf(votes);
  const call = await send(
    ctx,
    'press',
    pressPackPrompt,
    {
      meeting: {
        ...meetingBrief(ctx),
        name: meetingRef(m.title, m.body) ?? BODY_LABELS[m.body],
        reference: meetingPossessive(m.title, m.body) ?? `the ${BODY_LABELS[m.body]}`,
        organ: organName(m.body),
      },
      adoption,
      decision: {
        option: d.option,
        vote: d.vote,
        would_have_voted: d.would_have_voted,
        takes_floor: d.takes_floor,
        position: d.position,
        stands_with: d.stands_with,
        press: d.press,
      },
      facts: report ? report.text.replace(LOW, '') : '',
      feedback: feedback(ctx, 'press'),
    },
    4000,
  );
  if (!call.result) return;
  let pack: PressPack;
  try {
    pack = parsePressPack(call.result.output);
  } catch (error) {
    if (error instanceof PressPackOutputError) return rejectCall(ctx.db, call.id, 'output', error.message);
    throw error;
  }
  // The release names the body without the meeting number; the reference given for the remarks is repaired.
  const repairs = repairReleaseReference(pack, meetingPossessive(m.title, m.body) ?? '', organName(m.body));
  const sources = [
    ...packSources(ctx.db, ctx.key.fileId, ctx.key.meetingId).map((x) => x.text),
    m.title,
    BODY_LABELS[m.body],
  ];
  const failures = checkPressPack(pack, {
    decision: d,
    sources,
    meetingDate: m.date,
    groups: ctx.profile.alignment.known_groups,
    body: m.body,
    adoption,
    organ: organName(m.body),
  });
  store(
    ctx,
    call,
    pressPackPrompt as Prompt<never>,
    'press',
    'press',
    { pack, ...(repairs.length ? { code_repairs: repairs } : {}) },
    renderPressPack(pack),
    {},
    failures,
  );
}
