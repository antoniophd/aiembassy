// Another meeting inside a recording (2026-11-23). A UN recording of one Council meeting may hold the
// whole of the meeting before it (called to order, then adjourned) before its own meeting is called to order;
// read whole, the triage, report and decision mixed both meetings and the file joined the other's dossier.
// In the Security Council the President opens every meeting with "The <number>th meeting of the Security
// Council is called to order". When a transcript holds that line for its own number AND for another number,
// only the text from its own call to order up to the next foreign call to order is the meeting: everything
// models and checks see (segments and speaker spans) is cut to that span. Labels are kept (E3 stays E3);
// segments wholly outside are dropped. Stored segments are not changed.
import type { SpeakerSpan } from './segments.ts';

export interface BoundSegment {
  label: string;
  start: number;
  end: number;
  text: string;
  speakers: SpeakerSpan[];
}

const CALL = /The (\d[\d,]*)(?:st|nd|rd|th)? meeting of the Security Council is called to order/gi;

interface Mark {
  seg: number;
  at: number; // index in the segment text where the line (with its [Ns] stamp) starts
  seconds: number;
  number: number;
}

function marks(segments: BoundSegment[]): Mark[] {
  const out: Mark[] = [];
  segments.forEach((s, seg) => {
    for (const m of s.text.matchAll(CALL)) {
      const stampAt = s.text.lastIndexOf('[', m.index);
      const stamp = stampAt >= 0 ? /^\[(\d+)s\]/.exec(s.text.slice(stampAt)) : null;
      const at = stamp && m.index! - stampAt <= stamp[0].length + 2 ? stampAt : m.index!;
      out.push({ seg, at, seconds: stamp ? Number(stamp[1]) : s.start, number: Number(m[1]!.replace(/,/g, '')) });
    }
  });
  return out;
}

export interface Bounds {
  /** Seconds where the meeting starts and ends inside the recording; null when nothing was cut. */
  from: number | null;
  to: number | null;
  foreign: number[]; // meeting numbers found and cut away
}

/** The meeting's own span of a Security Council recording; the material unchanged when no cut applies. */
export function ownMeeting<T extends BoundSegment>(
  body: string,
  number: number,
  segments: T[],
  speakers: SpeakerSpan[],
): { segments: T[]; speakers: SpeakerSpan[]; bounds: Bounds } {
  const none = { segments, speakers, bounds: { from: null, to: null, foreign: [] } };
  if (body !== 'security_council') return none;
  const all = marks(segments);
  const start = all.find((m) => m.number === number);
  const foreign = all.filter((m) => m.number !== number);
  if (!start || !foreign.length) return none;
  const end = foreign.find((m) => m.seg > start.seg || (m.seg === start.seg && m.at > start.at));
  const from = foreign.some((m) => m.seg < start.seg || (m.seg === start.seg && m.at < start.at)) ? start : null;
  if (!from && !end) return none;
  const inSpan = (sp: SpeakerSpan) => (!from || sp.end > from.seconds) && (!end || sp.start < end.seconds);
  const out: T[] = [];
  segments.forEach((s, i) => {
    if ((from && i < from.seg) || (end && i > end.seg)) return;
    let text = s.text;
    let a = s.start;
    let b = s.end;
    if (end && i === end.seg) {
      text = text.slice(0, end.at);
      b = end.seconds;
    }
    if (from && i === from.seg) {
      text = text.slice(from.at);
      a = from.seconds;
    }
    if (!text.trim()) return;
    out.push({ ...s, text, start: a, end: b, speakers: s.speakers.filter(inSpan) });
  });
  return {
    segments: out,
    speakers: speakers.filter(inSpan),
    bounds: {
      from: from?.seconds ?? null,
      to: end?.seconds ?? null,
      foreign: [...new Set(foreign.map((m) => m.number))],
    },
  };
}
