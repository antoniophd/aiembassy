// The dossier marks computed again by the line rule (2026-11-23; engine/check/line-mark.ts), with no model
// call: each event after the first of its dossier is compared with the decision of the event before it. Only a
// mark the record decides (same text and another vote; other texts and the same vote) is changed. Without
// --apply it lists the changes. Applied changes update dossier_events.change and are logged (`remark:`); stored
// decisions are not rewritten.
//   node cli/remark-dossiers.ts [--apply]
import { parseArgs } from 'node:util';
import { databasePath, nowIso, openDatabase, transaction } from '../engine/db/index.ts';
import type { Decision } from '../engine/check/decision.ts';
import { lineMark } from '../engine/check/line-mark.ts';
import { acquireLock, releaseLock } from '../engine/run/lock.ts';

const { values } = parseArgs({ options: { apply: { type: 'boolean' } } });
const db = openDatabase(databasePath());
const events = db
  .prepare(
    `SELECT e.id, e.dossier_id, e.change, f.meeting_id, d.body_json FROM dossier_events e
     JOIN files f ON f.id = e.file_id JOIN meetings m ON m.id = f.meeting_id JOIN documents d ON d.id = e.document_id
     ORDER BY e.dossier_id, m.date, m.id`,
  )
  .all() as { id: string; dossier_id: string; change: string; meeting_id: string; body_json: string }[];
const changes: { id: string; meeting: string; from: string; to: string; basis: string; after: string }[] = [];
let prev: (typeof events)[number] | undefined;
for (const e of events) {
  if (prev && prev.dossier_id === e.dossier_id && e.change !== 'first') {
    const m = lineMark(JSON.parse(prev.body_json) as Decision, {
      ...(JSON.parse(e.body_json) as Decision),
      change: e.change as Decision['change'],
    });
    if (m.change !== e.change && m.change_basis !== 'decision')
      changes.push({
        id: e.id,
        meeting: e.meeting_id,
        from: e.change,
        to: m.change,
        basis: m.change_basis,
        after: prev.meeting_id,
      });
  }
  prev = e;
}
console.log(`events ${events.length}; marks to change ${changes.length}`);
for (const c of changes) console.log(`  ${c.meeting} (after ${c.after}): ${c.from} → ${c.to} (${c.basis})`);
if (values.apply && changes.length) {
  const owner = 'remark-dossiers';
  if (!acquireLock(db, owner, 5)) throw Error('A run holds the lock; try later');
  try {
    const at = nowIso();
    transaction(db, () => {
      for (const c of changes) db.prepare('UPDATE dossier_events SET change = ? WHERE id = ?').run(c.to, c.id);
      db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run(
        `remark:${at}`,
        JSON.stringify({ reason: 'dossier mark by the line, not the groups (owner, 2026-11-23)', changes }),
        at,
      );
    });
    console.log('applied');
  } finally {
    releaseLock(db, owner);
  }
}
db.close();
