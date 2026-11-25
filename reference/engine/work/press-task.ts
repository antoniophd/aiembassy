// Press Counsellor · the press product, only when the decision asks for it or
// the triage marks the file high profile (on a point already taken, only the
// latter). A publishable text: no internal reasoning (check in language.ts).
import { checkCopy } from '../check/copy.ts';
import { cap } from '../check/decision.ts';
import { checkPress } from '../check/language.ts';
import { wordCount } from '../check/source.ts';
import { pressPrompt } from '../../prompts/press.product.ts';
import type { Prompt } from '../../prompts/types.ts';
import { rejectCall } from './calls.ts';
import { acceptedDocument, type DocumentRow } from './documents.ts';
import { feedback, meetingBrief, store } from './fullfile.ts';
import { send, type TaskContext } from './tasks.ts';

export async function runPress(
  ctx: TaskContext,
  product: 'statement' | 'explanation of vote' | 'press note',
): Promise<void> {
  const decision = acceptedDocument(ctx.db, ctx.key.fileId, ctx.key.meetingId, 'decision', 'A') as DocumentRow;
  const call = await send(
    ctx,
    'press',
    pressPrompt,
    { product, meeting: meetingBrief(ctx), decision: JSON.parse(decision.body_json), feedback: feedback(ctx, 'press') },
    2500,
  );
  if (!call.result) return;
  const raw = String((call.result.output as { text?: unknown })?.text ?? '').trim();
  if (!raw) return rejectCall(ctx.db, call.id, 'output', 'Press text missing');
  const copy = checkCopy(raw, [decision.text]);
  const failures = [
    ...(copy.pass ? [] : [`copy: ${Math.round(copy.ratio * 100)}% of sentences repeat the decision`]),
    ...(wordCount(raw) > cap('press') ? [`length: ${wordCount(raw)} words; hard cap ${cap('press')}`] : []),
    ...checkPress(raw, product),
  ];
  const text = `Draft ${product}. Not released: nothing leaves this site.\n\n${raw}`;
  store(ctx, call, pressPrompt as Prompt<never>, 'press', 'press', { product, text: raw }, text, { copy }, failures);
}
