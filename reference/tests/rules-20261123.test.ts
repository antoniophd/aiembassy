// Decisions of 2026-11-23: Metrics only behind its own credentials, alerts on Metrics only, not indexed,
// 60 requests a minute per visitor, the short-transcript mark follows the index's duration, another Council
// meeting inside a recording is cut away.
import assert from 'node:assert/strict';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { openDatabase } from '../engine/db/index.ts';
import { ownMeeting } from '../engine/evidence/meeting-bounds.ts';
import { refreshTranscriptQuality, upsertMeeting } from '../engine/ingest/store.ts';
import { normaliseIndexMeeting } from '../engine/ingest/un-transcripts.ts';
import { RateLimiter } from '../web/rate-limit.ts';
import { handle, startServer } from '../web/server.ts';
import { addMeeting } from './support/world.ts';

/** A raw request: the path is sent exactly as written (fetch would normalise it). */
function raw(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; text: string; headers: Record<string, unknown> }>((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port, path, headers }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text, headers: res.headers }));
    });
    r.on('error', reject);
    r.end();
  });
}

test('Metrics is served only with the mark Caddy sets after its own credentials; other spellings are not found', async () => {
  const db = openDatabase(':memory:');
  addMeeting(db, 'sc/600');
  db.prepare(
    `INSERT INTO alerts (id, kind, message, created_at) VALUES ('a1', 'stalled', 'Internal alert text', '2026-11-23T00:00:00Z')`,
  ).run();
  const server = startServer(db, '127.0.0.1', 0);
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as AddressInfo).port;
  const granted = { 'x-embassy-metrics': 'granted' };
  try {
    for (const p of [
      '/metrics',
      '/metrics/',
      '/%6Detrics',
      '/%6d%65trics',
      '/./metrics',
      '/a/../metrics',
      '/METRICS',
      '/Metrics/',
    ]) {
      const r = await raw(port, p);
      assert.equal(r.status, 404, p);
      assert.doesNotMatch(r.text, /Internal alert text|Metrics<\/h1>/, p);
    }
    assert.equal((await raw(port, '/metrics/x', granted)).status, 404);
    assert.equal((await raw(port, '/metrics', { 'x-embassy-metrics': 'yes' })).status, 404);
    const m = await raw(port, '/metrics', granted);
    assert.equal(m.status, 200);
    assert.match(m.text, /Internal alert text/, 'alerts are shown on Metrics');
    for (const p of ['/meetings', '/about', '/positions', '/meetings/sc/600']) {
      const r = await raw(port, p);
      assert.equal(r.status, 200, p);
      assert.doesNotMatch(r.text, /Internal alert text|class="alert"/, 'no alert on ' + p);
      assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow', p);
      assert.match(r.text, /<meta name="robots" content="noindex, nofollow">/, p);
    }
    const robots = await raw(port, '/robots.txt');
    assert.equal(robots.status, 200);
    assert.equal(robots.text, 'User-agent: *\nDisallow: /\n');
  } finally {
    server.close();
  }
});

test('60 requests a minute per visitor; static files do not count; another visitor is not affected', () => {
  const lim = new RateLimiter(60, 60_000);
  for (let i = 0; i < 60; i++) assert.equal(lim.take('a', 1000 + i), 0);
  assert.ok(lim.take('a', 2000) > 0);
  assert.equal(lim.take('b', 2000), 0);
  assert.equal(lim.take('a', 61_001), 0, 'the window slides');

  const db = openDatabase(':memory:');
  const small = new RateLimiter(2, 60_000);
  const call = (url: string, ip = '203.0.113.5') => {
    let status = 0;
    const res = {
      writeHead: (s: number) => ((status = s), res),
      setHeader: () => undefined,
      end: () => undefined,
      headersSent: false,
    };
    handle(db, { url, method: 'GET', headers: { 'x-forwarded-for': ip }, socket: {} } as never, res as never, small);
    return status;
  };
  assert.equal(call('/about'), 200);
  assert.equal(call('/static/site.css'), 200);
  assert.equal(call('/about'), 200);
  assert.equal(call('/about'), 429);
  assert.equal(call('/static/site.css'), 200, 'static files are not limited');
  assert.equal(call('/about', '198.51.100.7'), 200);
});

test('the short-transcript mark follows a corrected duration, both ways, and is logged', () => {
  const db = openDatabase(':memory:');
  // 35,460 characters: short for a 1 h 40 min meeting (< 6 a second), normal for 41 min.
  addMeeting(db, 'ga/c3/99/48', { duration: '01:40:00', chars: 35_460 });
  const line =
    'Low confidence: the transcript is short for the meeting’s length (35,460 characters for 1 h 40 min); part of the proceedings may be missing or silent.';
  db.prepare(`UPDATE files SET low_confidence = 1, low_confidence_reason = ? WHERE meeting_id = 'ga/c3/99/48'`).run(
    line,
  );
  const state = () =>
    db
      .prepare(
        `SELECT t.suspect_incomplete AS s, f.low_confidence AS lc, f.low_confidence_reason AS r FROM transcripts t
         JOIN files f ON f.meeting_id = t.meeting_id WHERE t.meeting_id = 'ga/c3/99/48'`,
      )
      .get() as { s: number; lc: number; r: string | null };
  assert.equal(state().s, 1);
  const index = (duration: string) =>
    normaliseIndexMeeting({ slug: 'ga/c3/99/48', date: '2026-11-18', hasTranscript: true, duration, title: 'x' })!;
  upsertMeeting(db, index('00:41:34'));
  assert.deepEqual({ ...state() }, { s: 0, lc: 0, r: null });
  // Another reason stays when the short line goes.
  db.prepare(`UPDATE files SET low_confidence = 1, low_confidence_reason = ? WHERE meeting_id = 'ga/c3/99/48'`).run(
    'Low confidence: the two independent decisions differ (option or stands_with); both are kept.',
  );
  upsertMeeting(db, index('01:40:00'));
  assert.equal(state().s, 1);
  assert.match(state().r ?? '', /decisions differ[\s\S]*transcript is short/);
  upsertMeeting(db, index('00:41:34'));
  assert.deepEqual(
    { ...state() },
    {
      s: 0,
      lc: 1,
      r: 'Low confidence: the two independent decisions differ (option or stands_with); both are kept.',
    },
  );
  assert.equal(refreshTranscriptQuality(db, 'ga/c3/99/48'), null, 'no change, nothing done');
  const log = db.prepare(`SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'quality:%:ga/c3/99/48'`).get() as {
    n: number;
  };
  assert.equal(log.n, 3);
});

test('another Council meeting inside a recording is cut away (sc/870 held all of sc/869)', () => {
  const sp = (start: number, end: number, label: string) => ({ start, end, label });
  const segs = [
    {
      label: 'E1',
      start: 572,
      end: 1300,
      text: '[572s] The 869th meeting of the Security Council is called to order. [584s] The provisional agenda for this meeting is: The question of the Vandrel Basin.',
      speakers: [sp(572, 1300, 'Arvenia · President')],
    },
    {
      label: 'E2',
      start: 1300,
      end: 1900,
      text: '[1300s] Resolution 9936 was adopted without a vote.',
      speakers: [sp(1300, 1900, 'Belmora')],
    },
    {
      label: 'E3',
      start: 1900,
      end: 2700,
      text: '[2164s] No other speaker has asked for the floor. [2174s] The meeting is adjourned. [2290s] The 870th meeting of the Security Council is called to order. [2301s] The provisional agenda for this meeting is: the question of the Ruvane straits.',
      speakers: [sp(1900, 2174, 'Corvalia'), sp(2290, 2700, 'Arvenia · President')],
    },
    {
      label: 'E4',
      start: 2700,
      end: 3300,
      text: '[2724s] Resolution 9937 on the Ruvane straits was adopted. [3200s] The meeting is adjourned. [3250s] The 871st meeting of the Security Council is called to order.',
      speakers: [sp(2700, 3200, 'Dravonia'), sp(3250, 3300, 'Arvenia · President')],
    },
  ];
  const all = segs.flatMap((s) => s.speakers);
  const r = ownMeeting('security_council', 870, segs, all);
  assert.deepEqual(
    r.segments.map((s) => [s.label, s.start, s.end]),
    [
      ['E3', 2290, 2700],
      ['E4', 2700, 3250],
    ],
  );
  assert.match(r.segments[0]!.text, /^\[2290s\] The 870th meeting/);
  assert.doesNotMatch(r.segments.map((s) => s.text).join(' '), /9936|Vandrel|871st/);
  assert.deepEqual(
    r.speakers.map((s) => s.label),
    ['Arvenia · President', 'Dravonia'],
  );
  assert.deepEqual(r.bounds, { from: 2290, to: 3250, foreign: [869, 871] });
  // Unchanged: the Assembly, a recording with only its own meeting, or without its own call to order.
  assert.equal(ownMeeting('ga_c3', 870, segs, all).segments, segs);
  assert.equal(ownMeeting('security_council', 869, segs.slice(0, 2), all).segments.length, 2);
  assert.equal(ownMeeting('security_council', 900, segs, all).segments, segs);
});

test('a Council meeting number written with a comma ("1,458th") is read as a number (invented meetings)', () => {
  const seg = (label: string, start: number, end: number, text: string) => ({ label, start, end, text, speakers: [] });
  const segs = [
    seg(
      'E1',
      0,
      300,
      '[10s] The 1,457th meeting of the Security Council is called to order.\n[200s] The meeting rose.',
    ),
    seg(
      'E2',
      300,
      900,
      '[320s] The 1,458th meeting of the Security Council is called to order.\n[400s] Arvenia: Thank you.',
    ),
  ];
  const r = ownMeeting('security_council', 1458, segs, []);
  assert.deepEqual(r.bounds.foreign, [1457]);
  assert.deepEqual(
    r.segments.map((s) => [s.label, s.start]),
    [['E2', 320]],
  );
});
