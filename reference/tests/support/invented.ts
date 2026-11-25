// Invented data for the tests (2026-11-24): no real country, meeting, document symbol or sentence of a
// real transcript. The States and groups below do not exist; they are registered with the engine so that its
// checks treat them as delegations and groups, as a mission following another forum would register its own.
import { extendGroups } from '../../engine/check/groups.ts';
import { extendMemberStates } from '../../engine/check/member-states.ts';
import { validateProfile, type StateProfile } from '../../engine/profile/index.ts';

/** Invented States, labelled as the source labels a delegation. */
export const STATES = [
  'Arvenia',
  'Belmora',
  'Corvalia',
  'Dravonia',
  'Elbaria',
  'Ferrania',
  'Galdovia',
  'Halvoria',
  'Istrena',
  'Jandora',
  'Kestavia',
  'Lumeria',
  'Morvania',
  'Norvessa',
  'Pellaria',
  'Quintara',
  'Rovinia',
  'Tarvonia',
  // A name with "and" in it, as some real ones have: lists of States must not split it in two.
  'Vell and Morra',
] as const;

/** Invented groups and how each shows up in a transcript (a speaker label, or "on behalf of …"). */
export const GROUPS = {
  'Coastal Group': { label: /\bCoastal Group\b/i, behalf: /\bCoastal Group\b/i },
  'Meridian Group': { label: /\bMeridian Group\b/i, behalf: /\bMeridian Group\b/i },
  'Group of Nine': { label: /\b(Group of Nine|G-?9)\b/i, behalf: /\b(Group of Nine|G-?9)\b/i },
  'Union of Lakeland States': {
    label: /\bUnion of Lakeland States\b|\bULS\b/,
    behalf: /\b(Union of Lakeland States|ULS)\b/,
  },
  'Highland Forum': {
    label: /\bHighland Forum\b/,
    behalf: /\bHighland Forum\b|Arvenia, Belmora,? and Corvalia/i,
  },
};

extendMemberStates(STATES);
extendGroups(GROUPS);

/** An invented State profile: the same shape as profile/state.json, with its own words. */
export const TEST_PROFILE: StateProfile = validateProfile({
  id: 'state-profile',
  version: '9.0.0',
  name: 'the State',
  naming_rule: 'It is always "the State"; nothing is said of where it lies.',
  traits: {
    weight: 'A small State that relies on rules being kept.',
    economy: 'Lives from trade.',
    security: 'In no alliance and no bloc.',
    at_the_un: 'A member of the Assembly; not a member of the Council.',
  },
  interests: [
    { id: 'I1', rank: 1, text: 'Borders respected and the integrity of every State.' },
    { id: 'I2', rank: 2, text: 'International bodies that decide and deliver.' },
    { id: 'I3', rank: 3, text: 'Safety of civilians and access for relief.' },
    { id: 'I4', rank: 4, text: 'Free trade and open sea lanes.' },
    { id: 'I5', rank: 5, text: 'Adapting to a changing climate, and paying for it.' },
    { id: 'I6', rank: 6, text: 'Common rules for new technologies.' },
  ],
  conflict_rule: 'When two interests clash, the higher one wins, and the decision names it.',
  red_lines: [
    { id: 'R1', text: 'Does not accept borders changed by force.' },
    { id: 'R2', text: 'Does not vote against access for relief.' },
    { id: 'R3', text: 'Does not judge the substance of a quarrel between other States; it speaks for the rule.' },
    { id: 'R4', text: 'Does not join a group statement against a higher interest.' },
  ],
  alignment: {
    rule: 'The State speaks in its own name; in a meeting it may share the stance of any group that argues the same thing.',
    known_groups: ['national capacity', ...Object.keys(GROUPS)],
  },
  behaviour: ['Prefers consensus.', 'Stays silent when it has no interest.'],
});
