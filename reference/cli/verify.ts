// Read-only verification of the work in the database:
//   - files by level and status, documents and calls;
//   - every accepted report re-checked against its segments (counts of
//     cited items, figures, quotations and attributions verified);
//   - with --corrupt: one real report with one figure and one speaker
//     altered must be rejected.
//   node cli/verify.ts [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--corrupt]
import { parseArgs } from 'node:util';
import { databasePath, openReadOnly } from '../engine/db/index.ts';
import { loadMaterial } from '../engine/work/context.ts';
import { checkReport, parseReport } from '../engine/work/report-doc.ts';

const { values } = parseArgs({
  options: { from: { type: 'string' }, to: { type: 'string' }, corrupt: { type: 'boolean' } },
});
const db = openReadOnly(databasePath());
const from = values.from ?? '0000-00-00';
const to = values.to ?? '9999-99-99';
const rows = (sql: string, ...p: string[]): Record<string, unknown>[] =>
  db.prepare(sql).all(...p) as Record<string, unknown>[];

console.log(`Files with meetings ${from} – ${to}`);
console.table(
  rows(
    `SELECT f.level, f.status, COUNT(*) AS files, SUM(f.low_confidence) AS low_confidence,
       SUM(f.duplicate_of IS NOT NULL) AS duplicates
     FROM files f JOIN meetings m ON m.id = f.meeting_id WHERE m.date BETWEEN ? AND ?
     GROUP BY f.level, f.status ORDER BY f.level, f.status`,
    from,
    to,
  ),
);
console.table(
  rows(
    `SELECT task, fallback, state, COALESCE(error_kind, '') AS error_kind, COUNT(*) AS calls,
       SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens
     FROM llm_calls WHERE task <> 'probe' GROUP BY task, fallback, state, error_kind ORDER BY task`,
  ),
);

const reports = rows(
  `SELECT d.id, d.meeting_id, d.body_json FROM documents d JOIN llm_calls c ON c.id = d.llm_call_id
   JOIN meetings m ON m.id = d.meeting_id
   WHERE d.kind = 'report' AND c.error_kind IS NULL AND m.date BETWEEN ? AND ? ORDER BY m.date, m.id`,
  from,
  to,
);
const total = { reports: 0, passed: 0, items: 0, cites: 0, figures: 0, quotes: 0, attributions: 0, claims: 0 };
for (const r of reports) {
  const report = parseReport(JSON.parse(String(r.body_json)));
  const m = loadMaterial(db, String(r.meeting_id));
  const c = checkReport(report, m.segments, m.meeting.title + ' ' + m.meeting.date);
  total.reports++;
  if (c.pass) total.passed++;
  else console.log('FAILED re-check', r.meeting_id, c.failures);
  total.items += c.stats.items;
  total.cites += c.stats.cites;
  total.figures += c.stats.figures;
  total.quotes += c.stats.quotes;
  total.attributions += c.stats.attributions;
  total.claims += report.claims.length;
}
console.log('Accepted reports re-checked against their segments:', total);

/** Alters one figure and one speaker of a real accepted report; the check must reject it. */
function corruptOne(): void {
  for (const r of reports) {
    const m = loadMaterial(db, String(r.meeting_id));
    const report = parseReport(JSON.parse(String(r.body_json)));
    const withFigure = [...report.positions, ...report.issues].find((i) => /\b\d{2,}\b/.test(i.text));
    const p0 = report.positions[0];
    if (!withFigure || !p0) continue;
    const present = new Set(
      m.segments.filter((s) => p0.cites.includes(s.label)).flatMap((s) => s.speakers.map((x) => x.label)),
    );
    const absent = [...new Set(m.speakers.map((x) => x.label))].find((l) => !present.has(l));
    if (!absent) continue;
    const fig = (/\b\d{2,}\b/.exec(withFigure.text) as RegExpExecArray)[0];
    const altered = String(Number(fig) + 7);
    withFigure.text = withFigure.text.replace(fig, altered);
    const changes = [`figure ${fig} -> ${altered}`, `speaker "${p0.delegation}" -> "${absent}"`];
    p0.delegation = absent;
    const c = checkReport(report, m.segments, m.meeting.title + ' ' + m.meeting.date);
    console.log(`Corrupted copy of the report on ${r.meeting_id} (${changes.join('; ')}): pass=${c.pass}`);
    for (const f of c.failures) console.log('  ', f.rule, '·', f.section, '·', f.detail);
    return;
  }
  console.log('No report suitable for corruption');
}
if (values.corrupt) corruptOne();
db.close();
