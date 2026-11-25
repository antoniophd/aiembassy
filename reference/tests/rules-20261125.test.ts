// Decisions of 2026-11-25 on the group and timing rules, with invented data:
// (1) the group rule sees every segment where a group spoke, not the first four;
// (2) the timing check reads whole sentences (never cut at a semicolon) and marks only proposals to act on a
//     point already voted, not a description that contains the word "vote";
// (3) a member named in voted_with or stands_with that did not speak, because another delegation spoke on its
//     behalf, is rejected with: name the delegation that spoke and the group on whose behalf it did.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDecision } from '../engine/check/decision.ts';
import { checkStandsWith, checkVotedWith, groupsInMeeting, type SegmentLike } from '../engine/check/groups.ts';
import { staleProposals } from '../engine/check/timing.ts';
import { TEST_PROFILE } from './support/invented.ts';
import { goodDecision } from './support/world.ts';

const speech = (label: string, t: number, speaker: string, text: string): SegmentLike => ({
  label,
  text: `[${t}s] ${text}`,
  speakers: [{ start: t, end: t + 30, label: speaker }],
});

test('the group rule sees every segment where a group spoke, also after the fourth', () => {
  const segments = [1, 2, 3, 4, 5, 6].map((i) =>
    speech(`E${i}`, i * 100, 'Arvenia', 'I speak on behalf of the Coastal Group on the draft before us.'),
  );
  const evidence = groupsInMeeting(segments, TEST_PROFILE);
  const coastal = evidence.find((e) => e.group === 'Coastal Group');
  assert.deepEqual(
    coastal?.segments.map((s) => s.label),
    ['E1', 'E2', 'E3', 'E4', 'E5', 'E6'],
  );
  // A decision that cites the group's sixth statement passes the cite rule.
  const d = parseDecision(
    goodDecision({
      stands_with: ['Coastal Group'],
      group_positions: [{ group: 'Coastal Group', cite: 'E6', position: 'It supports the draft.', same: true }],
    }),
  );
  assert.deepEqual(
    checkStandsWith(d, evidence).filter((x) => /Coastal Group is cited/.test(x)),
    [],
  );
});

test('timing: whole sentences, only proposals to act on what was already voted', () => {
  // The words of a statement, with "vote" as a noun after a semicolon: not a proposal.
  assert.deepEqual(
    staleProposals(
      'The State says once that the Assembly must act on its committee work; a divided vote is not settled consensus; financing must stay open.',
      'plenary',
    ),
    [],
  );
  // A proposal after a semicolon is still read, in its whole sentence.
  const s = 'The State welcomes the outcome; it will abstain on L.5 again.';
  assert.deepEqual(staleProposals(s, 'plenary'), [s]);
  // Named forum: the next step, not the past one.
  assert.deepEqual(
    staleProposals('Vote in favour of L.5 in the plenary; a split vote is not consensus.', 'plenary'),
    [],
  );
  assert.equal(staleProposals('Co-sponsor the draft.', 'plenary').length, 1);
});

const onBehalf = [
  speech(
    'E3',
    300,
    'Arvenia · Permanent Representative',
    'I speak on behalf of Belmora, Corvalia and Arvenia. We will vote in favour.',
  ),
];

test('voted_with: a member that did not speak; the rejection names who spoke and for which group', () => {
  const f = checkVotedWith(
    { voted_with: [{ text: 'L.5', states: [{ state: 'Corvalia', cite: 'E3', note: null }] }] },
    [{ delegation: 'Arvenia', cites: ['E3'] }],
    onBehalf,
  );
  assert.equal(f.length, 1);
  assert.match(f[0]!, /^voted_with: Corvalia did not speak; Arvenia spoke on its behalf in E3/);
  assert.match(f[0]!, /on behalf of Belmora, Corvalia and Arvenia/);
  assert.match(f[0]!, /name the delegation that spoke, Arvenia, and the group on whose behalf it did/);
  // The speaker itself still passes.
  assert.deepEqual(
    checkVotedWith(
      { voted_with: [{ text: 'L.5', states: [{ state: 'Arvenia', cite: 'E3', note: null }] }] },
      [{ delegation: 'Arvenia', cites: ['E3'] }],
      onBehalf,
    ),
    [],
  );
  // Someone nobody spoke for keeps the plain message.
  assert.match(
    checkVotedWith(
      { voted_with: [{ text: 'L.5', states: [{ state: 'Ferrania', cite: 'E3', note: null }] }] },
      [],
      onBehalf,
    ).join(),
    /Ferrania \[E3\] is not a position in the meeting report/,
  );
});

test('stands_with: a member that did not speak; the rejection names who spoke and for which group', () => {
  const d = parseDecision(
    goodDecision({
      stands_with: ['Belmora'],
      group_positions: [{ group: 'Belmora', cite: 'E3', position: 'It votes in favour.', same: true }],
    }),
  );
  const f = checkStandsWith(d, groupsInMeeting(onBehalf, TEST_PROFILE), onBehalf).join('\n');
  assert.match(
    f,
    /stands_with: Belmora did not speak; Arvenia spoke on its behalf in E3 \("on behalf of Belmora, Corvalia and Arvenia[^"]*"\): name the delegation that spoke, Arvenia, and the group on whose behalf it did/,
  );
});
