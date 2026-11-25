// Triage rules. Pure: validates the DPR's output and applies
// the deterministic rules. Every override is recorded in `adjustments`.
import type { Body } from '../ingest/scope.ts';
import type { StateProfile, Team } from '../profile/index.ts';
import type { SegmentLike } from '../check/groups.ts';
import { checkTimingCite, NEXT_FORUMS, type DecisionTiming, type NextForum } from '../check/timing.ts';
import { checkLanguage } from '../check/language.ts';
import type { Level } from './context.ts';

export const PROCEDURAL_SECONDS = 300;
/** Short and thin: under 20 minutes with at most three speaker labels (chair included). */
export const SHORT_SECONDS = 1200;
export const SHORT_MAX_SPEAKERS = 3;
const COUNSELLORS = ['political', 'legal', 'economic'] as const;
const PLENARY_LEADS = ['political', 'legal', 'economic', 'dpr'];

export interface TriageFacts {
  body: Body;
  durationSeconds: number | null;
  /** Distinct speaker labels in the transcript. */
  speakers: number;
  dossierIds: string[];
  /** Meetings this one may duplicate (earlier parts, identical transcripts). */
  duplicateCandidates: string[];
  /** A candidate with an identical transcript: always a duplicate. */
  identicalTranscriptOf: string | null;
  /** The transcript's segments: the decision status must cite one (check 10). */
  segments?: SegmentLike[];
}

export interface Triage {
  level: Level;
  reason: string;
  /** For full files: the concrete decision the State must take a position on. */
  decisionPoint: string | null;
  /** For full files: whether the decision point is still pending or was already acted on (check 10). */
  decisionStatus: DecisionTiming | null;
  lead: string;
  opinions: string[];
  press: boolean;
  pressReason: string;
  /** A cable to Capital: always on full files; on reports when the DPR marks it; never on notes. */
  cable: boolean;
  cableReason: string;
  engaged: { interests: string[]; red_lines: string[] };
  dossier: { id: string | null; newTitle: string | null };
  duplicateOf: string | null;
  adjustments: string[];
}

export class TriageOutputError extends Error {}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim()) : [];
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function applyTriageRules(raw: unknown, facts: TriageFacts, profile: StateProfile, team: Team): Triage {
  if (!raw || typeof raw !== 'object') throw new TriageOutputError('Triage output is not an object');
  const o = raw as Record<string, unknown>;
  const adjustments: string[] = [];
  let level = o.level as Level;
  if (!['note', 'report', 'full_file'].includes(level)) throw new TriageOutputError('Invalid level');
  const reason = text(o.reason);
  if (!reason) throw new TriageOutputError('Triage reason missing');
  const wording = checkLanguage(reason + ' ' + text(o.decision_point), 'the triage', { draftsRead: true });
  if (wording.length) throw new TriageOutputError(wording.join(' | '));

  // Lead: fixed by body, chosen by subject for the plenary.
  const bodyLead = team.lead_by_body[facts.body];
  let lead = text(o.lead);
  if (bodyLead) {
    if (lead !== bodyLead) adjustments.push(`lead set to ${bodyLead} for ${facts.body} (was "${lead}")`);
    lead = bodyLead;
  } else if (!PLENARY_LEADS.includes(lead)) throw new TriageOutputError('Invalid plenary lead: ' + lead);

  // Engaged interests and red lines must exist in the profile.
  const known = new Set([...profile.interests.map((i) => i.id), ...profile.red_lines.map((r) => r.id)]);
  const engagedRaw = (o.engaged ?? {}) as Record<string, unknown>;
  // An interest or red line written in words is mapped to its id (2026-11-13: words in prose, ids in fields).
  const toId = (v: string): string => {
    if (known.has(v)) return v;
    const w = v.toLowerCase().replace(/[.\s]+$/, '');
    const hit = [...profile.interests, ...profile.red_lines].find((x) => {
      const t = x.text.toLowerCase().replace(/[.\s]+$/, '');
      return t === w || t.startsWith(w) || w.startsWith(t.split(/[(,;]/)[0]!.trim());
    });
    return hit?.id ?? v;
  };
  const interests = strings(engagedRaw.interests)
    .map(toId)
    .filter((id) => known.has(id) && id.startsWith('I'));
  const redLines = strings(engagedRaw.red_lines)
    .map(toId)
    .filter((id) => known.has(id) && id.startsWith('R'));

  // Short or procedural meetings are notes.
  const d = facts.durationSeconds;
  if (level !== 'note') {
    if (d !== null && d < PROCEDURAL_SECONDS) {
      adjustments.push(`level ${level} -> note: meeting under ${PROCEDURAL_SECONDS / 60} minutes`);
      level = 'note';
    } else if (d !== null && d < SHORT_SECONDS && facts.speakers <= SHORT_MAX_SPEAKERS) {
      adjustments.push(`level ${level} -> note: under ${SHORT_SECONDS / 60} minutes with ${facts.speakers} speakers`);
      level = 'note';
    } else if (o.procedural === true) {
      adjustments.push(`level ${level} -> note: the DPR marked the meeting procedural`);
      level = 'note';
    }
  }
  const decisionPoint = text(o.decision_point) || null;
  if (level === 'full_file' && !decisionPoint) {
    adjustments.push('level full_file -> report: no decision point named');
    level = 'report';
  }
  if (level === 'full_file' && !interests.length && !redLines.length) {
    adjustments.push('level full_file -> report: no listed interest or red line named');
    level = 'report';
  }
  if (lead === 'dpr' && level !== 'note') {
    adjustments.push(`level ${level} -> note: organisational plenary item (DPR desk)`);
    level = 'note';
  }

  // Opinions: other counsellors only; legal is mandatory on SC full files on force, sanctions, Charter.
  let opinions = [...new Set(strings(o.opinions))].filter(
    (r) => (COUNSELLORS as readonly string[]).includes(r) && r !== lead,
  );
  if (level === 'full_file') {
    // The economic desk only on economic, environmental or budgetary matters (2026-11-13).
    const economic =
      facts.body === 'ga_c2' || facts.body === 'ga_c5' || interests.includes('I4') || interests.includes('I5');
    if (!economic && opinions.includes('economic') && lead !== 'economic') {
      opinions = opinions.filter((r) => r !== 'economic');
      adjustments.push('economic opinion dropped: not an economic, environmental or budgetary matter');
    }
    if (
      facts.body === 'security_council' &&
      o.involves_force_sanctions_charter === true &&
      lead !== 'legal' &&
      !opinions.includes('legal')
    ) {
      opinions.push('legal');
      adjustments.push('legal opinion added: Security Council file on force, sanctions or the Charter');
    }
    if (!opinions.length) {
      const other = (['legal', 'political'] as const).find((r) => r !== lead) as string;
      opinions.push(other);
      adjustments.push(`opinion from ${other} added: a full file needs a counsellor other than the lead`);
    }
  } else opinions = [];

  // Decision status: pending or already taken, with the segment that shows it.
  let decisionStatus: DecisionTiming | null = null;
  if (level === 'full_file') {
    const ds = (o.decision_status ?? {}) as Record<string, unknown>;
    const status = text(ds.status);
    if (status !== 'pending' && status !== 'already_taken' && status !== 'not_recorded')
      throw new TriageOutputError('decision_status: status must be "pending", "already_taken" or "not_recorded"');
    const forum = text(ds.next_forum);
    decisionStatus = {
      status,
      cite: status === 'not_recorded' ? '' : text(ds.cite).replace(/^\[|\]$/g, ''),
      next_step: text(ds.next_step) || null,
      next_forum: (NEXT_FORUMS as string[]).includes(forum) ? (forum as NextForum) : null,
    };
    if (facts.segments) {
      const failures = checkTimingCite(decisionStatus, facts.segments, decisionPoint);
      if (failures.length) throw new TriageOutputError(failures.join(' | '));
    }
  }

  const cableRaw = (o.cable ?? {}) as Record<string, unknown>;
  const cable = level === 'full_file' || (level === 'report' && (cableRaw.flag === true || o.cable === true));

  const pressRaw = (o.press ?? {}) as Record<string, unknown>;
  const press = level === 'full_file' && pressRaw.flag === true;

  const dossierRaw = (o.dossier ?? {}) as Record<string, unknown>;
  let dossierId = text(dossierRaw.id) || null;
  if (dossierId && !facts.dossierIds.includes(dossierId)) {
    adjustments.push(`unknown dossier ${dossierId} ignored`);
    dossierId = null;
  }
  let newTitle = dossierId ? null : text(dossierRaw.new_title) || null;
  if (level !== 'full_file') {
    dossierId = null;
    newTitle = null;
  } else if (!dossierId && !newTitle) throw new TriageOutputError('A full file needs a dossier id or a new title');

  let duplicateOf = text(o.duplicate_of) || null;
  if (duplicateOf && !facts.duplicateCandidates.includes(duplicateOf)) {
    adjustments.push(`duplicate_of ${duplicateOf} ignored: not a candidate`);
    duplicateOf = null;
  }
  if (facts.identicalTranscriptOf && duplicateOf !== facts.identicalTranscriptOf) {
    adjustments.push(`duplicate_of set to ${facts.identicalTranscriptOf}: identical transcript`);
    duplicateOf = facts.identicalTranscriptOf;
  }

  return {
    level,
    reason,
    decisionPoint: level === 'full_file' ? decisionPoint : null,
    decisionStatus,
    lead,
    opinions,
    press,
    pressReason: text(pressRaw.reason),
    cable,
    cableReason: level === 'full_file' ? 'Full file: always a cable.' : cable ? text(cableRaw.reason) : '',
    engaged: { interests, red_lines: redLines },
    dossier: { id: dossierId, newTitle },
    duplicateOf,
    adjustments,
  };
}
