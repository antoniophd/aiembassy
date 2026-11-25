// The dossier mark follows the State's line, not the groups (2026-11-23).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coincidesNote, lineMark, lineMarkFailures, textsOf } from '../engine/check/line-mark.ts';

const vw = (...texts: string[]) => texts.map((text) => ({ text, states: [] }));
// Two pairs of decisions (position, vote, texts): in each, the later file acts on other texts with the same vote.
const a1 = {
  position:
    'At the plenary the State backs, with a yes, the texts on literacy, maternal health, rural schooling and the enlarged board, and abstains on the amended text on archives.',
  vote: 'in favour' as const,
  would_have_voted: null,
  voted_with: vw('L.22', 'L.2 as amended'),
};
const a2 = {
  position: 'The State backs, with a yes, all three texts as the plenary adopted them.',
  vote: 'in favour' as const,
  would_have_voted: 'Its yes would have gone to L.3/Rev.2, L.11/Rev.2 and L.19/Rev.2 as adopted.',
  voted_with: vw('L.19/Rev.2'),
  change: 'revises' as const,
  line_change: null,
};
const b1 = {
  position:
    'At the plenary the State gives a yes to the Arvenia and Belmora texts and abstains on the Corvalia and Dravonia texts.',
  vote: 'in favour' as const,
  would_have_voted: null,
  voted_with: vw('L.42/Rev.1', 'L.40', 'L.38', 'L.39'),
};
const b2 = {
  position: 'At the plenary the State will give a yes to the Elbaria text sent on by the Committee.',
  vote: 'in favour' as const,
  would_have_voted: 'Its yes would have gone to the Elbaria text as sent on by the Committee.',
  voted_with: vw('L.41'),
  change: 'revises' as const,
  line_change: null,
};

test('other texts, the same line: "maintains", whatever the groups', () => {
  for (const [prev, cur] of [
    [a1, a2],
    [b1, b2],
  ] as const) {
    const m = lineMark(prev, cur);
    assert.equal(m.change, 'maintains');
    assert.equal(m.change_basis, 'code: other texts, same vote');
    assert.deepEqual(lineMarkFailures(m), []);
  }
  assert.deepEqual([...textsOf(a2)].sort(), ['L.11/Rev.2', 'L.19/Rev.2', 'L.3/Rev.2']);
  // The groups changed: said apart, in one sentence, not in the mark.
  assert.equal(
    coincidesNote(['Highland Forum', 'Meridian Group'], ['Coastal Group', 'Highland Forum']),
    'This time it coincides with Coastal Group and Highland Forum (before: with Highland Forum and Meridian Group).',
  );
  assert.equal(
    coincidesNote(['national capacity'], ['Highland Forum', 'Group of Nine']),
    'This time it coincides with Highland Forum and Group of Nine (before: it acted in national capacity).',
  );
  assert.equal(coincidesNote(['Coastal Group'], ['coastal group']), null);
});

test('another vote on the same text: "revises", with what changed in the line', () => {
  const before = {
    position: 'The State votes in favour of L.5.',
    vote: 'in favour' as const,
    would_have_voted: null,
    voted_with: vw('L.5'),
  };
  const now = {
    position: 'The State abstains on L.5 as revised.',
    vote: 'abstain' as const,
    would_have_voted: null,
    voted_with: vw('L.5'),
    change: 'maintains' as const,
    line_change: null,
  };
  const m = lineMark(before, now);
  assert.equal(m.change, 'revises');
  assert.equal(m.change_basis, 'code: same text, other vote');
  assert.equal(m.line_change, 'It now votes abstain on L.5, where it voted in favour.');
  assert.deepEqual(lineMarkFailures(m), []);
});

test('when the record does not decide it, the decision\'s mark stands; "revises" must say what changed', () => {
  const plain = {
    position: 'The State presses for full funding of the mission.',
    vote: null,
    would_have_voted: null,
    voted_with: [],
  };
  const rev = lineMark(plain, { ...plain, change: 'revises' as const, line_change: null });
  assert.equal(rev.change_basis, 'decision');
  assert.equal(lineMarkFailures(rev).length, 1);
  const said = lineMark(plain, {
    ...plain,
    change: 'revises' as const,
    line_change: 'It now asks for a drawdown conditioned on benchmarks, where it asked for a plain renewal.',
  });
  assert.deepEqual(lineMarkFailures(said), []);
  // No earlier decision: nothing is changed here ("first" is set by markChange).
  assert.equal(lineMark(null, { ...plain, change: 'first' as const }).change, 'first');
});
