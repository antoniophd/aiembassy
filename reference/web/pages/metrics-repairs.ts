// Repairs made by code instead of a rejection (2026-11-19), counted
// for Metrics: agreement and disagreement lines of reports (cite added, or
// name removed) and delegations removed from cables. Read from the accepted
// documents (`code_repairs` in their body). Read-only.
import type { Db } from '../../engine/db/index.ts';
import { offsetDate } from '../../engine/ingest/scope.ts';

export interface RepairCount {
  reportCites: number;
  reportRemoved: number;
  cableRemoved: number;
  documents: number;
}

export function repairCounts(db: Db, monday: string): RepairCount {
  const rows = db
    .prepare(
      `SELECT d.kind, d.body_json FROM documents d JOIN llm_calls c ON c.id = d.llm_call_id
       JOIN files f ON f.id = d.file_id JOIN meetings m ON m.id = d.meeting_id
       WHERE m.date BETWEEN ? AND ? AND c.error_kind IS NULL AND d.kind IN ('report','cable')
         AND d.body_json LIKE '%"code_repairs"%'`,
    )
    .all(monday, offsetDate(monday, 6)) as { kind: string; body_json: string }[];
  const out: RepairCount = { reportCites: 0, reportRemoved: 0, cableRemoved: 0, documents: 0 };
  for (const r of rows) {
    const repairs = (JSON.parse(r.body_json).code_repairs ?? []) as { action: string }[];
    if (!repairs.length) continue;
    out.documents++;
    for (const x of repairs)
      if (r.kind === 'cable') out.cableRemoved++;
      else if (x.action === 'cite_added') out.reportCites++;
      else out.reportRemoved++;
  }
  return out;
}

/** "4 cites added, 1 name removed in reports; 2 names removed in cables (5 documents)", or "—". */
export function repairText(c: RepairCount): string {
  if (!c.documents) return '—';
  const parts = [
    c.reportCites || c.reportRemoved ? `${c.reportCites} cites added, ${c.reportRemoved} names removed in reports` : '',
    c.cableRemoved ? `${c.cableRemoved} names removed in cables` : '',
  ].filter(Boolean);
  return `${parts.join('; ')} (${c.documents} documents)`;
}
