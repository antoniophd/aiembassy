import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTeam } from '../engine/profile/index.ts';
import { applyTriageRules, TriageOutputError, type TriageFacts } from '../engine/work/triage-rules.ts';
import { TEST_PROFILE } from './support/invented.ts';
import { goodTriage } from './support/world.ts';

const profile = TEST_PROFILE;
const team = loadTeam();
const facts = (f: Partial<TriageFacts> = {}): TriageFacts => ({
  body: 'security_council',
  durationSeconds: 3600,
  speakers: 12,
  dossierIds: ['dossier:valley'],
  duplicateCandidates: [],
  identicalTranscriptOf: null,
  ...f,
});

test('meetings under five minutes are notes', () => {
  const t = applyTriageRules(goodTriage('report'), facts({ durationSeconds: 200 }), profile, team);
  assert.equal(t.level, 'note');
  assert.match(t.adjustments.join(), /under 5 minutes/);
});

test('short meetings with few speakers, and meetings marked procedural, are notes', () => {
  const short = applyTriageRules(goodTriage('report'), facts({ durationSeconds: 900, speakers: 3 }), profile, team);
  assert.equal(short.level, 'note');
  assert.match(short.adjustments.join(), /under 20 minutes with 3 speakers/);
  const busy = applyTriageRules(goodTriage('report'), facts({ durationSeconds: 900, speakers: 9 }), profile, team);
  assert.equal(busy.level, 'report');
  const marked = applyTriageRules(goodTriage('full_file', { procedural: true }), facts(), profile, team);
  assert.equal(marked.level, 'note');
  assert.match(marked.adjustments.join(), /procedural/);
});

test('a full file must name a listed interest or red line', () => {
  const raw = goodTriage('full_file', { engaged: { interests: ['I9'], red_lines: [] } });
  assert.equal(applyTriageRules(raw, facts(), profile, team).level, 'report');
  const ok = applyTriageRules(goodTriage('full_file'), facts(), profile, team);
  assert.equal(ok.level, 'full_file');
  assert.deepEqual(ok.engaged.interests, ['I3']);
});

test('a full file must name a decision point', () => {
  const t = applyTriageRules(goodTriage('full_file', { decision_point: null }), facts(), profile, team);
  assert.equal(t.level, 'report');
  assert.match(t.adjustments.join(), /no decision point/);
});

test('the lead is fixed by body; the plenary lead is chosen by subject', () => {
  assert.equal(
    applyTriageRules(goodTriage('report', { lead: 'economic' }), facts({ body: 'ga_c6' }), profile, team).lead,
    'legal',
  );
  assert.equal(
    applyTriageRules(goodTriage('report', { lead: 'economic' }), facts({ body: 'ga_plenary' }), profile, team).lead,
    'economic',
  );
  assert.throws(
    () => applyTriageRules(goodTriage('report', { lead: 'press' }), facts({ body: 'ga_plenary' }), profile, team),
    TriageOutputError,
  );
  const dpr = applyTriageRules(goodTriage('report', { lead: 'dpr' }), facts({ body: 'ga_plenary' }), profile, team);
  assert.equal(dpr.level, 'note');
});

test('Security Council full files on force, sanctions or the Charter get a legal opinion', () => {
  const t = applyTriageRules(
    goodTriage('full_file', { involves_force_sanctions_charter: true }),
    facts(),
    profile,
    team,
  );
  assert.deepEqual(t.opinions, ['legal']);
  const other = applyTriageRules(goodTriage('full_file', { opinions: ['political'] }), facts(), profile, team);
  assert.deepEqual(other.opinions, ['legal'], 'the lead cannot give the extra opinion; another desk is added');
});

test('notes and reports carry no opinions, press or dossier', () => {
  const t = applyTriageRules(
    goodTriage('report', { opinions: ['legal'], press: { flag: true, reason: 'x' } }),
    facts(),
    profile,
    team,
  );
  assert.deepEqual([t.opinions, t.press, t.dossier.id, t.dossier.newTitle], [[], false, null, null]);
});

test('duplicate_of must be a candidate; identical transcripts are always duplicates', () => {
  const raw = goodTriage('report', { duplicate_of: 'sc/1' });
  assert.equal(applyTriageRules(raw, facts(), profile, team).duplicateOf, null);
  assert.equal(applyTriageRules(raw, facts({ duplicateCandidates: ['sc/1'] }), profile, team).duplicateOf, 'sc/1');
  const forced = applyTriageRules(
    goodTriage(),
    facts({ duplicateCandidates: ['sc/2'], identicalTranscriptOf: 'sc/2' }),
    profile,
    team,
  );
  assert.equal(forced.duplicateOf, 'sc/2');
});

test('invalid output is refused', () => {
  assert.throws(() => applyTriageRules({ level: 'big' }, facts(), profile, team), TriageOutputError);
  assert.throws(
    () => applyTriageRules(goodTriage('full_file', { dossier: {} }), facts(), profile, team),
    TriageOutputError,
  );
});
