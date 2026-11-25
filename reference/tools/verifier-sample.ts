// Verifier comparison (2026-11-23): the sample of real claims and the subtle corruptions, built by
// code from a database copy. Pure selection; no model call. Used by tools/verifier-compare.ts.
import { createHash } from 'node:crypto';
import type { Db } from '../engine/db/index.ts';
import { isMemberState } from '../engine/check/member-states.ts';

export interface SampledClaim {
  key: string; // <meeting>#<index>
  meetingId: string;
  index: number;
  claim: string;
  cite: string;
  segment: { label: string; speakers: string[]; text: string };
  production: string | null; // the checker's stored verdict on this claim, if any
}

export type CorruptionKind = 'figure' | 'delegation' | 'vote' | 'stance';
export interface Corruption {
  kind: CorruptionKind;
  source: string; // SampledClaim.key
  original: string;
  corrupted: string;
  change: string; // "177 → 178"
  segment: SampledClaim['segment'];
}

const hash = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Every claim of the accepted report of each adopted full file, with its cited segment. */
export function adoptedClaims(db: Db): SampledClaim[] {
  const reports = db
    .prepare(
      `SELECT d.id, d.meeting_id, d.body_json FROM documents d JOIN llm_calls c ON c.id = d.llm_call_id
       JOIN files f ON f.id = d.file_id
       WHERE d.kind = 'report' AND f.status = 'adopted' AND f.level = 'full_file' AND c.error_kind IS NULL
         AND c.epoch >= f.accept_from_epoch AND c.epoch >= f.rework_from_epoch AND c.epoch >= f.report_from_epoch
       ORDER BY d.meeting_id, d.attempt DESC, d.created_at DESC`,
    )
    .all() as { id: string; meeting_id: string; body_json: string }[];
  const seen = new Set<string>();
  const out: SampledClaim[] = [];
  for (const r of reports) {
    if (seen.has(r.meeting_id)) continue; // newest accepted attempt only
    seen.add(r.meeting_id);
    const claims = (JSON.parse(r.body_json) as { claims?: { claim: string; cite: string }[] }).claims ?? [];
    claims.forEach((c, index) => {
      const seg = db
        .prepare('SELECT label, text, speakers_json FROM segments WHERE meeting_id = ? AND label = ?')
        .get(r.meeting_id, c.cite) as { label: string; text: string; speakers_json: string } | undefined;
      if (!seg) return;
      const prod = db
        .prepare(`SELECT body_json FROM documents WHERE kind = 'check' AND ref = ? ORDER BY created_at DESC LIMIT 1`)
        .get(`claim:${r.id}:${index}`) as { body_json: string } | undefined;
      out.push({
        key: `${r.meeting_id}#${index}`,
        meetingId: r.meeting_id,
        index,
        claim: c.claim,
        cite: c.cite,
        segment: {
          label: seg.label,
          speakers: [...new Set((JSON.parse(seg.speakers_json) as { label: string }[]).map((s) => s.label))],
          text: seg.text,
        },
        production: prod ? ((JSON.parse(prod.body_json) as { verdict?: string }).verdict ?? null) : null,
      });
    });
  }
  return out;
}

/** Claims the checker did not pass in production first, then the rest in sha-256 order of their key. */
export function sampleClaims(all: SampledClaim[], n: number): SampledClaim[] {
  const flagged = all.filter((c) => c.production && c.production !== 'supported');
  const rest = all.filter((c) => !flagged.includes(c)).sort((a, b) => hash(a.key).localeCompare(hash(b.key)));
  return [...flagged, ...rest].slice(0, n);
}

const tokens = (text: string): Set<string> => new Set(text.replace(/\[\d+s\]/g, ' ').match(/\d+/g) ?? []);

function corruptFigure(c: SampledClaim): Omit<Corruption, 'kind' | 'source' | 'segment'> | null {
  const inSeg = tokens(c.segment.text);
  for (const m of c.claim.matchAll(/(?<![\w./-])(\d{2,})(?![\w./-])/g)) {
    const fig = m[1]!;
    const n = Number(fig);
    if (!inSeg.has(fig) || n >= 1900) continue; // a figure the segment gives; not a year
    const alt = [n + 1, n - 1, n + 2, n - 2].map(String).find((x) => !inSeg.has(x) && Number(x) > 0);
    if (!alt) continue;
    const corrupted = c.claim.slice(0, m.index) + alt + c.claim.slice(m.index! + fig.length);
    return { original: c.claim, corrupted, change: `${fig} → ${alt}` };
  }
  return null;
}

function corruptDelegation(c: SampledClaim): Omit<Corruption, 'kind' | 'source' | 'segment'> | null {
  const states = [...new Set(c.segment.speakers.map((l) => l.split(' · ')[0]!.trim()).filter(isMemberState))];
  const named = states.filter((s) => c.claim.includes(s));
  const others = states.filter((s) => !c.claim.includes(s));
  if (!named.length || !others.length) return null;
  const from = named[0]!;
  const to = others[Number.parseInt(hash(c.key).slice(0, 4), 16) % others.length]!;
  const article = (s: string) => (THE.test(s) ? 'the ' : '');
  const corrupted = c.claim.replace(new RegExp(`(\\b[Tt]he )?${escapeRe(from)}`), (_m, the?: string) => {
    const a = article(to);
    return the ? (the[0] === 'T' ? a.replace(/^t/, 'T') : a) + to : to;
  });
  return { original: c.claim, corrupted: corrupted[0]!.toUpperCase() + corrupted.slice(1), change: `${from} → ${to}` };
}

const THE =
  /^(Russian Federation|United States|United Kingdom|Netherlands|Philippines|Republic of|Democratic|Central African|Dominican|Gambia|Bahamas|Comoros|Maldives|Marshall|Solomon|Sudan|Niger|Congo|Czech|United Arab|Syrian|Lao)/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const VOTE: [RegExp, string][] = [
  [/\bvoted in favour\b/, 'voted against'],
  [/\bvoted against\b/, 'voted in favour'],
  [/\babstained\b/, 'voted against'],
  [/\bwithout a vote\b/, 'by a recorded vote'],
  [/\bwithout objection\b/, 'by a recorded vote'],
  [/\bby consensus\b/, 'by a recorded vote'],
  [/\bwas adopted\b/, 'was rejected'],
  [/\badopted\b/, 'rejected'],
];
const STANCE: [RegExp, string][] = [
  [/\bsupported\b/, 'opposed'],
  [/\bopposed\b/, 'supported'],
  [/\bwelcomed\b/, 'regretted'],
  [/\bregretted\b/, 'welcomed'],
  [/\bcalled for\b/, 'rejected'],
  [/\burged\b/, 'cautioned against'],
  [/\bbacked\b/, 'opposed'],
  [/\brejected\b/, 'accepted'],
  [/\bcriticised\b/, 'praised'],
  [/\bexpressed concern\b/, 'expressed satisfaction'],
];

function corruptBy(rules: [RegExp, string][], c: SampledClaim): Omit<Corruption, 'kind' | 'source' | 'segment'> | null {
  for (const [re, to] of rules) {
    const m = c.claim.match(re);
    if (m) return { original: c.claim, corrupted: c.claim.replace(re, to), change: `${m[0]} → ${to}` };
  }
  return null;
}

const TALLY = /\d+\s+(in favour|votes?\b|to\s+\d+)/;

const MAKERS: Record<CorruptionKind, (c: SampledClaim) => Omit<Corruption, 'kind' | 'source' | 'segment'> | null> = {
  figure: corruptFigure,
  delegation: corruptDelegation,
  // A tally next to the verb would give the change away without the segment: those claims are skipped.
  vote: (c) => (TALLY.test(c.claim) ? null : corruptBy(VOTE, c)),
  stance: (c) => (TALLY.test(c.claim) ? null : corruptBy(STANCE, c)),
};

/**
 * `perKind` corruptions of each kind, one per source claim, drawn first from `preferred` (the sample) and
 * then from `all`, in sha-256 order; a claim is corrupted once only. Only claims the checker passed are used.
 */
export function corruptions(preferred: SampledClaim[], all: SampledClaim[], perKind: number): Corruption[] {
  const order = (xs: SampledClaim[]) => [...xs].sort((a, b) => hash('c' + a.key).localeCompare(hash('c' + b.key)));
  const pool = [...order(preferred), ...order(all.filter((c) => !preferred.includes(c)))].filter(
    (c) => c.production === 'supported',
  );
  const used = new Set<string>();
  const out: Corruption[] = [];
  for (const kind of Object.keys(MAKERS) as CorruptionKind[]) {
    let n = 0;
    for (const c of pool) {
      if (n >= perKind) break;
      if (used.has(c.key)) continue;
      const r = MAKERS[kind](c);
      if (!r || r.corrupted === r.original) continue;
      used.add(c.key);
      out.push({ kind, source: c.key, segment: c.segment, ...r });
      n++;
    }
  }
  return out;
}
