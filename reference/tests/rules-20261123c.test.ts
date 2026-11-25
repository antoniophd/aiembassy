// 2026-11-23 (public repository): the earlier meeting a file is compared with is named by its own body.
// The UN titles committee meetings "Third Committee, 41st plenary meeting"; a committee meeting is not plenary.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { runOnce } from '../engine/run/run.ts';
import { meetingRef } from '../web/data.ts';
import { startServer } from '../web/server.ts';
import { addMeeting, fakeLlm, goodDecision, goodTriage, scripted, services } from './support/world.ts';

test('meetingRef names the body of the cited meeting; only Assembly meetings are plenary', () => {
  assert.equal(
    meetingRef('Third Committee, 41st plenary meeting - General Assembly, 99th session', 'ga_c3'),
    'Third Committee, 41st meeting',
  );
  assert.equal(
    meetingRef('General Assembly: 30th plenary meeting, 99th session', 'ga_plenary'),
    'General Assembly, 30th plenary meeting',
  );
  assert.equal(
    meetingRef('The question of the Vandrel Basin - Security Council, 860th meeting', 'security_council'),
    'Security Council, 860th meeting',
  );
  assert.equal(
    meetingRef('First Committee, 27th and 28th plenary meetings - General Assembly', 'ga_c1'),
    'First Committee, 27th and 28th meetings',
  );
  assert.equal(meetingRef('Test meeting ga/c3/99/1', 'ga_c3'), undefined);
});

test('the page of a committee file links the earlier meeting as "Third Committee, 741st meeting"', async () => {
  const sys = (r: { messages: { content: string }[] }) => r.messages[0]?.content ?? '';
  const base = scripted(() => goodTriage('full_file', { dossier: { id: null, new_title: 'Test situation' } }));
  const llm = fakeLlm((req) =>
    sys(req).includes('you take the decision on this file')
      ? goodDecision({
          change: (JSON.parse(req.messages[1]?.content ?? '{}') as { dossier?: { standing_position?: string } }).dossier
            ?.standing_position
            ? 'maintains'
            : 'first',
        })
      : base(req),
  );
  const s = services(llm);
  addMeeting(s.db, 'ga/c3/99/741', { date: '2026-11-10' });
  addMeeting(s.db, 'ga/c3/99/745', { date: '2026-11-17' });
  await runOnce(s, { trigger: 'manual', maxMinutes: 5, maxCalls: 300, ingest: false });
  const title = (n: number) => `Third Committee, ${n}st plenary meeting - General Assembly, 99th session`;
  s.db.prepare('UPDATE meetings SET title = ? WHERE id = ?').run(title(741), 'ga/c3/99/741');
  s.db.prepare('UPDATE meetings SET title = ? WHERE id = ?').run(title(745), 'ga/c3/99/745');
  const change = s.db
    .prepare(`SELECT e.change FROM dossier_events e JOIN files f ON f.id = e.file_id WHERE f.meeting_id = ?`)
    .get('ga/c3/99/745') as { change: string };
  assert.equal(change.change, 'maintains');
  const server = startServer(s.db, '127.0.0.1', 0);
  await new Promise((r) => server.once('listening', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const text = await (await fetch(origin + '/meetings/ga/c3/99/745')).text();
    const link = /maintains the line of the earlier meeting, <a href="\/meetings\/ga\/c3\/99\/741">([^<]*)<\/a>/.exec(
      text,
    );
    assert.ok(link, 'earlier meeting linked');
    assert.match(link[1]!, / · Third Committee, 741st meeting$/);
    assert.doesNotMatch(link[1]!, /plenary/);
  } finally {
    server.close();
  }
});
