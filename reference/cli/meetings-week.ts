// Read-only: lists the eligible meetings of a week by body, from the live
// UN Transcripts index. Writes nothing.
//   node cli/meetings-week.ts [--week YYYY-MM-DD] [--weeks N] [--json]
// --weeks N prints a per-body count table for the N weeks ending with --week.
import { parseArgs } from 'node:util';
import { BODY_LABELS, BODIES, newYorkDate, offsetDate, weekStart } from '../engine/ingest/scope.ts';
import { listWeek, type WeekListing } from '../engine/ingest/week.ts';

const { values } = parseArgs({
  options: { week: { type: 'string' }, weeks: { type: 'string', default: '1' }, json: { type: 'boolean' } },
});
const today = newYorkDate();
const anchor = weekStart(values.week ?? today);
const count = Math.max(1, Math.min(12, Number(values.weeks) || 1));

const hms = (s: number | null): string =>
  s === null
    ? '—'
    : [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');

function printWeek(w: WeekListing): void {
  const total = w.bodies.reduce((n, b) => n + b.eligible.length, 0);
  console.log(`Week ${w.from} – ${w.to} · New York date today ${w.today} · ${total} eligible meetings`);
  for (const b of w.bodies) {
    console.log(
      `\n${BODY_LABELS[b.body]} — ${b.eligible.length} eligible` +
        (b.pending.length ? `, ${b.pending.length} without transcript yet` : ''),
    );
    for (const m of b.eligible) console.log(`  ${m.date}  ${m.id.padEnd(14)} ${hms(m.durationSeconds)}  ${m.title}`);
    for (const m of b.pending) console.log(`  ${m.date}  ${m.id.padEnd(14)} (pending)  ${m.title}`);
  }
  if (w.labelMismatches.length)
    console.log(
      '\nExcluded, index body label disagrees with slug: ' +
        w.labelMismatches.map((m) => m.id + ' (' + m.indexBody + ')').join(', '),
    );
  if (w.unrecognised.length) console.log('\nsc/ or ga/ slugs not recognised (excluded): ' + w.unrecognised.join(', '));
  console.log(`\nIndex entries for the week, all bodies: ${w.totalEntries}`);
}

const weeks: WeekListing[] = [];
for (let i = count - 1; i >= 0; i--) weeks.push(await listWeek(offsetDate(anchor, -7 * i), today));

if (values.json) console.log(JSON.stringify(count === 1 ? weeks[0] : weeks, null, 2));
else if (count === 1 && weeks[0]) printWeek(weeks[0]);
else {
  console.log('Eligible meetings per body per week (live index)\n');
  console.log(['week'.padEnd(10), ...BODIES.map((b) => b.padStart(16)), 'total'.padStart(7)].join(' '));
  for (const w of weeks) {
    const n = w.bodies.map((b) => b.eligible.length);
    console.log(
      [
        w.from.padEnd(10),
        ...n.map((x) => String(x).padStart(16)),
        String(n.reduce((a, b) => a + b, 0)).padStart(7),
      ].join(' '),
    );
  }
}
