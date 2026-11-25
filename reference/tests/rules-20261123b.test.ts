// 2026-11-23 (second message): Positions out of the navigation (route kept), dossiers without events in
// no list, the week selector, a cable on every Security Council report.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { runOnce } from '../engine/run/run.ts';
import { weekMenu } from '../web/pages/meetings.ts';
import { startServer } from '../web/server.ts';
import { addMeeting, fakeLlm, goodTriage, scripted, services } from './support/world.ts';

test('every Security Council report gets a cable; other reports keep the rule; notes never', async () => {
  // No cable mark, no interest: under the earlier rule none of these reports had a cable.
  const triage = (req: { messages: { content: string }[] }) =>
    (req.messages[1]?.content ?? '').includes('sc/702') ? goodTriage('note') : goodTriage('report');
  const s = services(fakeLlm(scripted(triage as never)));
  addMeeting(s.db, 'sc/701', { date: '2026-11-10' });
  addMeeting(s.db, 'sc/702', { date: '2026-11-10' });
  addMeeting(s.db, 'ga/c2/99/701', { date: '2026-11-10' });
  await runOnce(s, { trigger: 'manual', maxMinutes: 5, maxCalls: 200, ingest: false });
  const cables = (
    s.db.prepare(`SELECT DISTINCT meeting_id FROM documents WHERE kind = 'cable' ORDER BY meeting_id`).all() as {
      meeting_id: string;
    }[]
  ).map((r) => r.meeting_id);
  assert.deepEqual(cables, ['sc/701']);
  const st = (id: string) =>
    (s.db.prepare('SELECT status FROM files WHERE meeting_id = ?').get(id) as { status: string }).status;
  assert.deepEqual([st('sc/701'), st('sc/702'), st('ga/c2/99/701')], ['reported', 'noted', 'reported']);
});

test('Positions is out of the navigation but its route stays; dossiers without events are in no list', async () => {
  const s = services(fakeLlm(scripted()));
  addMeeting(s.db, 'sc/710', { date: '2026-11-10' });
  await runOnce(s, { trigger: 'manual', maxMinutes: 5, maxCalls: 200, ingest: false });
  const at = '2026-11-10T00:00:00Z';
  s.db
    .prepare(
      `INSERT INTO dossiers (id, title, created_at, updated_at) VALUES ('dossier:empty', 'Empty dossier title', ?, ?)`,
    )
    .run(at, at);
  const server = startServer(s.db, '127.0.0.1', 0);
  await new Promise((r) => server.once('listening', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (p: string) => {
    const r = await fetch(origin + p);
    return { status: r.status, text: await r.text() };
  };
  try {
    for (const p of ['/meetings', '/about', '/meetings/sc/710']) {
      const r = await get(p);
      assert.doesNotMatch(r.text, /href="\/positions"/, p);
      assert.match(r.text, />Meetings<\/a>/, p);
      assert.match(r.text, />About<\/a>/, p);
    }
    const pos = await get('/positions');
    assert.equal(pos.status, 200);
    assert.doesNotMatch(pos.text, /Empty dossier title/);
    assert.equal((await get('/positions/empty')).status, 404);
  } finally {
    server.close();
  }
});

test('the week selector lists every week, newest first, by month, with counts; the shown and current weeks marked', () => {
  const s = services(fakeLlm(scripted()));
  addMeeting(s.db, 'sc/720', { date: '2026-10-27' });
  addMeeting(s.db, 'sc/721', { date: '2026-11-02' });
  addMeeting(s.db, 'sc/722', { date: '2026-11-03' });
  addMeeting(s.db, 'sc/723', { date: '2026-11-17' });
  const weeks = ['2026-11-16', '2026-11-02', '2026-10-26'];
  const out = weekMenu(s.db, '2026-11-02', weeks, 'Nov 2 – 3', [], '2026-11-18').value;
  assert.match(out, /<details class="weeks">\s*<summary aria-label="Nov 2 – 3\. Choose a week">/);
  const months = [...out.matchAll(/<p class="month">([^<]+)<\/p>/g)].map((m) => m[1]);
  assert.deepEqual(months, ['November 2026', 'October 2026']);
  const links = [...out.matchAll(/href="\/meetings\?week=([\d-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(links, weeks);
  assert.match(out, /week=2026-11-02"\s+aria-current="true"[\s\S]*?2 meetings/);
  assert.match(
    out,
    /week=2026-11-16"[^>]*>\s*<span\s*>Nov 16 – 20 <span class="now">This week<\/span>[\s\S]*?1 meeting</,
  );
  assert.match(out, /week=2026-10-26"[\s\S]*?1 meeting</);
});
