import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isKnownGroup, loadProfile, loadTeam, validateProfile } from '../engine/profile/index.ts';
import { TEST_PROFILE } from './support/invented.ts';

// The profile file is the mission's own (a published copy carries a generic example): its structure is checked
// here, never its wording.
test('the State profile and team load and validate', () => {
  const p = loadProfile();
  const t = loadTeam();
  assert.ok(p.interests.length >= 1);
  assert.deepEqual(
    p.interests.map((i) => i.rank),
    p.interests.map((_, i) => i + 1),
  );
  assert.ok(p.red_lines.length >= 1);
  for (const x of [...p.interests, ...p.red_lines]) assert.ok(x.id && x.text, JSON.stringify(x));
  assert.equal(new Set(p.interests.map((i) => i.id)).size, p.interests.length);
  assert.equal(new Set(p.red_lines.map((r) => r.id)).size, p.red_lines.length);
  assert.equal(TEST_PROFILE.interests.length, 6);
  assert.equal(TEST_PROFILE.red_lines.length, 4);
  assert.equal(t.roles.length, 6);
  assert.equal(t.lead_by_body.ga_c6, 'legal');
  assert.equal(t.lead_by_body.ga_c5, 'economic');
  assert.equal(t.lead_by_body.ga_plenary, null);
});

test('stands_with must be a known group', () => {
  assert.ok(isKnownGroup(TEST_PROFILE, 'National capacity'));
  assert.ok(isKnownGroup(TEST_PROFILE, 'Coastal Group'));
  assert.ok(!isKnownGroup(TEST_PROFILE, 'The Avengers'));
  // The mission's profile: every group it lists is known, and "national capacity" always is.
  const p = loadProfile();
  assert.ok(isKnownGroup(p, 'National capacity'));
  for (const g of p.alignment.known_groups) assert.ok(isKnownGroup(p, g), g);
});

test('interests out of rank order are refused', () => {
  for (const p of [loadProfile(), TEST_PROFILE]) {
    const broken = { ...p, interests: [...p.interests].reverse() };
    assert.throws(() => validateProfile(broken), /ranked/);
  }
});
