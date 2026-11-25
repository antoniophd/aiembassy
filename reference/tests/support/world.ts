// An in-memory mission: database with synthetic meetings and a scripted model. Every name, figure and sentence is
// invented (2026-11-24): the States and groups come from ./invented.ts.
import { openDatabase, type Db } from '../../engine/db/index.ts';
import { storeTranscript, upsertMeeting } from '../../engine/ingest/store.ts';
import { normaliseIndexMeeting, type DownloadedTranscript } from '../../engine/ingest/un-transcripts.ts';
import { ModelCallError, type GenerateRequest, type LlmClient } from '../../engine/llm/index.ts';
import { loadTeam } from '../../engine/profile/index.ts';
import type { Services } from '../../engine/queue/execute.ts';
import { TEST_PROFILE } from './invented.ts';

export const SEGMENT_TEXT = [
  '[0s] The President: I give the floor to the representative of Arvenia.\n[10s] Arvenia: We support resolution 9901 and the 15 per cent increase.',
  '[60s] Belmora: Belmora asks for "a pause in the fighting that holds" in the valley.\n[70s] Draft resolution L.5 was adopted by 13 votes.\n[80s] Union of Lakeland States: On behalf of the Union of Lakeland States and its members, we support relief convoys without conditions.',
];

export function addMeeting(
  db: Db,
  slug: string,
  opts: { duration?: string; date?: string; chars?: number } = {},
): void {
  const m = normaliseIndexMeeting({
    slug,
    date: opts.date ?? '2026-11-10',
    hasTranscript: true,
    duration: opts.duration ?? '01:00:00',
    title: 'Test meeting ' + slug,
  })!;
  upsertMeeting(db, m);
  const t: DownloadedTranscript = {
    url: m.pageUrl,
    title: m.title,
    language: 'en',
    statements: 3,
    characters: opts.chars ?? 50_000,
    speakers: [],
    segments: SEGMENT_TEXT.map((text, i) => ({
      id: 'E' + (i + 1),
      start: i * 60,
      end: i * 60 + 59,
      text: text + ' (' + slug + ')',
      speakers: [
        { start: i * 60, end: i * 60 + 59, label: i === 0 ? 'Arvenia' : 'Belmora' },
        { start: i * 60, end: i * 60 + 9, label: 'GA · President' },
        ...(i === 1 ? [{ start: 80, end: 90, label: 'Union of Lakeland States' }] : []),
      ],
    })),
  };
  storeTranscript(db, m.id, t);
}

export type Script = (req: GenerateRequest) => unknown;

export interface FakeLlm extends LlmClient {
  requests: GenerateRequest[];
}

export function fakeLlm(script: Script): FakeLlm {
  const requests: GenerateRequest[] = [];
  return {
    requests,
    target: () => ({ provider: 'ollama', baseUrl: 'https://ollama.test', model: 'writer', apiKey: 'k' }),
    async generate(req) {
      requests.push(req);
      const output = script(req);
      if (output instanceof Error) throw output;
      return {
        output,
        usage: { inputTokens: 10, outputTokens: 5 },
        provider: 'ollama',
        model: req.model ?? 'w',
        durationMs: 1,
      };
    },
  };
}

export const providerDown = (): Error => new ModelCallError('Ollama service failed.', 'provider', 503);

export const goodTriage = (level = 'report', extra: Record<string, unknown> = {}) => ({
  level,
  reason: 'Substantive debate.',
  lead: 'political',
  opinions: [],
  involves_force_sanctions_charter: false,
  decision_point: level === 'full_file' ? 'Draft resolution L.5 on humanitarian access, to be voted' : null,
  engaged: { interests: level === 'full_file' ? ['I3'] : [], red_lines: level === 'full_file' ? ['R2'] : [] },
  decision_status: level === 'full_file' ? { status: 'pending', cite: 'E2', next_step: null, next_forum: null } : null,
  press: { flag: false, reason: 'No.' },
  dossier: { id: null, new_title: level === 'full_file' ? 'Test situation' : null },
  duplicate_of: null,
  ...extra,
});

export const goodReport = (cite = 'E1') => ({
  title: 'Debate on the test situation',
  key_points: [
    { text: 'Arvenia supports resolution 9901.', cites: ['E1'] },
    { text: 'Belmora asks for a pause in the fighting in the valley.', cites: ['E2'] },
  ],
  decision_outcome: { text: 'The draft was adopted by 13 votes.', cites: ['E2'] },
  meeting_type: 'action',
  issues: [{ text: 'Resolution 9901 and a 15 per cent increase.', cites: ['E1'] }],
  briefers: [],
  positions: [
    { delegation: 'Arvenia', text: 'Supports resolution 9901.', cites: ['E1'] },
    { delegation: 'Belmora', text: 'Asks for "a pause in the fighting that holds".', cites: ['E2'] },
  ],
  agreement: [],
  disagreement: [],
  outcome: { text: 'The draft was adopted by 13 votes.', cites: ['E2'] },
  claims: [{ claim: 'Arvenia supports resolution 9901.', cite }],
});

/** Default script: triage as given, short note, summaries, valid report. */
export function scripted(triage: (req: GenerateRequest) => unknown = () => goodTriage()): Script {
  return (req) => {
    const system = req.messages[0]?.content ?? '';
    if (system.includes('You triage every completed meeting')) return triage(req);
    if (system.includes('Write the file note')) return { note: 'Agenda adopted. No debate. No interest engaged.' };
    if (system.includes('Summarise one segment'))
      return { points: [{ speaker: 'Arvenia', text: 'Support.' }], outcome: 'none' };
    if (system.includes('Write the meeting report')) return goodReport();
    if (system.includes('You check one claim')) return { verdict: 'supported', reason: 'Said in the segment.' };
    if (system.includes('cross this red line')) return { crosses: false, reason: 'It does not.' };
    if (system.includes('the one thing your desk adds')) return goodOpinion();
    if (system.includes('Write the options memo')) return goodMemo();
    if (system.includes('you take the decision on this file')) return goodDecision();
    if (system.includes('Write the cable with which the Permanent Mission reports')) {
      // The cable keeps the decision it is given (option and stands_with).
      const d = (
        JSON.parse(req.messages[1]?.content ?? '{}') as { decision?: { option: string; stands_with: string[] } }
      ).decision;
      return { ...goodCable(!!d), ...(d ? { option: d.option, stands_with: d.stands_with } : {}) };
    }
    if (system.includes('Write the press pack')) {
      // The pack keeps the option and vote it is given; text written for option A in favour is kept as is.
      const input = JSON.parse(req.messages[1]?.content ?? '{}') as {
        decision?: { option: string; vote: string };
        meeting?: { organ?: string };
      };
      return input.decision && input.decision.option !== 'A' ? null : goodPressPack({}, input.meeting?.organ);
    }
    if (system.includes('You are the Press Counsellor'))
      return {
        product: 'statement',
        text: 'We support unhindered humanitarian access and will vote accordingly.',
      };
    return new Error('Unexpected prompt');
  };
}

/** Invented model names: writer, fallback, checker, and the checker of the fallback's documents. */
export const MODELS = { LLM_MODEL: 'w', LLM_MODEL_FALLBACK: 'f', LLM_MODEL_CHECK: 'c', LLM_MODEL_CHECK_FALLBACK: 'c2' };

export function services(llm: LlmClient, db = openDatabase(':memory:')): Services {
  return { db, llm, env: MODELS, profile: TEST_PROFILE, team: loadTeam() };
}

export const status = (db: Db, id: string): Record<string, unknown> => ({
  ...(db
    .prepare('SELECT status, level, duplicate_of, low_confidence, status_reason FROM files WHERE meeting_id = ?')
    .get(id) as object),
});

export const goodOpinion = () => ({
  opinion:
    'Under international humanitarian law the parties must allow rapid passage of relief. A vote for the text keeps the State consistent with that obligation and with its interest in protection of civilians.',
  objection: false,
  interests: ['I3'],
});

export const goodMemo = () => ({
  options: [
    {
      id: 'A',
      vote: 'in favour',
      takes_floor: true,
      action: 'Vote in favour and explain the vote.',
      benefit: 'Defends access.',
      risk: 'Irritates a partner.',
      stands_with: ['Union of Lakeland States'],
    },
    {
      id: 'B',
      vote: 'abstain',
      takes_floor: true,
      action: 'Abstain with an explanation.',
      benefit: 'Keeps distance.',
      risk: 'Looks weak on access.',
      stands_with: ['national capacity'],
    },
  ],
  recommendation: {
    option: 'A',
    reason: 'Protection of civilians prevails over the cost to a partner.',
    prevailing_interest: 'I3',
  },
});

export const goodDecision = (extra: Record<string, unknown> = {}) => ({
  position: 'The State votes in favour of the draft and explains that humanitarian access admits no exception.',
  option: 'A',
  vote: 'in favour',
  takes_floor: true,
  why: 'Protection of civilians is the interest at stake and the text serves it.',
  rejected: [{ option: 'B', why: 'Abstaining would weaken a rule the State depends on.' }],
  interests: ['I3'],
  red_lines: ['R2'],
  stands_with: ['Union of Lakeland States'],
  stands_with_reason: 'Its text on access serves the higher interest.',
  group_positions: [
    {
      group: 'Union of Lakeland States',
      cite: 'E2',
      position: 'Supports relief convoys without conditions.',
      same: true,
    },
  ],
  change: 'first',
  reopens_if: 'The draft is amended to condition access.',
  press: 'statement',
  ...extra,
});

const FILLER = [
  'Delegations spent most of the meeting on access for relief convoys and on the conditions attached to it',
  'The tone was measured, and nobody sought to reopen the language agreed earlier in the week',
  'Arvenia and Belmora framed the question as one of principle rather than of procedure',
  'Several speakers linked the issue to the protection of civilians, which the Mission follows closely',
  'The debate showed a broad wish to keep the matter inside the Assembly rather than in smaller formats',
  'No delegation asked for further consultations before the next step was taken',
  'Observers expect the same arguments to return when the text comes back for action',
  'The Mission will keep in touch with the delegations that spoke on access',
];
const prose = (n: number) =>
  Array.from(
    { length: n },
    (_, i) =>
      `${FILLER[i % FILLER.length]}, as the Mission noted in ${['the morning', 'the afternoon', 'the corridor', 'its own notes', 'the margins', 'the closing exchange', 'the follow-up', 'the record'][Math.floor(i / FILLER.length) % 8]}.`,
  ).join(' ');

/** A cable that passes its checks: 450–1,500 words, names and figures only from the report. */
export const goodCable = (full: boolean) => ({
  subject: 'Debate on the test situation',
  summary: prose(6),
  paragraphs: [
    { title: 'Access', text: prose(8) },
    { title: 'Positions', text: prose(8) },
    { title: 'Outlook', text: prose(8) },
  ],
  assessment: [prose(6)],
  option: full ? 'A' : null,
  stands_with: full ? ['Union of Lakeland States'] : null,
});

const QUOTE =
  'Relief must reach civilians, and it must reach them without conditions. Humanitarian access admits no exception.';

/** A press pack that passes its checks (invented): option A, in favour, names and figures from the file only. */
export const goodPressPack = (
  extra: Record<string, unknown> = {},
  organ = 'the Third Committee of the General Assembly',
) => ({
  option: 'A',
  vote: 'in favour',
  stakeout: {
    remarks:
      'Today my country voted in favour of the draft on humanitarian access. Our message is simple. ' +
      QUOTE +
      ' We listened carefully to every delegation in the room. Many spoke for the protection of civilians, and we ' +
      'share that concern. The draft was adopted by 13 votes, and we welcome that result. It gives relief workers a ' +
      'clearer path. It gives civilians a better chance. My country is small and open. We depend on rules that hold ' +
      'for everyone. When the rules on access hold, the most vulnerable are protected. When they weaken, everyone ' +
      'pays a price. We will keep working with all delegations on the next steps, and we will judge progress by one ' +
      'test: whether relief convoys reach the people who need them, in time and in safety.',
    question: 'Will the resolution change anything on the ground?',
    answer:
      'It sets a clear expectation. From here we will watch that relief convoys reach civilians, and we will keep raising that point.',
  },
  release: {
    headline: 'Humanitarian access: the State backs the draft',
    dateline: 'New York, 10 November 2026',
    body:
      `The Permanent Mission of the State to the United Nations today voted in favour of the draft on humanitarian ` +
      `access in ${organ}, which was adopted by 13 votes. During the debate, many delegations stressed the ` +
      'protection of civilians and the passage of relief convoys, and the State shares that concern.\n\n' +
      'The State supported the text because the protection of civilians depends on relief that arrives in time and ' +
      'without conditions attached to it. Speaking to journalists after the meeting, the Permanent Representative ' +
      'said: "' +
      QUOTE +
      '" The State, a small and open country, relies on rules that hold for everyone, and it sees in the text a ' +
      'clear expectation that relief convoys will be allowed to pass.\n\n' +
      'The Permanent Mission will keep working with all delegations on the next steps. It will follow closely ' +
      'whether relief reaches the people who need it, in time and in safety, and it will raise the question again ' +
      'whenever access is restricted. The State believes that a rule on access is only as strong as its daily ' +
      'practice, and it looks forward to continued cooperation on the protection of civilians in the weeks ahead.',
    quote: QUOTE,
  },
  social:
    'Today the State voted in favour of the draft on humanitarian access. Relief must reach civilians without conditions. #HumanitarianAccess',
  ...extra,
});
