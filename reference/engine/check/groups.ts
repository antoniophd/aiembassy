// Who spoke for which group in a meeting, and the stands_with rule (DESIGN
// § 3, check 5): a decision names the known groups that defended in the
// meeting the position the State adopts, each with its segment; "national
// capacity" only when none did or the State departs from all of them.
// Pure: no model.
import type { Body } from '../ingest/scope.ts';
import type { StateProfile } from '../profile/index.ts';
import type { Decision } from './decision.ts';
import { speaksForStates } from './member-states.ts';

export const NATIONAL = 'national capacity';

interface Span {
  start: number;
  end: number;
  label: string;
}
export interface SegmentLike {
  label: string;
  text: string;
  speakers: Span[];
}

/** How each group shows up in a transcript: a speaker label, or "on behalf of …". */
const PATTERNS: Record<string, { label: RegExp; behalf: RegExp }> = {
  'G77 and China': { label: /\b(G-?77|Group of 77)\b/i, behalf: /\b(G-?77|Group of 77)\b/i },
  'European Union': { label: /\bEuropean Union\b|\bEU\b/, behalf: /\b(European Union|EU)\b/ },
  CANZ: {
    label: /\bCANZ\b/,
    behalf: /\bCANZ\b|Canada, Australia,? and New Zealand|Australia, New Zealand,? and (my own country, )?Canada/i,
  },
  'United States': { label: /^United States\b/i, behalf: /^$/ },
  'Non-Aligned Movement': { label: /Non-Aligned/i, behalf: /Non-Aligned/i },
  'African Group': { label: /\bAfrican Group\b/i, behalf: /\bAfrican Group\b/i },
  'Arab Group': { label: /\bArab Group\b/i, behalf: /\bArab Group\b/i },
  'Organisation of Islamic Cooperation': {
    label: /Islamic Cooperation|\bOIC\b/i,
    behalf: /Islamic Cooperation|\bOIC\b/,
  },
  'Alliance of Small Island States': { label: /Small Island States|\bAOSIS\b/i, behalf: /Small Island States|AOSIS/i },
  'Least Developed Countries': { label: /Least Developed Countries/i, behalf: /Least Developed Countries/i },
  'Landlocked Developing Countries': {
    label: /Landlocked Developing Countries/i,
    behalf: /Landlocked Developing Countries/i,
  },
};

/**
 * Adds groups, or replaces how one shows up (2026-11-24): a mission that follows another forum registers
 * its groups; the tests register invented ones. A group counts for a decision only if the State profile also
 * lists it in `alignment.known_groups`.
 */
export function extendGroups(groups: Record<string, { label: RegExp; behalf: RegExp }>): void {
  Object.assign(PATTERNS, groups);
}

const BEHALF = /on behalf of ([^.\n]{0,120})/gi;
const EXCERPT = 500;
/** Presiding officers and the secretariat: never a group, a briefer or a delegation position. */
// The office belongs to a body of the meeting ("1st Committee · Chair", "GA · President"); a delegation that
// chairs another body ("Arvenia · Chair of the 2025 meeting of a treaty body") is a delegation (2026-11-13).
// A bare "President" or "Chair" label is the presiding officer, never a delegation (2026-11-19).
export const OFFICERS =
  /^(\d+(st|nd|rd|th) Committee|(First|Second|Third|Fourth|Fifth|Sixth) Committee|GA|General Assembly|Security Council|SC|UN|United Nations)\b[^·]*·\s*(Chair|President|Secretary|Vice-Chair|Vice-President|Rapporteur)\b|^The (President|Chair)\b|^(Acting )?(President|Chair|Chairperson|Vice-President|Vice-Chair|Secretary)$|Secretariat/i;

/**
 * Secretariat officials who brief the Council: Under- and Assistant Secretaries-General, special
 * representatives and envoys ("UN Secretariat · ASG, <department> …", "UN · SRSG for <a mandate>",
 * "UN · Special Envoy of the SG for <a region>").
 */
const COUNCIL_OFFICIAL =
  /·.*\b(USG|ASG|SRSG|Under-Secretary-General|Assistant Secretary-General|Special Representative|Senior Representative|Special Envoy|Envoy|Special Coordinator)\b/i;

/**
 * Presiding officers and the secretariat serving the meeting (2026-11-16). In the Assembly and its
 * committees the exclusion covers the whole secretariat; in the Security Council, Secretariat officials
 * (USG, ASG, SRSG, envoys) are briefers, and only the President and the Secretary of the meeting are excluded.
 */
export function isOfficer(label: string, body?: Body | null): boolean {
  if (body === 'security_council' && COUNCIL_OFFICIAL.test(label)) return false;
  return OFFICERS.test(label);
}

/** Statement text of one speaker span (lines whose [Ns] stamp falls inside it). */
function spanText(seg: SegmentLike, span: Span): string {
  const text = seg.text
    .split('\n')
    .filter((line) => {
      const t = Number(/^\[(\d+)s\]/.exec(line)?.[1] ?? NaN);
      return t >= span.start && t <= span.end;
    })
    .join(' ')
    .replace(/\[\d+s\]\s*/g, '');
  // Opening and close of the statement: the vote or the ask is usually at the end.
  return text.length <= 2 * EXCERPT ? text : text.slice(0, EXCERPT) + ' … ' + text.slice(-EXCERPT);
}

export interface GroupEvidence {
  group: string;
  segments: { label: string; speaker: string; excerpt: string }[];
}

/** Known groups that took the floor (by label or "on behalf of"), with segment and excerpt. */
export function groupsInMeeting(segments: SegmentLike[], profile: StateProfile): GroupEvidence[] {
  const out: GroupEvidence[] = [];
  for (const group of profile.alignment.known_groups) {
    const p = PATTERNS[group];
    if (!p) continue;
    const found: GroupEvidence['segments'] = [];
    for (const seg of segments) {
      for (const span of seg.speakers) {
        const text = spanText(seg, span);
        // Only a Member State's delegation speaks on behalf of a group (2026-11-19): not the chair or the
        // secretariat reading out sponsors, nor the presidency giving the floor, a rapporteur or a staff body.
        const behalf =
          speaksForStates(span.label) && [...text.matchAll(BEHALF)].some((m) => p.behalf.test(m[1] as string));
        if (p.label.test(span.label) || behalf) {
          if (!found.some((x) => x.label === seg.label && x.speaker === span.label))
            found.push({ label: seg.label, speaker: span.label, excerpt: text });
        }
      }
    }
    // Every appearance (2026-11-25: a cap of four made a group seem silent in a later segment where it spoke).
    if (found.length) out.push({ group, segments: found });
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().trim();

/**
 * A delegation that spoke "on behalf of" a list naming `name`, when `name` did not speak itself (
 * 2026-11-25): the cited segment first, then any. Undefined when nobody spoke for it.
 */
export function spokeOnBehalf(
  segments: SegmentLike[],
  name: string,
  cite?: string,
): { speaker: string; segment: string; group: string } | undefined {
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  const ordered = [...segments.filter((s) => s.label === cite), ...segments.filter((s) => s.label !== cite)];
  for (const seg of ordered)
    for (const span of seg.speakers) {
      const speaker = (span.label.split('·')[0] ?? span.label).trim();
      if (norm(speaker) === norm(name) || !speaksForStates(span.label)) continue;
      for (const m of spanText(seg, span).matchAll(BEHALF))
        if (re.test(m[1] as string))
          return { speaker, segment: seg.label, group: (m[1] as string).replace(/[,;:]\s*$/, '').trim() };
    }
  return undefined;
}

/** The rejection when a member that did not speak is named, and another spoke on its behalf. */
const behalfMessage = (rule: string, name: string, b: { speaker: string; segment: string; group: string }) =>
  `${rule}: ${name} did not speak; ${b.speaker} spoke on its behalf in ${b.segment} ("on behalf of ${b.group}"): name the delegation that spoke, ${b.speaker}, and the group on whose behalf it did`;

/** The stands_with rule on a decision against the groups that spoke. Failures, empty = pass. */
export function checkStandsWith(d: Decision, evidence: GroupEvidence[], segments: SegmentLike[] = []): string[] {
  const f: string[] = [];
  const spoke = new Map(evidence.map((e) => [norm(e.group), e]));
  const listed = new Map(d.group_positions.map((g) => [norm(g.group), g]));
  for (const e of evidence)
    if (!listed.has(norm(e.group)))
      f.push(
        `stands_with: ${e.group} spoke in ${e.segments.map((s) => s.label).join(', ')}; say whether it defended the same position`,
      );
  for (const g of d.group_positions) {
    const e = spoke.get(norm(g.group));
    if (!e) {
      const b = spokeOnBehalf(segments, g.group, g.cite);
      f.push(
        b ? behalfMessage('stands_with', g.group, b) : `stands_with: ${g.group} did not take the floor in this meeting`,
      );
      continue;
    }
    if (!citesWhereSpoke(g.cite, e))
      f.push(
        `stands_with: ${g.group} is cited to ${g.cite || 'no segment'}; it spoke in ${e.segments.map((s) => s.label).join(', ')}`,
      );
  }
  const name = (g: string) => spoke.get(g)?.group ?? g;
  const same = d.group_positions
    .filter((g) => g.stance === 'same' && spoke.has(norm(g.group)))
    .map((g) => norm(g.group));
  const named = d.stands_with.map(norm).filter((g) => g !== NATIONAL);
  if (same.length) {
    if (d.stands_with.map(norm).includes(NATIONAL))
      f.push(
        `stands_with: ${same.map(name).join(', ')} defended the same position; name them instead of "${NATIONAL}"`,
      );
    else
      for (const g of same)
        if (!named.includes(g)) f.push(`stands_with: ${name(g)} defended the same position and is not named`);
    for (const g of named)
      if (!same.includes(g)) f.push(`stands_with: ${name(g)} is named but not shown defending the same position`);
  } else if (named.length || !d.stands_with.map(norm).includes(NATIONAL))
    f.push(`stands_with: no group that spoke defended the same position; it must be "${NATIONAL}"`);
  // closest_to and differs_on: only with "national capacity", and only among groups that addressed the point.
  const national = !named.length && d.stands_with.map(norm).includes(NATIONAL);
  // Groups that addressed the point with a different position, without opposing the State's (2026-11-13).
  const addressed = d.group_positions.filter((g) => g.stance === 'different' && !g.opposes && spoke.has(norm(g.group)));
  if (national && addressed.length) {
    const e = d.closest_to ? spoke.get(norm(d.closest_to)) : undefined;
    const entry = d.group_positions.find((g) => norm(g.group) === norm(d.closest_to ?? ''));
    if (!d.closest_to)
      f.push("closest_to: name the group that addressed the point whose position is nearest the State's");
    else if (!e) f.push(`closest_to: ${d.closest_to} did not take the floor in this meeting`);
    else if (entry?.stance !== 'different' || entry.opposes)
      f.push(
        `closest_to: ${e.group} ${entry?.opposes ? "opposes the State's position" : 'did not address this item'}; choose among ${addressed.map((g) => g.group).join(', ')}`,
      );
    if (!d.differs_on?.text) f.push('differs_on: one sentence on where the State differs from the closest group');
    else if (e && !citesWhereSpoke(d.differs_on.cite, e))
      f.push(
        `differs_on: cited to ${d.differs_on.cite || 'no segment'}; ${e.group} spoke in ${e.segments.map((s) => s.label).join(', ')}`,
      );
  } else if (d.closest_to || d.differs_on)
    f.push(
      national
        ? 'closest_to: no group that spoke addressed this item without opposing the State; leave closest_to and differs_on null'
        : 'closest_to: only with "national capacity"; leave it null',
    );
  return f;
}

/**
 * voted_with: each State must appear in the report's positions with the cited
 * segment, and speak in that segment of the transcript. Failures, empty = pass.
 */
export function checkVotedWith(
  d: Pick<Decision, 'voted_with'>,
  positions: { delegation: string; cites: string[] }[],
  segments: SegmentLike[],
): string[] {
  const f: string[] = [];
  const base = (label: string) => norm(label.split('·')[0] ?? label);
  const same = (a: string, b: string) => {
    const x = base(a);
    const y = base(b);
    return (
      x === y || x.startsWith(y + ' ') || y.startsWith(x + ' ') || x.startsWith(y + ' (') || y.startsWith(x + ' (')
    );
  };
  for (const v of d.voted_with.flatMap((t) => t.states)) {
    const inReport = positions.some((p) => same(p.delegation, v.state) && p.cites.includes(v.cite));
    const seg = segments.find((s) => s.label === v.cite);
    const spoke = !!seg?.speakers.some((sp) => same(sp.label, v.state));
    const behalf = !inReport && !spoke ? spokeOnBehalf(segments, v.state, v.cite) : undefined;
    if (behalf) f.push(behalfMessage('voted_with', v.state, behalf));
    else if (!inReport)
      f.push(`voted_with: ${v.state} [${v.cite}] is not a position in the meeting report with that segment`);
    else if (!spoke) f.push(`voted_with: ${v.state} does not speak in ${v.cite}`);
  }
  return f;
}

/** One or several segments ("E5", "E5, E6", "E5/E6", "E5 and E6"); each must be one where the group spoke. */
function citesWhereSpoke(cite: string, e: GroupEvidence): boolean {
  const cites = cite
    .split(/[\s,/;&]+|\band\b/)
    .map((c) => c.replace(/^\[|\]$/g, ''))
    .filter(Boolean);
  return cites.length > 0 && cites.every((c) => e.segments.some((s) => s.label === c));
}

/** Memo: a group an option would stand with must have taken the floor in this meeting (2026-11-13). */
export function memoGroupsSpoke(memo: { options: { id: string; stands_with: string[] }[] }, spoke: string[]): string[] {
  const known = new Set(spoke.map(norm));
  return memo.options.flatMap((o) =>
    o.stands_with
      .filter((g) => norm(g) !== NATIONAL && !known.has(norm(g)))
      .map((g) => `stands_with: option ${o.id} stands with ${g}, which did not take the floor in this meeting`),
  );
}
