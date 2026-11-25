// Scores of one regression configuration (a database prepared by
// tools/regression.ts and then run). Read-only. Only calls made after the
// preparation count. Components, each 0–1:
//   triage   — share of the ten meetings triaged at the expected level
//   first    — share of DPR and PR tasks (triage, note, memo, decision) accepted
//              on their first attempt
//   decided  — share of expected full files adopted with two agreeing decisions
// Score = 100 × mean of the three. New text, low confidence, stands_with,
// calls and tokens are shown beside it.
import type { Db } from '../engine/db/index.ts';
import { acceptedDocument } from '../engine/work/documents.ts';

const WRITER_TASKS = ['triage', 'note', 'memo', 'decision'];

interface Call {
  task: string;
  ref: string;
  attempt: number;
  error_kind: string | null;
  model_used: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
}

export function scoreConfig(db: Db, set: { id: string; level: string }[]) {
  const prepared = JSON.parse(
    (db.prepare(`SELECT value FROM settings WHERE key = 'regression:prepared'`).get() as { value: string }).value,
  ) as { from: string };
  let tasks = 0;
  let firstPass = 0;
  let decided = 0;
  const expectedFull = set.filter((m) => m.level === 'full_file').length;
  const models = new Set<string>();
  const newText: number[] = [];
  let calls = 0;
  let input = 0;
  let output = 0;
  const meetings = set.map((m) => {
    const f = db.prepare('SELECT id, level, status, low_confidence FROM files WHERE meeting_id = ?').get(m.id) as {
      id: string;
      level: string;
      status: string;
      low_confidence: number;
    };
    const rows = db
      .prepare(
        `SELECT task, ref, attempt, error_kind, model_used, input_tokens, output_tokens FROM llm_calls
         WHERE file_id = ? AND claimed_at >= ? ORDER BY claimed_at, rowid`,
      )
      .all(f.id, prepared.from) as unknown as Call[];
    calls += rows.length;
    for (const r of rows) {
      input += r.input_tokens ?? 0;
      output += r.output_tokens ?? 0;
    }
    // First attempt of each DPR/PR task in this run: accepted or not.
    const seen = new Map<string, Call>();
    for (const r of rows.filter((x) => WRITER_TASKS.includes(x.task)))
      if (!seen.has(r.task + ':' + r.ref)) seen.set(r.task + ':' + r.ref, r);
    let mFirst = 0;
    for (const r of seen.values()) {
      tasks++;
      if (r.model_used) models.add(r.model_used);
      if (!r.error_kind) {
        firstPass++;
        mFirst++;
      }
    }
    let stands = '';
    let stable: boolean | null = null;
    if (f.level === 'full_file') {
      const a = acceptedDocument(db, f.id, m.id, 'decision', 'A');
      if (a) {
        stands = (JSON.parse(a.body_json) as { stands_with: string[] }).stands_with.join(', ');
        const internal = db
          .prepare(`SELECT body_json FROM documents WHERE file_id = ? AND ref = ? ORDER BY created_at DESC LIMIT 1`)
          .get(f.id, 'internal:' + a.id) as { body_json: string } | undefined;
        stable = internal ? (JSON.parse(internal.body_json).stability?.stable as boolean) : null;
      }
      for (const kind of ['options_memo', 'decision'] as const) {
        const d = acceptedDocument(db, f.id, m.id, kind, kind === 'decision' ? 'A' : '');
        const ratio = d ? (JSON.parse(d.body_json)._checks?.copy?.ratio as number | undefined) : undefined;
        if (typeof ratio === 'number') newText.push(1 - ratio);
      }
      if (m.level === 'full_file' && f.status === 'adopted' && stable) decided++;
    }
    return {
      meeting: m.id,
      expected: m.level,
      level: f.level,
      status: f.status,
      'first pass': `${mFirst}/${seen.size}`,
      stands_with: stands,
      stable,
      low_confidence: f.low_confidence,
      calls: rows.length,
    };
  });
  const triage = meetings.filter((m) => m.level === m.expected).length / set.length;
  const first = tasks ? firstPass / tasks : 0;
  const dec = expectedFull ? decided / expectedFull : 1;
  return {
    score: Math.round((100 * (triage + first + dec)) / 3),
    triage: Math.round(100 * triage) + '%',
    'first pass': Math.round(100 * first) + '%',
    decided: `${decided}/${expectedFull}`,
    'new text': newText.length ? Math.round((100 * newText.reduce((a, b) => a + b, 0)) / newText.length) + '%' : '',
    'low conf.': meetings.filter((m) => m.low_confidence).length,
    writers: [...models].join(', '),
    calls,
    'input k': Math.round(input / 1000),
    'output k': Math.round(output / 1000),
    meetings,
  };
}
