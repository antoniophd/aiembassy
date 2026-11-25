// Hourly maintenance (systemd timer embassy-maintain): the alert check, and the
// daily database copy once a day. Never calls a model.
//   node cli/maintain.ts [--backup]
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { databasePath, openDatabase } from '../engine/db/index.ts';
import { checkAlerts, parseRunTimes } from '../engine/run/alerts.ts';
import { dailyBackup } from '../engine/run/backup.ts';
import { runOptionsFromEnv } from '../engine/run/run.ts';

const { values } = parseArgs({ options: { backup: { type: 'boolean' } } });
const env = process.env;
const db = openDatabase(databasePath(env));
try {
  const since = db.prepare(`SELECT value FROM settings WHERE key = 'timer:installed_at'`).get() as
    { value: string } | undefined;
  const alerts = checkAlerts(db, {
    runTimes: parseRunTimes(env.RUN_TIMES),
    maxMinutes: runOptionsFromEnv(env).maxMinutes,
    scheduledSince: since?.value ?? null,
  });
  const backup = values.backup ? dailyBackup(db, join(env.DATA_DIR || 'data', 'backups')) : null;
  console.log(JSON.stringify({ alerts, backup }));
} finally {
  db.close();
}
