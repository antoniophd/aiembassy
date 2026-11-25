// Read-only summary of the database: meetings and files by body and status.
//   node cli/status.ts
import { databasePath, openReadOnly } from '../engine/db/index.ts';

const db = openReadOnly(databasePath());
const rows = (sql: string): Record<string, unknown>[] => db.prepare(sql).all() as Record<string, unknown>[];

console.log('Meetings by body:');
console.table(
  rows(`SELECT m.body, COUNT(*) AS meetings, SUM(m.has_transcript) AS with_transcript,
          COUNT(t.meeting_id) AS downloaded, SUM(t.segment_count) AS segments
        FROM meetings m LEFT JOIN transcripts t ON t.meeting_id = m.id GROUP BY m.body ORDER BY m.body`),
);
console.log('Files by status:');
console.table(rows(`SELECT status, COUNT(*) AS files FROM files GROUP BY status ORDER BY status`));
const failed = rows(`SELECT meeting_id, status_reason FROM files WHERE status = 'failed' ORDER BY meeting_id`);
if (failed.length) console.table(failed);
db.close();
