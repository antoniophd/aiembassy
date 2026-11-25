// Decisions of 2026-11-19: agreement and disagreement lines repaired by
// code, group statements only from Member States, the cable of a report read
// from the outcome and the segments, delegations without an entry removed
// from the cable, a bare "President" label is the presiding officer,
// reasoning effort per call, and a reopened earlier full file decides before
// the later files of its dossier.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkCable, repairCableNames, type Cable } from '../engine/check/cable.ts';
import { groupsInMeeting, isOfficer } from '../engine/check/groups.ts';
import { extendMemberStates, isMemberState } from '../engine/check/member-states.ts';
import { groupStatements, namedWithoutEntry, removeName, repairNamedLines } from '../engine/check/record.ts';
import { recordsAdoption, reportWantsCable } from '../engine/work/cable-task.ts';
import { reportStructure } from '../engine/work/report-doc.ts';
import './support/invented.ts';

// Invented delegations with the label features under test: a parenthesis, a curly apostrophe, an accent.
extendMemberStates(['Ostravia (Federal Republic of)', "Val d'Orsa", 'Sülvaria']);

const seg = (label: string, lines: [number, string, string][]) => ({
  label,
  text: lines.map(([t, who, s]) => `[${t}s] ${who}: ${s}`).join('\n'),
  speakers: lines.map(([t, who]) => ({ start: t, end: t + 9, label: who })),
});

test('member States: official labels, roles after "·", short forms; officers, bodies and groups are not', () => {
  assert.ok(isMemberState('Arvenia'));
  assert.ok(isMemberState('Belmora · Prime Minister'));
  assert.ok(isMemberState('Val d’Orsa'));
  assert.ok(isMemberState('Ostravia (Federal Republic of)'));
  assert.ok(isMemberState('Ostravia'));
  assert.ok(isMemberState('Sülvaria'));
  for (const x of ['GA · PGA', 'UN · Special Rapporteur on Corvalia', 'IASU · President', 'Coastal Group', 'President'])
    assert.ok(!isMemberState(x), x);
});

test('group statements: only a Member State speaking for a group of States', () => {
  const s = [
    seg('E2', [
      [10, 'GA · PGA', 'I now call on Dravonia, who is to read a text on behalf of the Coastal Group.'],
      [20, 'UN · Special Rapporteur on Corvalia', 'I have the honour of reporting on behalf of the Panel.'],
      [30, 'IASU · President', 'I have the honour of reading this note on behalf of IASU.'],
      [40, 'Dravonia', 'I have the honour of reading this on behalf of the Coastal Group, Elbaria and Istrena.'],
    ]),
  ];
  assert.deepEqual(
    groupStatements(s).map((g) => g.speaker),
    ['Dravonia'],
  );
  // The presidency giving the floor "on behalf of" a known group is not that group taking the floor.
  const chair = [seg('E1', [[10, 'GA · PGA', 'The floor goes to Arvenia, on behalf of the Meridian Group.']])];
  assert.deepEqual(groupsInMeeting(chair, { alignment: { known_groups: ['Meridian Group'] } } as never), []);
});

test('a bare "President" label is the presiding officer, not a delegation', () => {
  assert.ok(isOfficer('President'));
  assert.ok(isOfficer('Chair'));
  assert.ok(!isOfficer('Arvenia · Chair of the 2025 meeting of the Lakeland Convention'));
  const s = [seg('E1', [[10, 'President', 'The meeting is called to order.']])];
  assert.deepEqual(namedWithoutEntry('The President opened the debate.', s, []), []);
});

test('removeName: from a list, or the sentence when it is not in one', () => {
  const ostravia = 'ostravia (federal republic of)';
  assert.equal(
    removeName('Arvenia, Belmora and Corvalia supported the text.', 'belmora'),
    'Arvenia and Corvalia supported the text.',
  );
  assert.equal(
    removeName('Arvenia, Belmora and Corvalia supported the text.', 'arvenia'),
    'Belmora and Corvalia supported the text.',
  );
  assert.equal(removeName('Belmora and Arvenia supported it.', 'arvenia'), 'Belmora supported it.');
  assert.equal(removeName('Ostravia opposed the draft. Others agreed.', ostravia), 'Others agreed.');
  assert.equal(
    removeName('Dravonia, Ostravia (Federal Republic of) and Elbaria objected.', ostravia),
    'Dravonia and Elbaria objected.',
  );
});

test('agreement lines: a cite is added where the delegation speaks; never a rejection', () => {
  const s = [
    seg('E1', [[10, 'Arvenia', 'We back the draft.']]),
    seg('E2', [[60, 'Belmora', 'We back it as well.']]),
    seg('E3', [[120, 'Corvalia', 'We cannot accept it.']]),
  ];
  const r = {
    agreement: [{ text: 'Arvenia and Belmora supported the draft.', cites: ['E1'] }],
    disagreement: [{ text: 'Corvalia objected.', cites: ['E1'] }],
  };
  const repairs = repairNamedLines(r, s);
  assert.deepEqual(r.agreement[0]!.cites, ['E1', 'E2']);
  assert.deepEqual(r.disagreement[0]!.cites, ['E1', 'E3']);
  assert.deepEqual(
    repairs.map((x) => `${x.section}:${x.name}:${x.action}:${x.cite}`),
    ['agreement:belmora:cite_added:E2', 'disagreement:corvalia:cite_added:E3'],
  );
  // The check no longer rejects a line on this rule.
  const report = {
    key_points: [1, 2, 3].map(() => ({ text: 'Point.', cites: ['E1'] })),
    decision_outcome: null,
    meeting_type: 'debate',
    issues: [],
    briefers: [],
    introductions: [],
    positions: [],
    group_statements: [],
    agreement: [{ text: 'Arvenia and Belmora supported the draft.', cites: ['E1'] }],
    disagreement: [],
    outcome: { text: 'Debate held.', cites: ['E1'] },
    votes: [],
    claims: [],
  };
  const f = reportStructure(report as never, { body: 'ga_c3', decisionPoint: null, segments: s as never });
  assert.ok(!f.some((x) => /named in agreement or disagreement/.test(x.detail)));
});

test('agreement lines: a State listed that does not speak in the meeting is removed from the list', () => {
  const s = [
    seg('E1', [
      [10, 'Arvenia', 'We agree.'],
      [20, 'Belmora', 'We agree.'],
    ]),
  ];
  const r = {
    agreement: [
      { text: 'Arvenia, Elbaria and Belmora supported the draft.', cites: ['E1'] },
      { text: 'Speakers agreed the situation in Kestavia was grave.', cites: ['E1'] },
    ],
    disagreement: [{ text: 'Elbaria and Dravonia objected.', cites: ['E1'] }],
  };
  const repairs = repairNamedLines(r, s);
  assert.equal(r.agreement[0]!.text, 'Arvenia and Belmora supported the draft.');
  assert.equal(r.agreement[1]!.text, 'Speakers agreed the situation in Kestavia was grave.'); // a subject, not a list
  assert.deepEqual(
    repairs.map((x) => `${x.section}:${x.name}:${x.action}`),
    ['agreement:elbaria:name_removed', 'disagreement:dravonia:name_removed'],
  );
  // Left alone in its line, the name is no longer in a list: kept (it cannot be told from a subject).
  assert.equal(r.disagreement[0]!.text, 'Elbaria objected.');
});

test('cable of a report: read from the outcome and the segments, not the votes field', () => {
  const triage = { level: 'report', cable: true, engaged: { interests: ['I2'] } };
  const adopted = [seg('E4', [[200, 'GA · President', 'Draft resolution L.5 was adopted by 130 votes to 17.']])];
  const debate = [seg('E4', [[200, 'Arvenia', 'We expect to vote in favour next week.']])];
  const done = { outcome: { text: 'Draft resolution L.5 was adopted by recorded vote.', cites: ['E4'] }, votes: [] };
  const planned = { outcome: { text: 'The Committee will vote on L.5 next week.', cites: ['E4'] }, votes: [] };
  const agenda = { outcome: { text: 'The agenda was adopted.', cites: ['E4'] }, votes: [] };
  const votesOnly = { outcome: { text: 'The debate concluded.', cites: ['E4'] }, votes: [{ draft: 'L.5' }] };
  assert.equal(reportWantsCable(triage, done as never, adopted), true);
  assert.equal(reportWantsCable(triage, planned as never, adopted), false); // only planned
  assert.equal(reportWantsCable(triage, agenda as never, adopted), false); // procedure
  assert.equal(reportWantsCable(triage, votesOnly as never, adopted), false); // the votes field is not read
  assert.equal(reportWantsCable(triage, done as never, debate), false); // the transcript must record it
  assert.equal(reportWantsCable({ ...triage, engaged: { interests: [] } }, done as never, adopted), false);
  assert.equal(reportWantsCable({ ...triage, cable: false }, done as never, adopted), false);
  assert.equal(reportWantsCable(triage, null, adopted), false);
  assert.ok(recordsAdoption({ outcome: { text: 'L.7 was adopted without a vote.', cites: [] } }, adopted));
  // Read clause by clause: another clause about deferred agenda items does not cancel it.
  const c6 =
    'The Committee approved A/C.6/99/L.4 by consensus, then deferred agenda items 61 to 64 to the 100th session.';
  assert.ok(recordsAdoption({ outcome: { text: c6, cites: [] } }, adopted));
  assert.ok(!recordsAdoption({ outcome: { text: 'No text was adopted or rejected.', cites: [] } }, adopted));
  assert.ok(!recordsAdoption({ outcome: { text: 'The provisional agenda was adopted by vote.', cites: [] } }, adopted));
});

test('cable: a delegation without an entry of its own is removed, not a reason to reject', () => {
  const s = [
    seg('E1', [
      [10, 'Arvenia', 'We stand behind the text.'],
      [20, 'Belmora', 'We stand behind the text.'],
      [30, 'President', 'Thank you.'],
    ]),
  ];
  const entries = [{ delegation: 'Arvenia', cites: ['E1'] }];
  const filler = Array.from({ length: 480 }, () => 'word').join(' ');
  const c: Cable = {
    subject: 'Debate on the text',
    summary: 'Arvenia and Belmora supported the text, the President said. ' + filler,
    paragraphs: [{ title: 'Positions', text: 'Belmora spoke for its region. Arvenia asked for a vote.' }],
    assessment: ['The State should follow the debate.'],
    option: null,
    stands_with: null,
  };
  const repairs = repairCableNames(c, s, entries);
  assert.deepEqual(
    repairs.map((x) => `${x.section}:${x.name}`),
    ['summary:belmora', 'paragraph 2:belmora'],
  );
  assert.match(c.summary, /^Arvenia supported the text/);
  assert.equal(c.paragraphs[0]!.text, 'Arvenia asked for a vote.');
  const f = checkCable(c, {
    reportText: 'Arvenia supported the text. Belmora spoke.',
    segments: s,
    decision: null,
    entries,
  });
  assert.ok(!f.some((x) => /no entry of its own/.test(x)), f.join(' | '));
});

test('reasoning effort: a level is sent to Ollama as is', async () => {
  const { createLlmClient } = await import('../engine/llm/index.ts');
  const real = globalThis.fetch;
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_u: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ model: 'm', message: { content: '{}' } }), { status: 200 });
  }) as never;
  try {
    const llm = createLlmClient({ LLM_API_KEY: 'k', LLM_MODEL: 'm' });
    await llm.generate({ messages: [], maxTokens: 5, reasoning: 'low' });
    await llm.generate({ messages: [], maxTokens: 5, reasoning: true });
    await llm.generate({ messages: [], maxTokens: 5 });
  } finally {
    globalThis.fetch = real;
  }
  assert.deepEqual(
    bodies.map((b) => b.think),
    ['low', true, false],
  );
});

test('reopening an earlier full file sends the later decisions of its dossier back, in meeting order', async () => {
  const { runOnce } = await import('../engine/run/run.ts');
  const { reopenFiles } = await import('../engine/work/reopen.ts');
  const { addMeeting, fakeLlm, goodDecision, goodTriage, scripted, services, status } =
    await import('./support/world.ts');
  const sys = (r: { messages: { content: string }[] }) => r.messages[0]?.content ?? '';
  const opts = { trigger: 'manual' as const, maxMinutes: 5, maxCalls: 300, ingest: false };
  const base = scripted(() => goodTriage('full_file', { dossier: { id: null, new_title: 'Test situation' } }));
  const llm = fakeLlm((req) =>
    sys(req).includes('you take the decision on this file')
      ? goodDecision({
          change: (JSON.parse(req.messages[1]?.content ?? '{}') as { dossier?: { standing_position?: string } }).dossier
            ?.standing_position
            ? 'maintains'
            : 'first',
        })
      : base(req),
  );
  const s = services(llm);
  addMeeting(s.db, 'sc/460', { date: '2026-11-10' });
  addMeeting(s.db, 'sc/461', { date: '2026-11-17' });
  await runOnce(s, opts);
  // The earlier file ends without a decision (its provider failed), the later one took "first".
  const f460 = s.db.prepare(`SELECT id FROM files WHERE meeting_id = 'sc/460'`).get() as { id: string };
  s.db.prepare('DELETE FROM dossier_events WHERE file_id = ?').run(f460.id);
  s.db.prepare(`UPDATE files SET status = 'failed', status_reason = 'decision B: provider' WHERE id = ?`).run(f460.id);
  s.db.prepare(`UPDATE dossier_events SET change = 'first'`).run();
  reopenFiles(s.db, ['sc/460'], 'test: provider back');
  assert.equal(status(s.db, 'sc/461').status, 'in_progress');
  assert.equal((s.db.prepare('SELECT COUNT(*) AS n FROM dossier_events').get() as { n: number }).n, 0);
  await runOnce(s, opts);
  const events = s.db
    .prepare(
      `SELECT f.meeting_id, e.change FROM dossier_events e JOIN files f ON f.id = e.file_id ORDER BY e.created_at`,
    )
    .all()
    .map((e) => `${e.meeting_id}:${e.change}`);
  assert.deepEqual(events, ['sc/460:first', 'sc/461:maintains']);
});

// Second round of 2026-11-19: who speaks for a group, decision coherence, decision status not recorded.

test('group statements: a delegation counts; who is not a delegation does not', async () => {
  const { speaksForStates } = await import('../engine/check/member-states.ts');
  assert.ok(speaksForStates('Halvoria'));
  assert.ok(speaksForStates('Halvoria · Foreign Minister'));
  assert.ok(!speaksForStates('UN Secretariat · Acting Director'));
  assert.ok(!speaksForStates('GA · PGA'));
  const s = [
    seg('E1', [
      [10, 'Halvoria', 'Halvoria has the honour of reading out a joint text on behalf of the Meridian Group.'],
    ]),
  ];
  assert.deepEqual(
    groupStatements(s).map((g) => g.speaker),
    ['Halvoria'],
  );
});

test('decision coherence: a recorded vote in the Assembly needs yes, no or abstain', async () => {
  const { checkCoherence } = await import('../engine/check/coherence.ts');
  const voted = [seg('E6', [[100, 'GA · President', 'The draft obtained 118 in favour, 9 against, 31 abstentions.']])];
  const base = {
    position: 'The State asks that the adopted text be put into effect.',
    stands_with: ['national capacity'],
    group_positions: [],
    would_have_voted: null,
  };
  const d = (x: Record<string, unknown>) => ({ ...base, ...x }) as never;
  assert.match(checkCoherence(d({ vote: 'no vote' }), { body: 'ga_plenary', segments: voted }).join(), /recorded vote/);
  assert.deepEqual(checkCoherence(d({ vote: 'in favour' }), { body: 'ga_plenary', segments: voted }), []);
  // A point already taken: the vote is read from what the State would have voted.
  assert.deepEqual(
    checkCoherence(d({ vote: 'no vote', would_have_voted: 'Had it voted, the State would have abstained.' }), {
      body: 'ga_plenary',
      segments: voted,
    }),
    [],
  );
  // Not a member of the Council: no vote there is valid.
  assert.deepEqual(checkCoherence(d({ vote: 'no vote' }), { body: 'security_council', segments: voted }), []);
});

test('decision coherence: stands_with only with groups on the same side', async () => {
  const { checkCoherence } = await import('../engine/check/coherence.ts');
  const ctx = { body: 'ga_plenary' as const, segments: [] };
  // The State takes no side; the groups asked for the blockade to be lifted and for a yes vote.
  const neutral = {
    position: 'It takes no side in the quarrel itself; it speaks for open shipping lanes.',
    vote: 'no vote',
    would_have_voted: null,
    stands_with: ['Coastal Group', 'Meridian Group'],
    group_positions: [
      { group: 'Coastal Group', position: 'Asked for the blockade to be lifted.', stance: 'same' },
      { group: 'Meridian Group', position: 'Urged a vote in favour of the draft.', stance: 'same' },
    ],
  };
  const f = checkCoherence(neutral as never, ctx);
  assert.equal(f.length, 2);
  assert.match(f[0]!, /takes no side; Coastal Group took one/);
  // Abstaining with a group that also abstained is coherent; with one that voted yes it is not.
  const abst = {
    ...neutral,
    position: 'The State abstains.',
    vote: 'abstain',
    stands_with: ['Highland Forum', 'Meridian Group'],
    group_positions: [
      { group: 'Highland Forum', position: 'Abstained on the draft.', stance: 'same' },
      { group: 'Meridian Group', position: 'Voted in favour.', stance: 'same' },
    ],
  };
  assert.deepEqual(
    checkCoherence(abst as never, ctx).map((x) => x.slice(0, 41).trim()),
    ['stands_with: the State abstains; Meridian'],
  );
  // Voting yes while keeping out of the merits stands with a group that also voted yes.
  const yes = {
    ...neutral,
    position: 'The State will vote in favour and takes no side on the contested merits.',
    vote: 'in favour',
    stands_with: ['Highland Forum'],
    group_positions: [{ group: 'Highland Forum', position: 'Voted in favour of the texts.', stance: 'same' }],
  };
  assert.deepEqual(checkCoherence(yes as never, ctx), []);
  const against = {
    ...yes,
    group_positions: [{ group: 'Highland Forum', position: 'Voted against.', stance: 'same' }],
  };
  assert.match(checkCoherence(against as never, ctx).join(), /votes in favour; Highland Forum voted against/);
});

test('triage: decision status "not_recorded" needs no cite and the file goes on as pending', async () => {
  const { applyTriageRules, TriageOutputError } = await import('../engine/work/triage-rules.ts');
  const { loadTeam } = await import('../engine/profile/index.ts');
  const { goodTriage } = await import('./support/world.ts');
  const { TEST_PROFILE } = await import('./support/invented.ts');
  const { checkTimingCite } = await import('../engine/check/timing.ts');
  const segments = [seg('E1', [[10, 'Arvenia', 'We shall address the drafts later.']])];
  const facts = {
    body: 'ga_c3' as const,
    durationSeconds: 3600,
    speakers: 12,
    dossierIds: [],
    duplicateCandidates: [],
    identicalTranscriptOf: null,
    segments: segments as never,
  };
  const raw = (status: Record<string, unknown>) => ({
    ...goodTriage('full_file'),
    decision_point: 'Action on L.40',
    decision_status: status,
  });
  const t = applyTriageRules(raw({ status: 'not_recorded', cite: null }), facts, TEST_PROFILE, loadTeam());
  assert.equal(t.decisionStatus?.status, 'not_recorded');
  assert.equal(t.decisionStatus?.cite, '');
  // already_taken without a segment that records it is still refused, and the message offers not_recorded.
  assert.throws(
    () =>
      applyTriageRules(
        raw({ status: 'already_taken', cite: 'E1', next_step: 'x', next_forum: 'plenary' }),
        facts,
        TEST_PROFILE,
        loadTeam(),
      ),
    (e: Error) => e instanceof TriageOutputError && /not_recorded/.test(e.message),
  );
  assert.deepEqual(
    checkTimingCite({ status: 'not_recorded', cite: '', next_step: null, next_forum: null }, segments),
    [],
  );
});
