// Snapshot of every file's accepted work, to compare before and after a
// reprocess (2026-11-13): level, status, stands_with, report length,
// claims checked, cable. Read-only on the database; writes JSON.
//   node tools/snapshot.ts save <name>          → data/snapshots/<name>.json
//   node tools/snapshot.ts compare <before> <after> [--from YYYY-MM-DD --to YYYY-MM-DD]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { databasePath, openReadOnly, type Db } from '../engine/db/index.ts';
import { claimVerdicts } from '../engine/queue/plan-full.ts';
import type { FileRow } from '../engine/work/context.ts';
import { acceptedDocument } from '../engine/work/documents.ts';

export interface FileSnapshot {
  meeting_id: string;
  date: string;
  level: string | null;
  status: string;
  stands_with: string[] | null;
  position: string | null;
  change: string | null;
  report_words: number | null;
  claims: { supported: number; checked: number; total: number } | null;
  cable: boolean;
  low_confidence: boolean;
}

const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

export function snapshot(db: Db): FileSnapshot[] {
  const files = db
    .prepare(
      `SELECT f.*, m.date FROM files f JOIN meetings m ON m.id = f.meeting_id WHERE f.duplicate_of IS NULL
       ORDER BY m.date, f.meeting_id`,
    )
    .all() as unknown as (FileRow & { date: string })[];
  return files.map((f) => {
    const a = (kind: Parameters<typeof acceptedDocument>[3], ref = '') =>
      acceptedDocument(db, f.id, f.meeting_id, kind, ref);
    const report = a('report');
    const decision = a('decision', 'A');
    const d = decision
      ? (JSON.parse(decision.body_json) as { stands_with: string[]; position: string; change: string })
      : null;
    const verdicts = report ? claimVerdicts(db, f, report) : [];
    const checked = verdicts.filter((v) => v !== null) as string[];
    return {
      meeting_id: f.meeting_id,
      date: f.date,
      level: f.level,
      status: f.status,
      stands_with: d?.stands_with ?? null,
      position: d?.position ?? null,
      change: d?.change ?? null,
      report_words: report ? words(report.text) : null,
      claims: checked.length
        ? {
            supported: checked.filter((v) => v === 'supported').length,
            checked: checked.length,
            total: verdicts.length,
          }
        : null,
      cable: !!a('cable'),
      low_confidence: !!f.low_confidence,
    };
  });
}

const dir = new URL('../data/snapshots/', import.meta.url);

if (import.meta.main) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'save' && a) {
    const db = openReadOnly(databasePath());
    mkdirSync(dir, { recursive: true });
    const rows = snapshot(db);
    writeFileSync(
      new URL(`${a}.json`, dir),
      JSON.stringify({ taken_at: new Date().toISOString(), files: rows }, null, 1),
    );
    console.log(`${rows.length} files → data/snapshots/${a}.json`);
  } else if (cmd === 'compare' && a && b) {
    const load = (n: string) =>
      (JSON.parse(readFileSync(new URL(`${n}.json`, dir), 'utf8')) as { files: FileSnapshot[] }).files;
    const before = new Map(load(a).map((x) => [x.meeting_id, x]));
    const sw = (x?: FileSnapshot) => (x?.stands_with ? x.stands_with.join(' + ') : '—');
    console.log('| Meeting | Level | Stands with | Report words | Claims supported | Cable |');
    console.log('|---|---|---|---|---|---|');
    for (const x of load(b)) {
      const y = before.get(x.meeting_id);
      const c = (s?: FileSnapshot) => (s?.claims ? `${s.claims.supported}/${s.claims.checked}` : '—');
      console.log(
        `| ${x.meeting_id} | ${y?.level ?? '—'} → ${x.level} | ${sw(y)} → ${sw(x)} | ${y?.report_words ?? '—'} → ${x.report_words ?? '—'} | ${c(y)} → ${c(x)} | ${y?.cable ? 'yes' : 'no'} → ${x.cable ? 'yes' : 'no'} |`,
      );
    }
  } else throw Error('Usage: node tools/snapshot.ts save <name> | compare <before> <after>');
}
