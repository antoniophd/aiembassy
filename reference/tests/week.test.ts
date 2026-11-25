import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fetchIndex, normaliseIndexMeeting } from '../engine/ingest/un-transcripts.ts';
import { groupWeek } from '../engine/ingest/week.ts';
import { indexFixture, realFetch, routeFetch } from './support/fake-un.ts';

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('recorded index for 2–8 Nov 2026 groups into the expected bodies', async () => {
  routeFetch({ 'meetings.json': indexFixture() });
  const week = groupWeek(await fetchIndex('2026-11-02', '2026-11-08'), '2026-11-12');
  const counts = Object.fromEntries(week.bodies.map((b) => [b.body, b.eligible.length]));
  assert.deepEqual(counts, {
    security_council: 5,
    ga_plenary: 5,
    ga_c1: 2,
    ga_c2: 0,
    ga_c3: 4,
    ga_c4: 5,
    ga_c5: 2,
    ga_c6: 6,
  });
  assert.equal(week.totalEntries, 88);
  assert.deepEqual(week.unrecognised, []);
});

test('pending, future and mislabelled meetings are not eligible', () => {
  const base = { date: '2026-11-10T00:00:00.000Z', duration: '01:00:00', hasTranscript: true };
  const window = {
    from: '2026-11-09',
    to: '2026-11-15',
    totalEntries: 4,
    unrecognised: [],
    meetings: [
      { ...base, slug: 'sc/1', body: 'Security Council' },
      { ...base, slug: 'sc/2', body: 'Security Council', hasTranscript: false },
      { ...base, slug: 'sc/3', body: 'Security Council', date: '2026-11-13T00:00:00.000Z' },
      { ...base, slug: 'ga/c2/99/1', body: 'Third Committee' },
    ].map((m) => normaliseIndexMeeting(m)!),
  };
  const week = groupWeek(window, '2026-11-12');
  const sc = week.bodies.find((b) => b.body === 'security_council')!;
  assert.deepEqual(
    sc.eligible.map((m) => m.id),
    ['sc/1'],
  );
  assert.deepEqual(
    sc.pending.map((m) => m.id),
    ['sc/2'],
  );
  assert.deepEqual(
    week.labelMismatches.map((m) => m.id),
    ['ga/c2/99/1'],
  );
});

test('index pages are followed until hasMore is false', async () => {
  const log: string[] = [];
  let page = 0;
  globalThis.fetch = (async (url: string) => {
    log.push(String(url));
    page++;
    return Response.json({
      meetings: [{ slug: 'sc/' + page, date: '2026-11-10', hasTranscript: true }],
      hasMore: page < 3,
    });
  }) as typeof fetch;
  const window = await fetchIndex('2026-11-09', '2026-11-15');
  assert.equal(log.length, 3);
  assert.deepEqual(
    window.meetings.map((m) => m.id),
    ['sc/1', 'sc/2', 'sc/3'],
  );
});
