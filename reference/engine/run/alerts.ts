// Alert rule: a scheduled run that did not start or did not
// finish; eligible work with nothing advancing for 24 hours; more than 30 %
// of model calls failed or on the fallback in 24 hours. One open alert per
// kind and key; an alert is resolved when its condition clears. Shown on the
// site. Pure database work, no model.
import { randomUUID } from 'node:crypto';
import { nowIso, transaction, type Db } from '../db/index.ts';

export type AlertKind = 'run_missed' | 'run_unfinished' | 'stalled' | 'model_failures';
interface Found {
  kind: AlertKind;
  key: string;
  message: string;
  detail: Record<string, unknown>;
}

export const DEFAULT_RUN_TIMES = ['06:00', '14:00', '22:00'];
/** A scheduled run must have started within this window after its time. */
const START_GRACE_MIN = 20;
const HOUR = 3_600_000;

export function parseRunTimes(v: string | undefined): string[] {
  const times = (v ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t));
  return times.length ? times : DEFAULT_RUN_TIMES;
}

/** Scheduled times (UTC) in (now − 24 h, now − grace]. */
export function dueTimes(now: Date, runTimes: string[]): Date[] {
  const out: Date[] = [];
  for (let day = -1; day <= 0; day++)
    for (const t of runTimes) {
      const [h, m] = t.split(':').map(Number) as [number, number];
      const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + day, h, m));
      const age = now.getTime() - at.getTime();
      if (age >= START_GRACE_MIN * 60_000 && age < 24 * HOUR) out.push(at);
    }
  return out;
}

export function findAlerts(
  db: Db,
  opts: { now?: Date; runTimes: string[]; maxMinutes: number; scheduledSince?: string | null },
): Found[] {
  const now = opts.now ?? new Date();
  const found: Found[] = [];
  const iso = (d: Date) => d.toISOString();
  // 1 · scheduled runs that did not start (only once the timer is installed).
  for (const at of dueTimes(now, opts.runTimes)) {
    if (!opts.scheduledSince || iso(at) < opts.scheduledSince) continue;
    const started = db
      .prepare(`SELECT 1 FROM runs WHERE trigger = 'timer' AND started_at BETWEEN ? AND ?`)
      .get(iso(new Date(at.getTime() - 5 * 60_000)), iso(new Date(at.getTime() + START_GRACE_MIN * 60_000)));
    if (!started)
      found.push({
        kind: 'run_missed',
        key: iso(at),
        message: `The scheduled run of ${iso(at).slice(0, 16).replace('T', ' ')} UTC did not start.`,
        detail: { scheduled: iso(at) },
      });
  }
  // 2 · runs that did not finish (or failed) in the last 24 hours.
  const limit = iso(new Date(now.getTime() - (opts.maxMinutes + 15) * 60_000));
  for (const r of db
    .prepare(
      `SELECT id, trigger, started_at, finished_at, outcome FROM runs WHERE started_at >= ?
       AND ((finished_at IS NULL AND started_at < ?) OR outcome = 'failed')`,
    )
    .all(iso(new Date(now.getTime() - 24 * HOUR)), limit) as {
    id: string;
    trigger: string;
    started_at: string;
    finished_at: string | null;
    outcome: string | null;
  }[])
    found.push({
      kind: 'run_unfinished',
      key: r.id,
      message: `Run ${r.id.slice(0, 8)} (${r.trigger}, ${r.started_at.slice(0, 16).replace('T', ' ')} UTC) ${r.finished_at ? 'failed' : 'did not finish'}.`,
      detail: r,
    });
  // 3 · eligible work and nothing advanced in 24 hours.
  const waiting = (
    db.prepare(`SELECT COUNT(*) AS n FROM files WHERE status IN ('queued','triaged','in_progress')`).get() as {
      n: number;
    }
  ).n;
  if (waiting) {
    const last = db
      .prepare(
        `SELECT MAX(t) AS t FROM (SELECT MAX(updated_at) AS t FROM files UNION ALL SELECT MAX(created_at) FROM documents)`,
      )
      .get() as { t: string | null };
    if (!last.t || last.t < iso(new Date(now.getTime() - 24 * HOUR)))
      found.push({
        kind: 'stalled',
        key: 'queue',
        message: `${waiting} file${waiting === 1 ? '' : 's'} waiting and nothing advanced in 24 hours.`,
        detail: { waiting, last_progress: last.t },
      });
  }
  // 4 · more than 30 % of model calls failed or on the fallback in 24 hours (at least 10 calls).
  const c = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(state = 'failed' OR fallback = 1), 0) AS bad FROM llm_calls
       WHERE claimed_at >= ? AND task <> 'probe'`,
    )
    .get(iso(new Date(now.getTime() - 24 * HOUR))) as { n: number; bad: number };
  if (c.n >= 10 && c.bad / c.n > 0.3)
    found.push({
      kind: 'model_failures',
      key: '24h',
      message: `${Math.round((100 * c.bad) / c.n)} % of ${c.n} model calls in 24 hours failed or ran on the fallback.`,
      detail: c,
    });
  return found;
}

/** Opens new alerts and resolves those whose condition cleared. Returns the open alerts. */
export function checkAlerts(
  db: Db,
  opts: Parameters<typeof findAlerts>[1],
): { opened: number; resolved: number; open: number } {
  const found = findAlerts(db, opts);
  const at = nowIso();
  return transaction(db, () => {
    const open = db
      .prepare(
        `SELECT id, kind, created_at, json_extract(detail_json, '$.key') AS key FROM alerts WHERE resolved_at IS NULL`,
      )
      .all() as { id: string; kind: string; key: string; created_at: string }[];
    // A run alert records an event: once resolved (by expiry or by hand) it does not reopen.
    const seen = new Set(
      (
        db
          .prepare(`SELECT kind || ' ' || json_extract(detail_json, '$.key') AS k FROM alerts WHERE kind LIKE 'run_%'`)
          .all() as { k: string }[]
      ).map((r) => r.k),
    );
    let opened = 0;
    let resolved = 0;
    for (const f of found)
      if (!open.some((o) => o.kind === f.kind && o.key === f.key) && !seen.has(`${f.kind} ${f.key}`)) {
        db.prepare(`INSERT INTO alerts (id, kind, message, detail_json, created_at) VALUES (?, ?, ?, ?, ?)`).run(
          randomUUID(),
          f.kind,
          f.message,
          JSON.stringify({ key: f.key, ...f.detail }),
          at,
        );
        opened++;
      }
    // Run alerts record an event: they stay open for 48 hours. The others clear with their condition.
    const expired = (o: { kind: string; created_at: string }) =>
      o.created_at < new Date((opts.now ?? new Date()).getTime() - 48 * HOUR).toISOString();
    for (const o of open)
      if (o.kind.startsWith('run_') ? expired(o) : !found.some((f) => f.kind === o.kind && f.key === o.key)) {
        db.prepare(`UPDATE alerts SET resolved_at = ? WHERE id = ?`).run(at, o.id);
        resolved++;
      }
    return { opened, resolved, open: open.length + opened - resolved };
  });
}
