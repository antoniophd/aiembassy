// The Meetings layout (2026-11-24): the week is chosen only in its list (no arrows beside it, no "Earlier"
// section); the title is never cut by characters and carries the whole text for hover; date and body share one
// column, the body under the date.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runOnce } from '../engine/run/run.ts';
import { meetingsPage } from '../web/pages/meetings.ts';
import { addMeeting, scripted, fakeLlm, services } from './support/world.ts';

const LONG =
  'Interactive dialogue with the Panel of Inquiry on the drained marshes of the Vandrel Basin, joined by its Special Rapporteur, then by the Group of Experts on mountain pasture rights in the Kelvar uplands';

test('Meetings: no week arrows, no Earlier, whole titles with their text on hover, body under the date', async () => {
  const s = services(fakeLlm(scripted()));
  addMeeting(s.db, 'ga/c3/99/40', { date: '2026-11-12' });
  addMeeting(s.db, 'ga/c3/99/30', { date: '2026-11-03' });
  await runOnce(s, { trigger: 'manual', maxMinutes: 5, maxCalls: 200, ingest: false });
  // The title of the report, as stored work names the meeting; the file in no dossier, so this title is shown.
  s.db.prepare('UPDATE files SET dossier_id = NULL WHERE meeting_id = ?').run('ga/c3/99/40');
  s.db
    .prepare(
      "UPDATE documents SET body_json = json_set(body_json, '$.title', ?) WHERE kind = 'report' AND file_id IN (SELECT id FROM files WHERE meeting_id = ?)",
    )
    .run(LONG, 'ga/c3/99/40');

  const page = meetingsPage(s.db, '2026-11-09').value;
  assert.doesNotMatch(page, /class="arrow"|Previous week|Next week|[‹›]/);
  assert.doesNotMatch(page, /Earlier/);
  // Both weeks are in the selector, newest first.
  const weeks = [...page.matchAll(/href="\/meetings\?week=([\d-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(weeks, ['2026-11-09', '2026-11-02']);
  // One column for date and body.
  assert.match(page, /<span class="when">Thu, Nov 12<span class="body">Third Committee<\/span><\/span\s*>/);
  // The title whole, never with a character cut, and in the hover text.
  const topic = /<span class="topic" title="([^"]*)">([^<]*)<\/span/.exec(page);
  assert.ok(topic, 'topic span');
  assert.equal(topic[1], topic[2]);
  assert.equal(topic[2], LONG);
  assert.doesNotMatch(topic[2] ?? '', /…/);
});
