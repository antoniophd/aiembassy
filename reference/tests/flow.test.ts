// The workflow figure on About (2026-11-23).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FLOW_ALT, FLOW_BARS, FLOW_CAPTION, FLOW_STEPS, flowFigure } from '../web/pages/flow.ts';
import { missionPage } from '../web/pages/mission.ts';

test('About shows the flow after the first paragraph, before How it works, with its text alternative', () => {
  assert.deepEqual(
    FLOW_STEPS.map((s) => s.name),
    ['UN meeting', 'Triage', 'Report', 'Opinions', 'Options', 'Decision', 'Cable'],
  );
  assert.deepEqual(
    FLOW_STEPS.map((s) => s.who),
    [
      'Public transcript',
      'Deputy',
      'Counsellor',
      'Other counsellors',
      'Deputy',
      'Permanent Representative',
      'To the capital',
    ],
  );
  const page = missionPage().value;
  const first = page.indexOf('Every position the Mission adopts must follow from this page.');
  const fig = page.indexOf('<figure class="flow"');
  assert.ok(first > 0 && fig > first && fig < page.indexOf('How it works'));
  const f = flowFigure().value;
  assert.match(f, /<figure class="flow" aria-labelledby="flow-alt">/);
  assert.match(f, /<p id="flow-alt" class="visually-hidden">How a meeting is worked/);
  assert.match(f, /class="flow-body" aria-hidden="true"/);
  assert.match(f, /flow-step origin[\s\S]*UN meeting/);
  assert.match(f, /flow-step decision[\s\S]*Decision/);
  // Bars span the steps they reach: triage (1–2), report (1–3, plus the cable), the full file (1–7).
  assert.deepEqual(
    FLOW_BARS.map((b) => [b.from, b.to, b.extra]),
    [
      [1, 2, null],
      [1, 3, 7],
      [1, 7, null],
    ],
  );
  assert.match(f, /--from:1;--to:3;--row:1/);
  assert.match(f, /--from:7;--to:8;--row:2/);
  assert.match(f, new RegExp(FLOW_CAPTION.replace(/\./g, '\\.')));
  for (const s of [...FLOW_STEPS.map((x) => x.name), ...FLOW_BARS.map((b) => b.text)])
    assert.ok(FLOW_ALT.includes(s), 'alt names ' + s);
  assert.doesNotMatch(f, /deepseek|kimi|mistral|glm|model/i);
});
