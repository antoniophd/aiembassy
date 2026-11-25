import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { runOnce } from '../engine/run/run.ts';
import { esc, NOTICE } from '../web/html.ts';
import { startServer } from '../web/server.ts';
import { addMeeting, fakeLlm, goodDecision, goodTriage, scripted, services } from './support/world.ts';

test('the site serves every view with real data, the notice on every page, and stands_with / closest_to', async () => {
  const base = scripted((req) =>
    (req.messages[1]?.content ?? '').includes('sc/500') ? goodTriage('full_file') : goodTriage('report'),
  );
  const llm = fakeLlm((req) =>
    (req.messages[0]?.content ?? '').includes('you take the decision')
      ? goodDecision({
          stands_with: ['national capacity'],
          group_positions: [
            { group: 'Union of Lakeland States', cite: 'E2', position: 'Access with conditions.', same: false },
          ],
          closest_to: 'Union of Lakeland States',
          differs_on: { text: 'The ULS ties access to conditions.', cite: 'E2' },
        })
      : base(req),
  );
  const s = services(llm);
  addMeeting(s.db, 'sc/500', { date: '2026-11-10' });
  addMeeting(s.db, 'sc/501', { date: '2026-11-11' });
  await runOnce(s, { trigger: 'manual', maxMinutes: 5, maxCalls: 200, ingest: false });
  const server = startServer(s.db, '127.0.0.1', 0);
  await new Promise((r) => server.once('listening', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (path: string) => {
    // Caddy marks requests that passed the Metrics credentials (ops/Caddyfile).
    const headers = path === '/metrics' ? { 'x-embassy-metrics': 'granted' } : undefined;
    const r = await fetch(origin + path, { redirect: 'manual', headers });
    return { status: r.status, text: await r.text() };
  };
  try {
    assert.equal((await get('/')).status, 302);
    const pages = ['/meetings', '/meetings/sc/500', '/meetings/sc/501?doc=report', '/positions', '/about', '/metrics'];
    for (const p of pages) {
      const r = await get(p);
      assert.equal(r.status, 200, p);
      assert.ok(r.text.includes(esc(NOTICE[0])), 'notice on ' + p);
    }
    const week = (await get('/meetings')).text;
    assert.match(week, /Nov 9 – 13/);
    assert.match(week, /votes in favour of the draft/);
    const file = (await get('/meetings/sc/500')).text;
    assert.match(file, /No group · national capacity/);
    assert.match(file, /Closest to<\/span>\s*Union of Lakeland States/);
    assert.match(file, /The ULS ties access to conditions\./);
    const positions = (await get('/positions')).text;
    assert.match(positions, /Closest to Union of Lakeland States; differs on: The ULS ties access/);
    assert.match((await get('/about')).text, /How it works[\s\S]*Internal control/);
    // /mission redirects to /about; the site has one section, Embassy; no alignment table by subject; no model
    // names and no internal-check box on meeting pages.
    const moved = await get('/mission');
    assert.equal(moved.status, 301);
    for (const gone of ['/diplomat', '/workflow']) assert.equal((await get(gone)).status, 404, gone);
    // One section in the header, marked as current on every page; the stylesheet versioned so a changed style is
    // never served from a stale cache.
    assert.match(week, /<nav class="demos"[^>]*><a href="\/meetings" aria-current="page">Embassy<\/a><\/nav>/);
    assert.doesNotMatch(week, /Diplomat|Workflow \(|is an experiment|its author/);
    assert.match(week, /<link rel="stylesheet" href="\/static\/site\.css\?v=[0-9a-f]{10}">/);
    const css = (await get('/static/site.css')).text;
    assert.match(css, /\.demos\{display:flex;flex-wrap:wrap;gap:8px 36px/);
    assert.match(css, /\.demos a\{[^}]*text-decoration:none/);
    assert.match(css, /\.demos a\[aria-current\]\{[^}]*font-weight:600;border-bottom-color:var\(--accent\)/);
    assert.doesNotMatch((await get('/about')).text, /Development, climate finance|tends to stand/i);
    for (const p of [
      '/meetings/sc/500',
      '/meetings/sc/500?doc=report',
      '/meetings/sc/500?doc=triage',
      '/meetings/sc/500?doc=cable',
    ])
      assert.doesNotMatch((await get(p)).text, /\bwriter\b(?! ·)|deepseek|kimi|Internal check/i, p);
    // The cable: a tab after the decision, and a mark in the week list.
    assert.match(file, /\?doc=decision#documents[^]*\?doc=cable#documents[^]*\?doc=triage#documents/);
    assert.match(
      (await get('/meetings/sc/500?doc=cable')).text,
      /FROM: Permanent Mission, [^<\n]+[\s\S]*Released by the Permanent Representative/,
    );
    assert.match(week, /rowmark">Cable/);
    assert.match((await get('/metrics')).text, /noindex/);
    assert.match((await get('/meetings?q=pause')).text, /<mark>pause<\/mark>/);
    assert.equal((await get('/meetings/sc/999')).status, 404);
    assert.equal((await get('/static/../server.ts')).status, 404);
    // Escaping: a query is never rendered as markup.
    assert.ok(!(await get('/meetings?q=%3Cscript%3E')).text.includes('<script>'));
  } finally {
    server.close();
  }
});
