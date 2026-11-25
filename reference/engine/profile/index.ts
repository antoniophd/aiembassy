// The State profile and the team, loaded from versioned data files in
// profile/ and validated on load. Every file records the versions it used.
import { readFileSync } from 'node:fs';
import { BODIES, type Body } from '../ingest/scope.ts';

export interface StateProfile {
  id: 'state-profile';
  version: string;
  interests: { id: string; rank: number; text: string }[];
  red_lines: { id: string; text: string }[];
  alignment: { rule?: string; known_groups: string[] };
  behaviour?: string[];
  conflict_rule?: string;
  [key: string]: unknown;
}

export interface Team {
  id: 'team';
  version: string;
  roles: { id: string; title: string; function: string; writes: string[] }[];
  rule?: string;
  lead_by_body: Record<Body, string | null>;
  [key: string]: unknown;
}

const PROFILE_DIR = new URL('../../profile/', import.meta.url);
const SEMVER = /^\d+\.\d+\.\d+$/;

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, PROFILE_DIR), 'utf8'));
}

function fail(file: string, problem: string): never {
  throw Error('Invalid ' + file + ': ' + problem);
}

export function validateProfile(p: StateProfile): StateProfile {
  if (p.id !== 'state-profile' || !SEMVER.test(p.version)) fail('state profile', 'id or version');
  const ranks = p.interests.map((i) => i.rank);
  if (ranks.some((r, i) => r !== i + 1)) fail('state profile', 'interests must be ranked 1..n in order');
  const ids = [...p.interests.map((i) => i.id), ...p.red_lines.map((r) => r.id)];
  if (new Set(ids).size !== ids.length) fail('state profile', 'duplicate interest or red line id');
  if (!p.alignment.known_groups.includes('national capacity'))
    fail('state profile', '"national capacity" must be a known group');
  return p;
}

export function validateTeam(t: Team): Team {
  if (t.id !== 'team' || !SEMVER.test(t.version)) fail('team', 'id or version');
  const roles = new Set(t.roles.map((r) => r.id));
  if (roles.size !== 6) fail('team', 'exactly six roles expected');
  for (const body of BODIES) {
    if (!(body in t.lead_by_body)) fail('team', 'no lead entry for ' + body);
    const lead = t.lead_by_body[body];
    if (lead !== null && !roles.has(lead)) fail('team', 'unknown lead ' + lead);
  }
  return t;
}

export const loadProfile = (): StateProfile => validateProfile(readJson('state.json') as StateProfile);
export const loadTeam = (): Team => validateTeam(readJson('team.json') as Team);

/** True when `group` may be used in stands_with. */
export function isKnownGroup(profile: StateProfile, group: string): boolean {
  return profile.alignment.known_groups.some((g) => g.toLowerCase() === group.trim().toLowerCase());
}
