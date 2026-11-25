// Regression set: fixed meetings (profile/regression.json), re-run after every prompt
// or model change, in a copy of the database so production is never touched.
//   node tools/regression.ts prepare <name>          copy data/embassy.sqlite to
//        data/regression/<name>/ and reset the DPR and PR work of the ten meetings
//        (triage, note, options memo, decisions, red lines, press). Report,
//        summaries, claims and opinions are kept: the writer comparison is about
//        the Deputy and the Permanent Representative.
//   DATA_DIR=data/regression/<name> LLM_MODEL_DPR=… LLM_MODEL_PR=… node cli/run.ts
//        --manual --no-ingest --only <the ten ids>
//   node tools/regression.ts score <name> [<name> …] [--record]
//        scores per configuration; --record stores them in the production
//        database (settings regression:<time>) for the Metrics view.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { openDatabase, openReadOnly, nowIso, type Db } from '../engine/db/index.ts';
import { redecideFile } from '../engine/work/reopen.ts';
import { scoreConfig } from './regression-score.ts';

/**
 * The regression set (2026-11-24: moved out of the code): profile/regression.json, the meetings of this
 * mission that are re-run after every prompt or model change, each with the level the build expected.
 */
export const REGRESSION_SET: { id: string; level: 'note' | 'report' | 'full_file'; why: string }[] = (
  JSON.parse(readFileSync(new URL('../profile/regression.json', import.meta.url), 'utf8')) as {
    meetings: { id: string; level: 'note' | 'report' | 'full_file'; why: string }[];
  }
).meetings;
const IDS = REGRESSION_SET.map((m) => m.id);
const dirOf = (name: string) => join('data', 'regression', name);

function prepare(name: string): void {
  if (!/^[a-z0-9-]+$/.test(name)) throw Error('Name: lowercase letters, digits and dashes');
  mkdirSync(dirOf(name), { recursive: true });
  const target = join(dirOf(name), 'embassy.sqlite');
  const prod = openDatabase(join('data', 'embassy.sqlite'));
  prod.exec(`VACUUM INTO '${target}'`);
  prod.close();
  const db = openDatabase(target);
  // A disposable copy: no outer transaction (redecideFile opens its own).
  {
    for (const id of IDS) {
      const f = db.prepare('SELECT id, level, status FROM files WHERE meeting_id = ?').get(id) as {
        id: string;
        level: string;
        status: string;
      };
      if (f.level === 'full_file') redecideFile(db, id, 'regression ' + name);
      else db.prepare('UPDATE files SET epoch = epoch + 1 WHERE id = ?').run(f.id);
      // Triage, note and memo of earlier runs no longer count in this copy.
      db.prepare(
        `UPDATE llm_calls SET error_kind = 'superseded' WHERE file_id = ? AND task IN ('triage','note','memo')
           AND error_kind IS NULL`,
      ).run(f.id);
      db.prepare(`UPDATE files SET status = 'queued', status_reason = 'regression ' || ? WHERE id = ?`).run(name, f.id);
    }
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('regression:prepared', ?, ?)`).run(
      JSON.stringify({ name, ids: IDS, from: nowIso() }),
      nowIso(),
    );
  }
  db.close();
  console.log(`Prepared ${target}. Run it with DATA_DIR=${dirOf(name)} and --only ${IDS.join(',')}`);
}

const { values, positionals } = parseArgs({ options: { record: { type: 'boolean' } }, allowPositionals: true });
const [command, ...names] = positionals;
if (command === 'prepare' && names[0]) prepare(names[0]);
else if (command === 'score' && names.length) {
  const results = names.map((name) => {
    const db: Db = openReadOnly(join(dirOf(name), 'embassy.sqlite'));
    try {
      return { name, ...scoreConfig(db, REGRESSION_SET) };
    } finally {
      db.close();
    }
  });
  console.table(results.map(({ meetings: _m, ...r }) => r));
  for (const r of results) console.table(r.meetings);
  if (values.record) {
    const db = openDatabase(join('data', 'embassy.sqlite'));
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`).run(
      'regression:' + nowIso(),
      JSON.stringify(results),
      nowIso(),
    );
    db.close();
  }
} else throw Error('Usage: node tools/regression.ts prepare <name> | score <name> … [--record]');
