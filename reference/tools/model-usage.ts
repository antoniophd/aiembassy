// Read-only: calls per model and why each fallback call happened.
//   node tools/model-usage.ts <database file> [...]
import { openReadOnly } from '../engine/db/index.ts';

const reasonOf = (kind: string | null, error: string | null): string => {
  const e = (error ?? '').toLowerCase();
  if (kind === 'check') return 'previous attempt failed the source check';
  if (kind === 'output')
    return e.includes('incomplete')
      ? 'previous attempt: invalid/incomplete JSON'
      : 'previous attempt: unusable output (' + (error ?? '') + ')';
  if (e.includes('timed out') || e.includes('unreachable')) return 'provider: timeout/unreachable';
  if (e.includes('quota') || e.includes('rate limit')) return 'provider: quota/rate limit';
  if (e.includes('temporarily unavailable') || e.includes('service failed')) return 'provider: 5xx';
  if (e.includes('unavailable or retired') || e.includes('denied access')) return 'provider: model unavailable';
  if (kind === 'provider') return 'provider: ' + (error ?? '');
  return 'claimed, never finished';
};

for (const path of process.argv.slice(2)) {
  const db = openReadOnly(path);
  console.log('\n## ' + path);
  console.table(
    db
      .prepare(
        `SELECT model_requested AS model, task, state, COALESCE(error_kind,'') AS error_kind, COUNT(*) AS calls
         FROM llm_calls GROUP BY model_requested, task, state, error_kind ORDER BY model_requested, task`,
      )
      .all(),
  );
  const fallbacks = db
    .prepare(
      `SELECT f.id, f.task, f.attempt, f.state, f.error_kind AS own_error,
         (SELECT p.error_kind FROM llm_calls p WHERE p.file_id = f.file_id AND p.task = f.task AND p.meeting_id = f.meeting_id
            AND p.ref = f.ref AND p.rowid < f.rowid ORDER BY p.rowid DESC LIMIT 1) AS prev_kind,
         (SELECT p.error FROM llm_calls p WHERE p.file_id = f.file_id AND p.task = f.task AND p.meeting_id = f.meeting_id
            AND p.ref = f.ref AND p.rowid < f.rowid ORDER BY p.rowid DESC LIMIT 1) AS prev_error
       FROM llm_calls f WHERE f.fallback = 1`,
    )
    .all() as Record<string, string | null>[];
  const why: Record<string, number> = {};
  for (const f of fallbacks) {
    const k = `${f.task} · ${reasonOf(f.prev_kind ?? null, f.prev_error ?? null)} → fallback ${f.state}${f.own_error ? ' (' + f.own_error + ')' : ''}`;
    why[k] = (why[k] ?? 0) + 1;
  }
  console.log('Fallback calls by reason:', why);
  db.close();
}
