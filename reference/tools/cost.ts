// Read-only: cost per finished file by level (calls and tokens, all attempts
// included, probes excluded), and a daily estimate from the observed mix.
//   node tools/cost.ts [database] [--from YYYY-MM-DD --to YYYY-MM-DD]
import { parseArgs } from 'node:util';
import { openReadOnly } from '../engine/db/index.ts';

const { values, positionals } = parseArgs({
  options: { from: { type: 'string' }, to: { type: 'string' } },
  allowPositionals: true,
});
const db = openReadOnly(positionals[0] ?? 'data/embassy.sqlite');
const from = values.from ?? '0000-00-00';
const to = values.to ?? '9999-99-99';

interface Row {
  file: string;
  level: string;
  status: string;
  segments: number;
  calls: number;
  writer_calls: number;
  checker_calls: number;
  input_tokens: number;
  output_tokens: number;
}

// Every call of a file, including the resumed parts reported inside it.
const rows = db
  .prepare(
    `SELECT f.id AS file, f.level, f.status,
       (SELECT COALESCE(SUM(t.segment_count), 0) FROM transcripts t WHERE t.meeting_id IN
          (SELECT meeting_id FROM files WHERE id = f.id OR duplicate_of = f.meeting_id)) AS segments,
       COUNT(c.id) AS calls,
       SUM(c.task NOT IN ('claim','redline')) AS writer_calls,
       SUM(c.task IN ('claim','redline')) AS checker_calls,
       COALESCE(SUM(c.input_tokens), 0) AS input_tokens, COALESCE(SUM(c.output_tokens), 0) AS output_tokens
     FROM files f JOIN meetings m ON m.id = f.meeting_id
     LEFT JOIN llm_calls c ON c.file_id = f.id AND c.task <> 'probe'
     WHERE f.duplicate_of IS NULL AND m.date BETWEEN ? AND ?
       AND f.status IN ('noted','reported','adopted')
     GROUP BY f.id`,
  )
  .all(from, to) as unknown as Row[];

const levels = ['note', 'report', 'full_file'];
const summary = levels.map((level) => {
  const xs = rows.filter((r) => r.level === level);
  const avg = (k: keyof Row) => (xs.length ? Math.round(xs.reduce((n, r) => n + Number(r[k]), 0) / xs.length) : 0);
  return {
    level,
    files: xs.length,
    'calls / file': avg('calls'),
    'writer calls': avg('writer_calls'),
    'checker calls': avg('checker_calls'),
    'input tokens / file': avg('input_tokens'),
    'output tokens / file': avg('output_tokens'),
    'segments / file': avg('segments'),
  };
});
console.log(`Finished files (noted, reported, adopted) with meetings ${from} – ${to}:`);
console.table(summary);

// Daily estimate: observed meetings per weekday and level mix.
const days = db
  .prepare(
    `SELECT COUNT(DISTINCT m.date) AS days, COUNT(*) AS meetings FROM files f JOIN meetings m ON m.id = f.meeting_id
     WHERE f.duplicate_of IS NULL AND m.date BETWEEN ? AND ? AND f.level IS NOT NULL`,
  )
  .get(from, to) as { days: number; meetings: number };
const mix = db
  .prepare(
    `SELECT f.level, COUNT(*) AS n FROM files f JOIN meetings m ON m.id = f.meeting_id
     WHERE f.duplicate_of IS NULL AND m.date BETWEEN ? AND ? AND f.level IS NOT NULL GROUP BY f.level`,
  )
  .all(from, to) as { level: string; n: number }[];
const perDay = days.meetings / (days.days || 1);
let calls = 0;
let input = 0;
let output = 0;
for (const m of mix) {
  const s = summary.find((x) => x.level === m.level);
  if (!s) continue;
  const share = m.n / days.meetings;
  calls += perDay * share * s['calls / file'];
  input += perDay * share * s['input tokens / file'];
  output += perDay * share * s['output tokens / file'];
}
console.log(
  `Observed: ${days.meetings} meetings on ${days.days} meeting days (${perDay.toFixed(1)} per day); mix ` +
    mix.map((m) => `${m.level} ${Math.round((100 * m.n) / days.meetings)}%`).join(', ') +
    '.',
);
console.log(
  `Estimated per meeting day: ${Math.round(calls)} calls, ${Math.round(input / 1000)}k input and ${Math.round(output / 1000)}k output tokens. ` +
    'The three daily runs split this work; they do not multiply it.',
);
db.close();
