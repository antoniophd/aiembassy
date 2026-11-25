// Metrics (private, the design), per week of meetings: meetings by level;
// full files adopted; mean new-text ratio of opinion / memo / decision;
// decisions naming an interest; stands_with; claims supported (full files and
// the one-in-ten report sample); repairs made by code instead of rejections;
// red lines the decision named and the triage did not mark (Metrics only);
// model calls, failures and tokens. Then the
// regression scores recorded by tools/regression.ts.
import type { Db } from '../../engine/db/index.ts';
import { offsetDate } from '../../engine/ingest/scope.ts';
import { meeting, weeks } from '../data.ts';
import { html, type Html } from '../html.ts';
import { weekLabel } from './meetings.ts';
import { repairCounts, repairText } from './metrics-repairs.ts';

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)} %` : '—');
const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

function week(db: Db, monday: string) {
  const range = [monday, offsetDate(monday, 6)];
  const files = db
    .prepare(
      `SELECT f.id, f.level, f.status FROM files f JOIN meetings m ON m.id = f.meeting_id
       WHERE f.duplicate_of IS NULL AND m.date BETWEEN ? AND ?`,
    )
    .all(...range) as { id: string; level: string | null; status: string }[];
  const docs = db
    .prepare(
      `SELECT d.kind, d.ref, d.body_json FROM documents d JOIN llm_calls c ON c.id = d.llm_call_id
       JOIN files f ON f.id = d.file_id JOIN meetings m ON m.id = f.meeting_id
       WHERE m.date BETWEEN ? AND ? AND c.error_kind IS NULL AND c.epoch >= f.accept_from_epoch
         AND (c.epoch >= f.decide_from_epoch OR (d.kind NOT IN ('decision','press','cable') AND d.ref NOT LIKE 'redline:%'))
         AND c.epoch >= f.rework_from_epoch AND c.epoch >= f.report_from_epoch AND (c.epoch >= f.memo_from_epoch OR d.kind <> 'options_memo')
         AND (d.kind IN ('opinion','options_memo','decision') OR d.ref LIKE 'claim:%')`,
    )
    .all(...range) as { kind: string; ref: string; body_json: string }[];
  const ratios: number[] = [];
  let decisions = 0;
  let naming = 0;
  const stands = new Map<string, number>();
  let claims = 0;
  let supported = 0;
  let addedDecisions = 0;
  let addedLines = 0;
  for (const d of docs) {
    const b = JSON.parse(d.body_json);
    if (d.ref.startsWith('claim:')) {
      claims++;
      if (b.verdict === 'supported') supported++;
      continue;
    }
    if (typeof b._checks?.copy?.ratio === 'number') ratios.push(1 - b._checks.copy.ratio);
    if (d.kind === 'decision' && d.ref === 'A') {
      decisions++;
      if (b.interests?.length) naming++;
      // Red lines the triage did not mark and the decision did (2026-11-19): Metrics only.
      const added = (b.red_lines_added ?? []) as string[];
      if (added.length) {
        addedDecisions++;
        addedLines += added.length;
      }
      const key = (b.stands_with as string[]).join(' + ');
      stands.set(key, (stands.get(key) ?? 0) + 1);
    }
  }
  const calls = db
    .prepare(
      `SELECT COALESCE(c.model_used, c.model_requested) AS model, COUNT(*) AS n,
         SUM(c.state = 'failed' OR c.error_kind IS NOT NULL) AS failed, SUM(c.fallback) AS fallback,
         COALESCE(SUM(c.input_tokens), 0) AS input, COALESCE(SUM(c.output_tokens), 0) AS output
       FROM llm_calls c JOIN files f ON f.id = c.file_id JOIN meetings m ON m.id = f.meeting_id
       WHERE m.date BETWEEN ? AND ? AND c.task <> 'probe' GROUP BY 1 ORDER BY 2 DESC`,
    )
    .all(...range) as { model: string; n: number; failed: number; fallback: number; input: number; output: number }[];
  const n = (l: string) => files.filter((f) => f.level === l).length;
  const full = files.filter((f) => f.level === 'full_file');
  return {
    monday,
    meetings: files.length,
    note: n('note'),
    report: n('report'),
    full: full.length,
    adopted: full.filter((f) => f.status === 'adopted').length,
    newText: ratios.length ? Math.round((100 * ratios.reduce((a, b) => a + b, 0)) / ratios.length) + ' %' : '—',
    naming: pct(naming, decisions),
    stands: [...stands.entries()].map(([g, c]) => `${g} ${c}`).join('; ') || '—',
    claims: claims ? `${supported}/${claims} (${pct(supported, claims)})` : '—',
    repairs: repairText(repairCounts(db, monday)),
    redAdded: addedDecisions
      ? `${addedLines} in ${addedDecisions} decision${addedDecisions === 1 ? '' : 's'} of ${decisions}`
      : '—',
    calls,
  };
}

export function metricsPage(db: Db): Html {
  const rows = weeks(db).map((w) => week(db, w));
  const reg = db
    .prepare(`SELECT key, value FROM settings WHERE key LIKE 'regression:2%' ORDER BY key DESC LIMIT 3`)
    .all() as { key: string; value: string }[];
  return html`<section class="intro">
      <h1>Metrics</h1>
      <p class="meta">Private. Computed from the database on each request; per week of meetings.</p>
    </section>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Week</th>
            <th class="num">Meetings</th>
            <th class="num">Notes</th>
            <th class="num">Reports</th>
            <th class="num">Full files</th>
            <th class="num">Adopted</th>
            <th class="num">New text</th>
            <th class="num">Decisions naming an interest</th>
            <th>Stands with</th>
            <th>Claims supported</th>
            <th>Repairs by code</th>
            <th>Red lines added by the decision</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (r) =>
              html`<tr>
                <td>${weekLabel(r.monday)}</td>
                <td class="num">${r.meetings}</td>
                <td class="num">${r.note}</td>
                <td class="num">${r.report}</td>
                <td class="num">${r.full}</td>
                <td class="num">${pct(r.adopted, r.full)}</td>
                <td class="num">${r.newText}</td>
                <td class="num">${r.naming}</td>
                <td>${r.stands}</td>
                <td>${r.claims}</td>
                <td>${r.repairs}</td>
                <td>${r.redAdded}</td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>
    <h2 class="eyebrow section-h">Model calls by week</h2>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Week</th>
            <th>Model</th>
            <th class="num">Calls</th>
            <th class="num">Failed or rejected</th>
            <th class="num">Fallback</th>
            <th class="num">Input tokens</th>
            <th class="num">Output tokens</th>
          </tr>
        </thead>
        <tbody>
          ${rows.flatMap((r) =>
            r.calls.map(
              (c, i) =>
                html`<tr>
                  <td>${i ? '' : weekLabel(r.monday)}</td>
                  <td>${c.model}</td>
                  <td class="num">${c.n}</td>
                  <td class="num">${c.failed}</td>
                  <td class="num">${c.fallback}</td>
                  <td class="num">${k(c.input)}</td>
                  <td class="num">${k(c.output)}</td>
                </tr>`,
            ),
          )}
        </tbody>
      </table>
    </div>
    <h2 class="eyebrow section-h">Internal check by file</h2>
    ${internalChecks(db)}
    <h2 class="eyebrow section-h">Regression set</h2>
    ${
      reg.length
        ? reg.map((r) => {
            const runs = JSON.parse(r.value) as {
              name: string;
              score: number;
              triage: string;
              'first pass': string;
              decided: string;
              'new text': string;
              calls: number;
              writers: string;
            }[];
            return html`<p class="meta">
                ${r.key.slice('regression:'.length, 'regression:'.length + 16).replace('T', ' ')} UTC
              </p>
              <div class="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Configuration</th>
                      <th>Writer (DPR, PR)</th>
                      <th class="num">Score</th>
                      <th class="num">Triage</th>
                      <th class="num">First pass</th>
                      <th class="num">Decided</th>
                      <th class="num">New text</th>
                      <th class="num">Calls</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${runs.map(
                      (x) =>
                        html`<tr>
                          <td>${x.name}</td>
                          <td>${x.writers}</td>
                          <td class="num">${x.score}</td>
                          <td class="num">${x.triage}</td>
                          <td class="num">${x['first pass']}</td>
                          <td class="num">${x.decided}</td>
                          <td class="num">${x['new text']}</td>
                          <td class="num">${x.calls}</td>
                        </tr>`,
                    )}
                  </tbody>
                </table>
              </div>`;
          })
        : html`<p class="meta">No regression run recorded.</p>`
    }`;
}

/**
 * The internal check of each full file, the technical low-confidence reason and, for a file not adopted, why and
 * how the public pages show it (2026-11-13 and 2026-11-25: Metrics only).
 */
function internalChecks(db: Db): Html {
  const rows = db
    .prepare(
      `SELECT f.meeting_id, f.status, f.low_confidence_reason AS reason, f.status_reason AS why,
         (SELECT d.body_json FROM documents d WHERE d.file_id = f.id AND d.ref LIKE 'internal:%'
          ORDER BY d.created_at DESC LIMIT 1) AS internal
       FROM files f WHERE f.level = 'full_file' OR f.low_confidence = 1 OR f.status IN ('not_adopted','failed')
       ORDER BY f.meeting_id`,
    )
    .all() as {
    meeting_id: string;
    status: string;
    reason: string | null;
    why: string | null;
    internal: string | null;
  }[];
  const failed = (r: { status: string }) => r.status === 'not_adopted' || r.status === 'failed';
  const shownAs = (id: string) => {
    const m = meeting(db, id);
    return m?.level === 'report' ? 'Report' : 'Note (triage)';
  };
  return html`<div class="scroll">
    <table>
      <thead>
        <tr>
          <th>Meeting</th>
          <th>Status</th>
          <th>Claims supported</th>
          <th>Red lines</th>
          <th>Two decisions</th>
          <th>Low confidence (technical)</th>
          <th>Not adopted: reason (technical) · shown as</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => {
          const i = r.internal
            ? (JSON.parse(r.internal) as {
                claims?: { supported: number; total: number };
                red_lines?: { crosses: boolean }[];
                stability?: { stable: boolean };
              })
            : null;
          return html`<tr>
            <td><a href="/meetings/${r.meeting_id}">${r.meeting_id}</a></td>
            <td>${r.status}</td>
            <td>${i?.claims ? `${i.claims.supported}/${i.claims.total}` : '—'}</td>
            <td>
              ${i?.red_lines ? (i.red_lines.some((x) => x.crosses) ? 'crossed' : `${i.red_lines.length} not crossed`) : '—'}
            </td>
            <td>${i?.stability ? (i.stability.stable ? 'agree' : 'differ') : '—'}</td>
            <td>${r.reason ?? ''}</td>
            <td>${failed(r) ? `${r.why ?? ''} · ${shownAs(r.meeting_id)}` : ''}</td>
          </tr>`;
        })}
      </tbody>
    </table>
  </div>`;
}
