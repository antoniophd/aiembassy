// Reopens not_adopted or failed files after a prompt, check or model change.
// Build-time tool; logged in settings (reopen:<time>).
//   node cli/reopen.ts --reason "report prompt 1.1.0" id [id …]
//   … --restart id   restarts one file from triage (earlier documents no longer count)
//   … --decision id  re-decides decided full files (decisions, red lines, press again)
//   … --memo id      redoes memo, decisions, red lines and press of a decided full file
//   … --rework [--hold] id  (--hold: stop after the new triage until released)
//   … --from-report [--hold] id  reworks from the report, keeping triage and segment summaries
//   … --cable [--replace] id  gives a file its missing cable (--replace: rejects the current one first)
//   … --rework id    reworks a decided full file from triage, reusing its segment summaries
//   Before acting it shows which other files of the dossier lose their position or wait, and asks to confirm
//   (2026-11-25); --yes confirms without asking (no terminal).
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { databasePath, openDatabase } from '../engine/db/index.ts';
import {
  recableFile,
  redecideFile,
  reopenFiles,
  restartFile,
  reworkFile,
  reworkFromReport,
} from '../engine/work/reopen.ts';
import { dossierImpact, impactLines } from '../engine/work/reopen-impact.ts';

const { values, positionals } = parseArgs({
  options: {
    reason: { type: 'string' },
    restart: { type: 'boolean' },
    decision: { type: 'boolean' },
    rework: { type: 'boolean' },
    memo: { type: 'boolean' },
    hold: { type: 'boolean' },
    cable: { type: 'boolean' },
    replace: { type: 'boolean' },
    'from-report': { type: 'boolean' },
    yes: { type: 'boolean' },
  },
  allowPositionals: true,
});
if (!values.reason || !positionals.length) throw Error('Usage: node cli/reopen.ts --reason "<why>" <meeting id> …');
const db = openDatabase(databasePath());
const impact = dossierImpact(db, positionals);
if (impact.length) {
  console.log('Other files of the dossier are affected:\n' + impactLines(impact).join('\n'));
  let ok = !!values.yes;
  if (!ok && process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    ok = /^y(es)?$/i.test((await rl.question('Reopen anyway? [y/N] ')).trim());
    rl.close();
  }
  if (!ok) {
    db.close();
    console.log(process.stdin.isTTY ? 'Nothing done.' : 'Nothing done: re-run with --yes to confirm.');
    process.exit(1);
  }
}
try {
  console.table(
    values['from-report']
      ? positionals.map((id) => reworkFromReport(db, id, values.reason as string, !!values.hold))
      : values.cable
        ? positionals.map((id) => recableFile(db, id, values.reason as string, !!values.replace))
        : values.rework
          ? positionals.map((id) => reworkFile(db, id, values.reason as string, !!values.hold))
          : values.decision || values.memo
            ? positionals.map((id) => redecideFile(db, id, values.reason as string, !!values.memo))
            : values.restart
              ? positionals.map((id) => restartFile(db, id, values.reason as string))
              : reopenFiles(db, positionals, values.reason),
  );
} finally {
  db.close();
}
