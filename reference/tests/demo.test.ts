// The keyless demo (cli/demo.ts): the real engine on invented meetings with a scripted model.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDemo, DEMO_MEETINGS } from '../cli/demo.ts';

test('the demo works one meeting of each level, with no key and no network', async () => {
  const { mission, run } = await buildDemo();
  assert.equal(run.outcome, 'completed');
  const files = mission.db.prepare('SELECT meeting_id, level, status FROM files ORDER BY meeting_id').all();
  assert.deepEqual(
    files.map((f) => [f.meeting_id, f.level, f.status]),
    [
      ['ga/81/50', 'note', 'noted'],
      ['ga/c2/81/20', 'report', 'reported'],
      ['ga/c3/81/40', 'full_file', 'adopted'],
    ],
  );
  assert.deepEqual(Object.keys(DEMO_MEETINGS).sort(), files.map((f) => f.meeting_id as string).sort());
  const kinds = mission.db
    .prepare(
      "SELECT DISTINCT kind FROM documents WHERE file_id = (SELECT id FROM files WHERE meeting_id = 'ga/c3/81/40')",
    )
    .all()
    .map((d) => d.kind);
  for (const kind of ['report', 'opinion', 'options_memo', 'decision', 'cable', 'press'])
    assert.ok(kinds.includes(kind), kind);
});
