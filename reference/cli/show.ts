// Read-only: prints one meeting file with its documents and checks.
//   node cli/show.ts <meeting id>        e.g. sc/880
import { databasePath, openReadOnly } from '../engine/db/index.ts';

const meetingId = process.argv[2];
if (!meetingId) throw Error('Usage: node cli/show.ts <meeting id>');
const db = openReadOnly(databasePath());
const file = db.prepare('SELECT * FROM files WHERE meeting_id = ?').get(meetingId) as
  Record<string, unknown> | undefined;
if (!file) throw Error('No file for ' + meetingId);
console.log(JSON.stringify(file, null, 2));
const docs = db
  .prepare(
    `SELECT d.kind, d.ref, d.meeting_id, d.attempt, d.author_role, d.model, d.prompt_id, d.prompt_version,
       d.input_tokens, d.output_tokens, d.duration_ms, d.text, c.error_kind, c.fallback
     FROM documents d LEFT JOIN llm_calls c ON c.id = d.llm_call_id
     WHERE d.file_id = ? AND d.kind <> 'segment_summary' ORDER BY d.created_at`,
  )
  .all(file.id as string) as Record<string, unknown>[];
for (const d of docs) {
  const verdict = d.kind === 'check' ? '' : d.error_kind ? ` — rejected (${d.error_kind})` : ' — accepted';
  console.log(
    `\n=== ${d.kind}${d.ref && d.kind !== 'check' ? ' ' + d.ref : ''} · ${d.meeting_id} · attempt ${d.attempt} · ${d.author_role} · ${d.model}${d.fallback ? ' (fallback)' : ''} · ${d.prompt_id}@${d.prompt_version} · tokens ${d.input_tokens}/${d.output_tokens} · ${d.duration_ms} ms${verdict}`,
  );
  console.log(d.text);
}
const summaries = db
  .prepare(`SELECT COUNT(*) AS n FROM documents WHERE file_id = ? AND kind = 'segment_summary'`)
  .get(file.id as string) as { n: number };
console.log(`\n(${summaries.n} segment summaries not shown)`);
db.close();
