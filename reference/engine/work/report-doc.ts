// The meeting report as data: parsing the model output, the cited items the
// source check verifies, the structural and language checks, and the text
// shown on the site (rendered by code). Sections follow the kind of meeting:
// briefers only in the Security Council; in the Assembly and its committees,
// introductions of drafts and, at action meetings, explanations of vote;
// positions grouped by draft. Presiding officers and the secretariat are
// never briefers or positions; in the Council, Secretariat officials brief.
import { isOfficer } from '../check/groups.ts';
import { checkLanguage } from '../check/language.ts';
import {
  ambiguousSequences,
  usesAmbiguous,
  groupStatements,
  missingGroupStatements,
  missingTallies,
  transcriptTallies,
  type CodeRepair,
} from '../check/record.ts';
import { checkSources, wordCount, type CheckFailure, type CitedItem, type SourceCheck } from '../check/source.ts';
import type { Body } from '../ingest/scope.ts';
import type { Segment } from './context.ts';

interface Item {
  text: string;
  cites: string[];
}

export type MeetingType = 'briefing' | 'debate' | 'action';

export interface MeetingReport {
  title: string;
  /** "Key points for the Mission": what touches the State's interests (3 to 5 with the outcome below). */
  key_points: Item[];
  /** The result of the texts of the decision point, or that this transcript does not record it. */
  decision_outcome: Item | null;
  meeting_type: MeetingType;
  issues: Item[];
  briefers: (Item & { speaker: string })[];
  introductions: (Item & { delegation: string; draft: string })[];
  positions: (Item & { delegation: string; draft: string | null })[];
  /** Statements on behalf of a group or of several States; `states` is counted by code from the transcript. */
  group_statements: (Item & {
    delegation: string;
    on_behalf_of: string;
    draft: string | null;
    states: number | null;
  })[];
  agreement: Item[];
  disagreement: Item[];
  outcome: Item;
  /** The tally of every text voted, as recorded (in favour – against – abstentions). */
  votes: (Item & {
    draft: string;
    result: string;
    in_favour: number | null;
    against: number | null;
    abstentions: number | null;
  })[];
  claims: { claim: string; cite: string }[];
  /** Repairs made by code before the check (2026-11-19): agreement and disagreement lines. */
  code_repairs?: CodeRepair[];
}

export class ReportOutputError extends Error {}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const cites = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.map((c) => str(c).replace(/^\[|\]$/g, '')).filter(Boolean))] : [];

function items(v: unknown, required: string[] = [], optional: string[] = []): (Item & Record<string, string>)[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ReportOutputError('Expected a list');
  return v.map((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const item = { text: str(o.text), cites: cites(o.cites) } as Item & Record<string, string>;
    if (!item.text) throw new ReportOutputError('Empty item text');
    for (const k of required) {
      item[k] = str(o[k]);
      if (!item[k]) throw new ReportOutputError('Missing ' + k);
    }
    for (const k of optional) item[k] = str(o[k]);
    return item;
  });
}

export function parseReport(raw: unknown): MeetingReport {
  if (!raw || typeof raw !== 'object') throw new ReportOutputError('Report output is not an object');
  const o = raw as Record<string, unknown>;
  const outcome = (o.outcome ?? {}) as Record<string, unknown>;
  const dout = o.decision_outcome as Record<string, unknown> | null | undefined;
  const type = str(o.meeting_type);
  const report: MeetingReport = {
    title: str(o.title),
    key_points: items(o.key_points),
    decision_outcome:
      dout && typeof dout === 'object' && str(dout.text) ? { text: str(dout.text), cites: cites(dout.cites) } : null,
    meeting_type: (['briefing', 'debate', 'action'].includes(type) ? type : 'debate') as MeetingType,
    issues: items(o.issues),
    // A briefer written with "delegation" instead of "speaker" is the same briefer.
    briefers: items(
      Array.isArray(o.briefers)
        ? o.briefers.map((b) => ({ speaker: (b as Record<string, unknown>)?.delegation, ...(b as object) }))
        : o.briefers,
      ['speaker'],
    ) as unknown as MeetingReport['briefers'],
    introductions: items(o.introductions, ['delegation'], ['draft']) as unknown as MeetingReport['introductions'],
    positions: (items(o.positions, ['delegation'], ['draft']) as unknown as MeetingReport['positions']).map((p) => ({
      ...p,
      draft: p.draft || null,
    })),
    group_statements: (
      items(
        o.group_statements,
        ['delegation'],
        ['on_behalf_of', 'draft'],
      ) as unknown as MeetingReport['group_statements']
    ).map((g) => ({ ...g, draft: g.draft || null, states: null })),
    agreement: items(o.agreement),
    disagreement: items(o.disagreement),
    outcome: { text: str(outcome.text), cites: cites(outcome.cites) },
    votes: (Array.isArray(o.votes) ? o.votes : []).map((x) => {
      const v = (x ?? {}) as Record<string, unknown>;
      const n = (k: string) =>
        typeof v[k] === 'number' ? (v[k] as number) : /^\d+$/.test(str(v[k])) ? Number(v[k]) : null;
      return {
        draft: str(v.draft),
        result: str(v.result) || 'adopted',
        in_favour: n('in_favour'),
        against: n('against'),
        abstentions: n('abstentions'),
        text: '',
        cites: cites(v.cites),
      };
    }),
    claims: (Array.isArray(o.claims) ? o.claims : []).map((c) => {
      const x = (c ?? {}) as Record<string, unknown>;
      return { claim: str(x.claim), cite: str(x.cite).replace(/^\[|\]$/g, '') };
    }),
  };
  const missing = [
    !report.title && 'title',
    !report.issues.length && 'issues',
    !report.outcome.text && (typeof o.outcome === 'string' ? 'outcome as an object' : 'outcome'),
  ].filter(Boolean);
  // Names the missing part, so a rejected output can be diagnosed (2026-11-13).
  if (missing.length)
    throw new ReportOutputError(`Report needs a title, issues and an outcome (missing: ${missing.join(', ')})`);
  if (!report.claims.length || report.claims.some((c) => !c.claim || !c.cite))
    throw new ReportOutputError('Report needs its material claims, each with a segment');
  return report;
}

/** "Not recorded in this transcript": the one outcome sentence that needs no segment. */
const NOT_RECORDED =
  /\bnot (recorded|stated|reported|given)\b|\bdoes not (record|appear|show|state)\b|\bnot in this transcript\b/i;

export function citedItems(r: MeetingReport): CitedItem[] {
  return [
    ...r.key_points.map((i) => ({ section: 'key_points', ...i })),
    ...(r.decision_outcome && r.decision_outcome.cites.length
      ? [{ section: 'decision_outcome', ...r.decision_outcome }]
      : []),
    ...r.issues.map((i) => ({ section: 'issues', ...i })),
    ...r.briefers.map((i) => ({ section: 'briefers', text: i.text, cites: i.cites, speaker: i.speaker })),
    ...r.introductions.map((i) => ({ section: 'introductions', text: i.text, cites: i.cites, speaker: i.delegation })),
    ...r.positions.map((i) => ({ section: 'positions', text: i.text, cites: i.cites, speaker: i.delegation })),
    ...r.group_statements.map((i) => ({
      section: 'group_statements',
      text: i.text,
      cites: i.cites,
      speaker: i.delegation,
    })),
    ...r.agreement.map((i) => ({ section: 'agreement', ...i })),
    ...r.disagreement.map((i) => ({ section: 'disagreement', ...i })),
    { section: 'outcome', ...r.outcome },
    ...r.votes.map((v) => ({ section: 'votes', text: tallyText(v), cites: v.cites })),
    ...r.claims.map((c) => ({ section: 'claims', text: c.claim, cites: [c.cite] })),
  ];
}

const cite = (i: Item): string => (i.cites.length ? ' ' + i.cites.map((c) => '[' + c + ']').join('') : '');

/** "L.6: adopted, 120 in favour, 3 against, 10 abstentions" (the figures as recorded). */
export const tallyText = (v: MeetingReport['votes'][number]): string =>
  `${v.draft}: ${v.result}` +
  (v.in_favour !== null
    ? `, ${v.in_favour} in favour, ${v.against ?? 'not stated'} against, ${v.abstentions ?? 'not stated'} abstentions`
    : '');

export function renderReport(r: MeetingReport, lowConfidence: string | null, body: Body | null = null): string {
  const list = (title: string, xs: string[]): string[] =>
    xs.length ? ['', '## ' + title, ...xs.map((x) => '- ' + x)] : [];
  const council = body === 'security_council';
  // Positions by draft, in order of first mention; general statements last.
  const drafts = [...new Set(r.positions.map((p) => p.draft))].sort((a, b) => (a === null ? 1 : b === null ? -1 : 0));
  const grouped = drafts.length > 1 || (drafts.length === 1 && drafts[0] !== null);
  const positionsTitle = !council && r.meeting_type === 'action' ? 'Explanations of vote' : 'Positions';
  const position = (i: MeetingReport['positions'][number]) => `**${i.delegation}**: ${i.text}${cite(i)}`;
  return [
    ...(lowConfidence ? [lowConfidence, ''] : []),
    '# ' + r.title,
    ...list('Key points for the Mission', [
      ...r.key_points.map((i) => i.text + cite(i)),
      ...(r.decision_outcome ? [r.decision_outcome.text + cite(r.decision_outcome)] : []),
    ]),
    ...list(
      'Issues',
      r.issues.map((i) => i.text + cite(i)),
    ),
    ...(council
      ? list(
          'Briefers',
          r.briefers.map((i) => `**${i.speaker}**: ${i.text}${cite(i)}`),
        )
      : []),
    ...list(
      'Introductions of drafts',
      r.introductions.map((i) => `**${i.delegation}**${i.draft ? ` (${i.draft})` : ''}: ${i.text}${cite(i)}`),
    ),
    ...(r.positions.length
      ? grouped
        ? [
            '',
            '## ' + positionsTitle,
            ...drafts.flatMap((d) => [
              '',
              '### ' + (d ?? 'General statements'),
              ...r.positions.filter((p) => p.draft === d).map((p) => '- ' + position(p)),
            ]),
          ]
        : list(positionsTitle, r.positions.map(position))
      : []),
    ...list(
      'Statements on behalf of groups',
      r.group_statements.map(
        (g) =>
          `**${g.delegation}**, on behalf of ${g.on_behalf_of}${g.states ? ` (${g.states} States)` : ''}${g.draft ? ` on ${g.draft}` : ''}: ${g.text}${cite(g)}`,
      ),
    ),
    ...list(
      'Agreement',
      r.agreement.map((i) => i.text + cite(i)),
    ),
    ...list(
      'Disagreement',
      r.disagreement.map((i) => i.text + cite(i)),
    ),
    '',
    '## Outcome',
    r.outcome.text + cite(r.outcome),
    ...r.votes.map((v) => '- ' + tallyText(v) + cite(v)),
  ].join('\n');
}

/**
 * Length guide: proportional to the transcript. Assembly and committee
 * meetings, with many texts, tallies and group statements, get more room
 * (2026-11-13): 130 words a segment up to 2,600, against 90 up to 1,800.
 */
export const reportWordGuide = (segments: number, body: Body | null = null): number =>
  body && body !== 'security_council' ? Math.min(2600, 250 + 130 * segments) : Math.min(1800, 250 + 90 * segments);

export interface ReportContext {
  body: Body | null;
  /** The transcript's segments, for the record checks (tallies, group statements, named delegations). */
  segments?: Segment[];
  /** The triage's decision point on a full file: the key points must give the outcome of its texts. */
  decisionPoint: string | null;
}

/** Structure and language (checks 3 and 11): sections by meeting type, officers, key points. */
export function reportStructure(r: MeetingReport, ctx: ReportContext): CheckFailure[] {
  const f: CheckFailure[] = [];
  const add = (section: string, detail: string, rule: CheckFailure['rule'] = 'structure') =>
    f.push({ rule, section, detail });
  const points = r.key_points.length + (r.decision_outcome ? 1 : 0);
  if (points < 3 || points > 5)
    add('key_points', `${points} key points; give 3 to 5, including the outcome of the decision point's texts`);
  if (ctx.decisionPoint && !r.decision_outcome)
    add('decision_outcome', 'give the outcome of the texts of the decision point, or say it is not recorded here');
  if (r.decision_outcome && !r.decision_outcome.cites.length && !NOT_RECORDED.test(r.decision_outcome.text))
    add('decision_outcome', 'cite the segment that records the outcome, or say it is not recorded in this transcript');
  if (ctx.body !== 'security_council' && r.briefers.length)
    add('briefers', 'briefers exist only in the Security Council; use introductions of drafts or positions');
  for (const [section, who] of [
    ['briefers', r.briefers.map((b) => b.speaker)],
    ['introductions', r.introductions.map((b) => b.delegation)],
    ['positions', r.positions.map((b) => b.delegation)],
  ] as const)
    for (const w of who)
      if (isOfficer(w, ctx.body))
        add(section, `${w} presides or serves the meeting; officers and the secretariat are not listed`);
  for (const x of checkLanguage(renderReport(r, null, ctx.body), 'the report', { draftsRead: true }))
    add('report', x, 'language');
  if (ctx.segments) {
    for (const t of missingTallies(transcriptTallies(ctx.segments), r.votes))
      add(
        'votes',
        `the tally of L.${t.draft} (${t.in_favour} in favour, ${t.segment}) is recorded; give it in "votes"`,
      );
    for (const g of missingGroupStatements(groupStatements(ctx.segments), [
      ...r.group_statements,
      ...r.introductions,
      ...r.positions,
    ]))
      add(
        'group_statements',
        `${g.speaker} spoke ${g.behalf.slice(0, 80)}… in ${g.segment}; keep it in "group_statements" (or introductions)`,
      );
    const unclear = usesAmbiguous(renderReport(r, null, ctx.body), ambiguousSequences(ctx.segments));
    if (unclear.length)
      add(
        'figures',
        `${unclear.join(', ')} come from an ambiguous sequence in the transcript (e.g. "in 2025, 24, and 23"); omit them or write "unclear in the transcript"`,
      );
    // Agreement and disagreement lines are repaired by code before this check, never rejected (
    // 2026-11-19; repairNamedLines in the report task).
  }
  return f;
}

/** Delegations with an entry of their own: briefers, introductions, group statements, positions. */
export const reportEntries = (r: MeetingReport): { delegation: string; cites: string[] }[] => [
  ...r.briefers.map((b) => ({ delegation: b.speaker, cites: b.cites })),
  ...r.introductions,
  ...r.group_statements,
  ...r.positions,
];

export function checkReport(
  r: MeetingReport,
  segments: Segment[],
  metadata: string,
  ctx: ReportContext = { body: null, decisionPoint: null },
): SourceCheck {
  const body = renderReport(r, null, ctx.body);
  const c = checkSources(
    citedItems(r),
    segments,
    reportWordGuide(segments.length, ctx.body),
    wordCount(body),
    metadata,
  );
  const failures = [...c.failures, ...reportStructure(r, { ...ctx, segments: ctx.segments ?? segments })];
  return { ...c, pass: failures.length === 0, failures };
}
