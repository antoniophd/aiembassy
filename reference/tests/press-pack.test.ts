// The press pack (2026-11-25): three parts in one document, checked by code; two tries, then the file is
// adopted without it and the page says nothing. Invented data only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkPackCoherence,
  checkPackGrounding,
  checkPackLength,
  checkPackPlain,
  checkPackTone,
  parsePressPack,
  PressPackOutputError,
} from '../engine/check/press-pack.ts';
import { runOnce } from '../engine/run/run.ts';
import { acceptedDocument } from '../engine/work/documents.ts';
import { pressPackPrompt } from '../prompts/press.pack.ts';
import { meetingPage } from '../web/pages/meeting.ts';
import {
  addMeeting,
  fakeLlm,
  goodDecision,
  goodPressPack,
  goodReport,
  goodTriage,
  scripted,
  services,
  status,
} from './support/world.ts';

const pack = (extra: Record<string, unknown> = {}) => parsePressPack(goodPressPack(extra));
const sources = [JSON.stringify(goodReport()), JSON.stringify(goodDecision())];
const system = (r: { messages: { content: string }[] }) => r.messages[0]?.content ?? '';
const opts = { trigger: 'manual' as const, maxMinutes: 5, maxCalls: 200, ingest: false };

test('the invented pack passes every check', () => {
  const p = pack();
  assert.deepEqual(checkPackLength(p), []);
  assert.deepEqual(checkPackGrounding(p, sources, '2026-11-10'), []);
  assert.deepEqual(checkPackCoherence(p, goodDecision() as never), []);
  assert.deepEqual(checkPackTone(p, ['Union of Lakeland States']), []);
});

test('lengths: remarks, release, social characters, emoji and hashtags', () => {
  const short = pack({ stakeout: { remarks: 'We support access.', question: 'Why?', answer: 'Because.' } });
  assert.match(checkPackLength(short).join(), /stakeout remarks have 3 words; write 120 to 180/);
  const long = pack({ social: 'x'.repeat(281) });
  assert.match(checkPackLength(long).join(), /281 characters; at most 280/);
  const tags = pack({ social: 'We voted in favour. #One #Two 🙂' });
  assert.match(checkPackLength(tags).join(), /no emoji/);
  assert.match(checkPackLength(tags).join(), /2 hashtags; at most 1/);
  const r = goodPressPack();
  const thin = pack({ release: { ...r.release, body: 'Short. "' + r.release.quote + '"' } });
  assert.match(checkPackLength(thin).join(), /press release has \d+ words .*write 200 to 300/);
});

test('grounding: figures, symbols and names only from the accepted documents', () => {
  const p = pack({ social: 'The State voted in favour of A/99/L.77 with Corvalia; 14 votes. #Access' });
  const f = checkPackGrounding(p, sources, '2026-11-10').join('\n');
  assert.match(f, /figure "14"/);
  assert.match(f, /cites "A\/99\/L\.77"/);
  assert.match(f, /names "Corvalia"/);
  // The meeting's date and the names in the file pass.
  assert.deepEqual(
    checkPackGrounding(pack({ social: 'Arvenia spoke; 13 votes; 10 November 2026.' }), sources, '2026-11-10'),
    [],
  );
});

test('coherence: same option and vote; no sentence where the State votes otherwise; the quote', () => {
  const d = goodDecision() as never;
  assert.match(checkPackCoherence(pack({ option: 'B' }), d).join(), /option B; the decision chose option A/);
  assert.match(checkPackCoherence(pack({ vote: 'abstain' }), d).join(), /the vote is "abstain"/);
  const s = goodPressPack().stakeout;
  const off = pack({ stakeout: { ...s, answer: 'We will abstain on the text in the plenary.' } });
  assert.match(checkPackCoherence(off, d).join(), /says the State votes abstain; the decision says in favour/);
  const r = goodPressPack().release;
  assert.match(
    checkPackCoherence(pack({ release: { ...r, quote: 'Something else entirely.' } }), d).join(),
    /quote is not in the body/,
  );
});

test('tone: no delegation in a critical sentence; no platform, model or internal process', () => {
  const s = goodPressPack().stakeout;
  const blame = pack({ stakeout: { ...s, answer: 'We deplore that Arvenia blocked the text.' } });
  assert.match(checkPackTone(blame, []).join(), /names Arvenia in a critical sentence/);
  assert.match(checkPackTone(pack({ social: 'Our position, now on Twitter.' }), []).join(), /mentions "Twitter"/);
  assert.match(
    checkPackTone(pack({ social: 'Written by AI agents for the State.' }), []).join(),
    /mentions "AI agents"/,
  );
  assert.match(
    checkPackTone(pack({ social: 'As option A says, we vote in favour.' }), []).join(),
    /mentions "option A"/,
  );
  assert.throws(() => parsePressPack({ option: 'A' }), PressPackOutputError);
});

test('the prompt is versioned and its example carries placeholders, not values', () => {
  assert.match(pressPackPrompt.version, /^1\.2\.0\+s\d+$/);
  const text = system({
    messages: pressPackPrompt.build({
      meeting: { id: 'x', body: 'b', title: 't', date: 'd', name: 'n', reference: 'r', organ: 'o' },
      adoption: [],
      decision: {},
      facts: '',
      feedback: [],
    }),
  });
  assert.match(text, /<the option decided>/);
  assert.doesNotMatch(text, /Arvenia|Belmora|\bL\.\d+|\d{2,} votes/);
});

async function fullWorld(packAnswer: () => unknown) {
  const base = scripted(() => goodTriage('full_file'));
  const llm = fakeLlm((req) => (system(req).includes('Write the press pack') ? packAnswer() : base(req)));
  const s = services(llm);
  addMeeting(s.db, 'ga/c3/99/40', { date: '2026-11-10' });
  await runOnce(s, opts);
  return { s, llm };
}

test('a full file whose decision asks for a public line gets the statement and the pack, shown with copy buttons', async () => {
  const { s } = await fullWorld(() => goodPressPack());
  assert.equal(status(s.db, 'ga/c3/99/40').status, 'adopted');
  const f = s.db.prepare(`SELECT id FROM files WHERE meeting_id = 'ga/c3/99/40'`).get() as { id: string };
  assert.ok(acceptedDocument(s.db, f.id, 'ga/c3/99/40', 'press', ''));
  assert.ok(acceptedDocument(s.db, f.id, 'ga/c3/99/40', 'press', 'pack'));
  const html = meetingPage(s.db, 'ga/c3/99/40', 'press')!.body.value;
  for (const h of ['Stakeout remarks', 'Press release', 'Social media post'])
    assert.match(html, new RegExp(`<h3>${h}</h3>`));
  assert.equal((html.match(/class="copy"/g) ?? []).length, 3);
  assert.match(html, /src="\/static\/copy\.js"/);
});

test('a pack that fails twice is left out: the file is adopted without it and the page says nothing', async () => {
  const { s, llm } = await fullWorld(() => goodPressPack({ social: 'We deplore that Arvenia blocked the text.' }));
  const tries = llm.requests.filter((r) => system(r).includes('Write the press pack'));
  assert.equal(tries.length, 2);
  // The second try hears the first rejection.
  assert.match(tries[1]!.messages[1]!.content, /previous_attempt_rejected_for.*critical sentence/);
  assert.equal(status(s.db, 'ga/c3/99/40').status, 'adopted');
  const html = meetingPage(s.db, 'ga/c3/99/40', 'press')!.body.value;
  assert.doesNotMatch(html, /Stakeout remarks|press pack|failed/i);
});

test('plain remarks: no procedural jargon or symbols; "plenary meeting" only for the Assembly (2026-11-25)', () => {
  assert.deepEqual(checkPackPlain(pack(), 'ga_c3'), []);
  const s = goodPressPack().stakeout;
  const jargon = pack({ stakeout: { ...s, answer: 'Our explanation of vote covers operative paragraph 4.' } });
  assert.match(checkPackPlain(jargon, 'ga_c3').join(), /procedural jargon \("explanation of vote"\)/);
  const symbol = pack({ stakeout: { ...s, answer: 'We voted for A/C.3/99/L.12 today.' } });
  assert.match(checkPackPlain(symbol, 'ga_c3').join(), /cite the symbol/);
  const r = goodPressPack().release;
  const plenary = pack({ release: { ...r, body: r.body.replace('today voted', 'at the 40th plenary meeting voted') } });
  assert.match(checkPackPlain(plenary, 'ga_c3').join(), /press release says "plenary meeting"/);
  assert.match(checkPackPlain(plenary, 'security_council').join(), /plenary meeting/);
  assert.deepEqual(checkPackPlain(plenary, 'ga_plenary'), []);
  // The prompt hears the meeting by its real body and asks for plain words, with a placeholder example.
  const text = system({
    messages: pressPackPrompt.build({
      meeting: {
        id: 'x',
        body: 'Third Committee',
        title: 't',
        date: 'd',
        name: 'Third Committee, 40th meeting',
        reference: "the Third Committee's 40th meeting",
        organ: 'the Third Committee of the General Assembly',
      },
      adoption: [],
      decision: {},
      facts: '',
      feedback: [],
    }),
  });
  assert.match(text, /"plenary meeting" only for a meeting of the General Assembly itself/);
  assert.match(text, /No procedural jargon/);
  assert.match(text, /the text on <subject>/);
});

test('voting is not joining a consensus; the quote gives the reason; the release in three paragraphs, no meeting number', async () => {
  const { checkPackAdoption, checkPackQuote, checkPackRelease } = await import('../engine/check/press-pack-form.ts');
  const { adoptionsOf } = await import('../engine/check/press-pack-form.ts');
  const organ = 'the Third Committee of the General Assembly';
  const mixed = adoptionsOf([
    { draft: 'L.7', result: 'adopted without a vote', in_favour: null },
    { draft: 'L.9', result: 'adopted', in_favour: 120 },
  ]);
  const s = goodPressPack().stakeout;
  const all = pack({ stakeout: { ...s, answer: 'We voted in favour of the two texts today.' } });
  assert.match(
    checkPackAdoption(all, mixed).join(),
    /L\.7 was adopted without a vote: write "joined the consensus on"/,
  );
  assert.match(checkPackAdoption(pack({ social: 'The State voted for L.7 today.' }), mixed).join(), /adoption/);
  assert.deepEqual(
    checkPackAdoption(pack({ social: 'The State joined the consensus on L.7 and voted for L.9.' }), mixed),
    [],
  );
  const none = adoptionsOf([{ draft: 'L.7', result: 'adopted without a vote', in_favour: null }]);
  assert.match(checkPackAdoption(pack(), none).join(), /no text was put to a vote/);
  // The quote: from the remarks, word for word, not the headline or the list of texts.
  assert.deepEqual(checkPackQuote(pack()), []);
  const r = goodPressPack().release;
  assert.match(
    checkPackQuote(pack({ release: { ...r, quote: 'Nothing in the remarks says this.' } })).join(),
    /word for word/,
  );
  const listed = pack({
    stakeout: { ...s, remarks: s.remarks + ' We backed the texts on access, on convoys and on relief.' },
    release: { ...r, quote: 'We backed the texts on access, on convoys and on relief.' },
  });
  assert.match(checkPackQuote(listed).join(), /repeats the list of texts/);
  // The release: three paragraphs, the organ without a number, the quote in the second.
  assert.deepEqual(checkPackRelease(pack(), organ), []);
  assert.match(
    checkPackRelease(pack({ release: { ...r, body: r.body.replace(/\n\n/g, ' ') } }), organ).join(),
    /1 paragraph/,
  );
  const numbered = pack({ release: { ...r, body: r.body.replace(organ, "the Third Committee's 40th meeting") } });
  assert.match(checkPackRelease(numbered, organ).join(), /"40th meeting"; name the body without the meeting number/);
  const awkward = pack({ social: 'At the Third Committee, 40th meeting, the State backed the draft.' });
  assert.match(checkPackRelease(awkward, organ).join(), /writes "Committee, 40th meeting"/);
});

test('the release reference is repaired by code; "against" inside a subject is not a vote against; the quote is attributed', async () => {
  const { repairReleaseReference, checkPackRelease } = await import('../engine/check/press-pack-form.ts');
  const organ = 'the Third Committee of the General Assembly';
  const r = goodPressPack().release;
  const p = pack({ release: { ...r, body: "At the Third Committee's 40th meeting, " + r.body } });
  assert.deepEqual(repairReleaseReference(p, "the Third Committee's 40th meeting", organ), [
    `release: "At the Third Committee's 40th meeting" → "In ${organ}"`,
  ]);
  assert.match(p.release.body, /^In the Third Committee of the General Assembly, /);
  assert.deepEqual(repairReleaseReference(pack(), '', organ), []);
  const d = goodDecision() as never;
  const subject = pack({ social: 'The State voted for the text on violence against women and girls. #Access' });
  assert.deepEqual(checkPackCoherence(subject, d), []);
  const unnamed = pack({ release: { ...r, body: r.body.replace('the Permanent Representative said', 'it was said') } });
  assert.match(checkPackRelease(unnamed, organ).join(), /say who is quoted/);
});
