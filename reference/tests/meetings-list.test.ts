// The Meetings list (2026-11-16): text cut at a word, two lines at most,
// one plain state per line with the cable mark beside it, meetings in
// preparation last in their day, topics from stored work, repeated topics with
// the meeting number, and one sentence of context linking to About.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runOnce } from '../engine/run/run.ts';
import { reworkFile } from '../engine/work/reopen.ts';
import { clip, meeting, topic, weekMeetings } from '../web/data.ts';
import { describe, LINE_CHARS, meetingsPage, ordered, weekTopics } from '../web/pages/meetings.ts';
import { addMeeting, scripted, fakeLlm, services } from './support/world.ts';

test('clip: never in the middle of a word, with an ellipsis, within the limit', () => {
  const s =
    'The State backs the longer survey mission and will ask the Committee for steady funding and staffing of the river monitors, a public ledger of every flood warning, and open roads for the relief convoys in the wet season';
  for (const max of [40, 80, 150, 199]) {
    const c = clip(s, max);
    assert.ok(c.endsWith('…'), c);
    assert.ok(c.length <= max + 1, `${c.length} > ${max + 1}`);
    const kept = c.slice(0, -1);
    assert.ok(s.startsWith(kept), c);
    assert.ok(s[kept.length] === ' ' || s[kept.length] === ',', `cut inside a word: "${c}"`);
  }
  assert.equal(clip('Short enough.', 80), 'Short enough.');
  assert.equal(clip('One, two, three four', 10), 'One, two…');
});

async function world() {
  const s = services(fakeLlm(scripted()));
  for (const [slug, date] of [
    ['ga/c4/99/25', '2026-11-13'],
    ['ga/c4/99/26', '2026-11-13'],
    ['ga/c3/99/40', '2026-11-12'],
  ] as const)
    addMeeting(s.db, slug, { date });
  await runOnce(s, { trigger: 'manual', maxMinutes: 5, maxCalls: 200, ingest: false });
  // Generic UN titles, as in the index.
  for (const id of ['ga/c4/99/25', 'ga/c4/99/26', 'ga/c3/99/40', 'ga/c5/99/11'])
    s.db
      .prepare('UPDATE meetings SET title = ? WHERE id = ?')
      .run(`Committee, ${id.split('/').pop()}th plenary meeting - General Assembly, 99th session`, id);
  return s;
}

test('one plain state per line; in preparation last in its day; topics from stored work; repeats numbered', async () => {
  const s = await world();
  // A reprocessed file: its new report is not written yet, the earlier one gave the topic.
  reworkFile(s.db, 'ga/c4/99/25', 'reprocess', true);
  // A new meeting with no work at all: the generic UN title stays.
  addMeeting(s.db, 'ga/c5/99/11', { date: '2026-11-13' });
  s.db
    .prepare('UPDATE meetings SET title = ? WHERE id = ?')
    .run('Fifth Committee, 11th plenary meeting - General Assembly, 99th session', 'ga/c5/99/11');
  const m = (id: string) => meeting(s.db, id)!;
  assert.deepEqual(describe(s.db, m('ga/c4/99/26')).state, 'Report');
  assert.deepEqual(describe(s.db, m('ga/c4/99/25')), { cls: 'prep', what: '', state: 'In preparation' });
  assert.equal(describe(s.db, m('ga/c5/99/11')).state, 'In preparation');
  assert.equal(topic(s.db, m('ga/c4/99/25')), 'Debate on the test situation');
  assert.equal(topic(s.db, m('ga/c5/99/11')), 'Fifth Committee, 11th meeting'); // a committee meeting is not plenary (2026-11-25)

  const rows = ordered(weekMeetings(s.db, '2026-11-09'));
  assert.deepEqual(
    rows.map((r) => r.id),
    ['ga/c4/99/26', 'ga/c5/99/11', 'ga/c4/99/25', 'ga/c3/99/40'],
  );
  const topics = weekTopics(s.db, rows);
  assert.equal(topics.get('ga/c4/99/26'), '26th meeting: Debate on the test situation');
  assert.equal(topics.get('ga/c3/99/40'), '40th meeting: Debate on the test situation');
  assert.equal(topics.get('ga/c5/99/11'), 'Fifth Committee, 11th meeting');

  const page = meetingsPage(s.db, '2026-11-09').value;
  assert.doesNotMatch(page, /In progress\.|Queued|Full file/);
  assert.match(page, /<p class="context">\s*A fictional Permanent Mission, run by AI agents[\s\S]*href="\/about"/);
  // Every line has the state and the cable slot in the same place.
  const states = [
    ...page.matchAll(/<span class="state"\s*><span class="label">([^<]+)<\/span\s*><span class="cable"/g),
  ];
  assert.equal(states.length, 4);
  assert.deepEqual(
    states.map((x) => x[1]),
    ['Report', 'In preparation', 'In preparation', 'Report'],
  );
  assert.equal([...page.matchAll(/class="row prep"/g)].length, 2);
});

test('a long position keeps to two lines: two lengths, each cut at a word', async () => {
  const { twoLines } = await import('../web/pages/meetings.ts');
  const long = 'word '.repeat(60).trim();
  const out = twoLines(long, LINE_CHARS.what).value;
  const wide = /<span class="wide">([^<]+)<\/span>/.exec(out)?.[1] ?? '';
  const narrow = /<span class="narrow">([^<]+)<\/span>/.exec(out)?.[1] ?? '';
  assert.ok(wide.length <= LINE_CHARS.what.wide + 1 && wide.endsWith('word…'));
  assert.ok(narrow.length <= LINE_CHARS.what.narrow + 1 && narrow.endsWith('word…'));
  assert.equal(twoLines('Short.', LINE_CHARS.what).value, 'Short.');
});
