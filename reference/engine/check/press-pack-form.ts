// The press pack's form (2026-11-25). Pure: no model.
//   adoption  "voted" only for a text put to a vote: a text adopted without a vote is "joined the consensus on"
//             or "supported"
//   quote     one or two sentences of the stakeout remarks, word for word, that give the reason: not the
//             headline again, not the list of texts
//   release   three short paragraphs (what happened; the position and the quote; what comes next); the body
//             named without a meeting number ("in the Third Committee of the General Assembly")
//   reference elsewhere a meeting is "the Third Committee's 45th meeting", never "Third Committee, 45th meeting"
import type { PressPack } from './press-pack.ts';

export interface Adoption {
  /** The draft's symbol as the report gives it ("L.7/Rev.1"). */
  draft: string;
  withoutVote: boolean;
}

/** How each text was adopted, from the report's votes (result "adopted without a vote", or no tally). */
export function adoptionsOf(votes: { draft: string; result: string; in_favour: number | null }[]): Adoption[] {
  return votes.map((v) => ({
    draft: v.draft,
    withoutVote: /without (a )?vote|without objection|by consensus|by acclamation/i.test(v.result),
  }));
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const bare = (x: string) =>
  norm(x)
    .replace(/[“”"«»,.;:!?]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const sentencesOf = (s: string) =>
  s
    .split(/(?<=[.!?])["”]?\s+|\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
const parts = (p: PressPack): [string, string][] => [
  ['stakeout remarks', `${p.stakeout.remarks}\n${p.stakeout.question}\n${p.stakeout.answer}`],
  ['press release', `${p.release.headline}\n${p.release.dateline}\n${p.release.body}`],
  ['social media post', p.social],
];

/** The State says it voted (past tense), as opposed to joining a consensus. */
const STATE_VOTED =
  /\b(we|I|my delegation|my country|the State|the Permanent Mission)\b[^.;!?]{0,60}\bvoted\b|\bthe State's vote\b|\bvoted (in favour|for|against)\b/i;
/** The texts named all together: "the three texts", "all the texts", "each text", "the texts". */
const ALL_TEXTS =
  /\b(the (two|three|four|five|six|seven|eight|nine|ten|\d+) (draft )?(texts|resolutions|drafts)|all (the |three |two )?(texts|resolutions|drafts)|each (text|resolution|draft)|both (texts|resolutions|drafts)|the texts|the resolutions)\b/i;

export function checkPackAdoption(p: PressPack, adoption: Adoption[]): string[] {
  const without = adoption.filter((a) => a.withoutVote);
  if (!without.length) return [];
  const f: string[] = [];
  const all = without.length === adoption.length;
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [part, text] of parts(p))
    for (const s of sentencesOf(text)) {
      if (!STATE_VOTED.test(s)) continue;
      // What the State voted on is what follows "voted" ("joined the consensus on L.7 and voted for L.9").
      const after = s.slice(s.search(/\bvoted\b/i));
      const named = without.find((a) => key(after).includes(key(a.draft)));
      if (all || named || ALL_TEXTS.test(after))
        f.push(
          `adoption: the ${part} says the State voted, but ${all ? 'no text was put to a vote' : `${without.map((a) => a.draft).join(', ')} ${without.length > 1 ? 'were' : 'was'} adopted without a vote`}: write "joined the consensus on" or "supported" for ${all ? 'them' : 'those'}, "voted" only for a text put to a vote: "${s.slice(0, 120)}"`,
        );
    }
  return f;
}

const LIST = /\b(the (two|three|four|five|six|\d+) (texts|resolutions|drafts)|texts? on [^.]{0,80}, [^.]{0,80} and )/i;

export function checkPackQuote(p: PressPack): string[] {
  const f: string[] = [];
  const quote = sentencesOf(p.release.quote);
  const remarks = bare(p.stakeout.remarks);
  if (quote.length > 2) f.push(`quote: ${quote.length} sentences; one or two from the stakeout remarks`);
  if (!quote.every((q) => remarks.includes(bare(q))))
    f.push('quote: take one or two sentences of the stakeout remarks, word for word');
  if (LIST.test(p.release.quote)) f.push('quote: it repeats the list of texts; quote the sentence that says why');
  const words = (s: string) => new Set(norm(s).match(/\b[a-z]{5,}\b/g) ?? []);
  const q = words(p.release.quote);
  const h = words(p.release.headline);
  if (q.size && [...q].filter((w) => h.has(w)).length / q.size > 0.5)
    f.push('quote: it repeats the headline; quote the sentence that gives the reason');
  return f;
}

/**
 * The release names the body, not the meeting: "At the Third Committee's 45th meeting" becomes "In the Third
 * Committee of the General Assembly", by code (2026-11-25; models copy the reference given for the
 * remarks). Returns the repairs made, kept in the document.
 */
export function repairReleaseReference(p: PressPack, reference: string, organ: string): string[] {
  if (!reference) return [];
  const esc = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b(at|in|during)\\s+${esc}`, 'gi');
  const repairs: string[] = [];
  for (const k of ['headline', 'body'] as const)
    p.release[k] = p.release[k].replace(re, (m, prep: string) => {
      const to = `${/^[A-Z]/.test(prep) ? 'In' : 'in'} ${organ}`;
      repairs.push(`release: "${m}" → "${to}"`);
      return to;
    });
  return repairs;
}

const MEETING_NUMBER = /\b\d+(st|nd|rd|th)( plenary)? meetings?\b/i;
const AWKWARD = /\b(Committee|Council|Assembly),\s+\d+(st|nd|rd|th)( plenary)? meeting/;

export function checkPackRelease(p: PressPack, organ: string): string[] {
  const f: string[] = [];
  const paragraphs = p.release.body.split(/\n\s*\n/).filter((x) => x.trim());
  if (paragraphs.length !== 3)
    f.push(
      `release: ${paragraphs.length} paragraph${paragraphs.length === 1 ? '' : 's'}; write three short ones, separated by a blank line: what happened; the position and the quote; what comes next`,
    );
  else if (!bare(paragraphs[1]!).includes(bare(sentencesOf(p.release.quote)[0] ?? '')))
    f.push('release: the quote goes in the second paragraph, with the position');
  else if (!/Permanent Representative/.test(paragraphs[1]!))
    f.push('release: say who is quoted: the Permanent Representative, in the second paragraph');
  const release = `${p.release.headline}\n${p.release.dateline}\n${p.release.body}`;
  const n = MEETING_NUMBER.exec(release);
  if (n) f.push(`release: "${n[0]}"; name the body without the meeting number ("in ${organ}")`);
  if (!norm(release).includes(norm(organ).replace(/^the /, ''))) f.push(`release: name the body as "${organ}"`);
  for (const [part, text] of parts(p)) {
    const a = AWKWARD.exec(text);
    if (a) f.push(`reference: the ${part} writes "${a[0]}"; write "the <body>'s <number> meeting"`);
  }
  return f;
}
