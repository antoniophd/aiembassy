// Weekly view of the index: which in-scope meetings are eligible for work.
// Read-only: no database, no model.
import { BODIES, offsetDate, weekStart, type Body } from './scope.ts';
import { bodyLabelAgrees, fetchIndex, type IndexedMeeting, type IndexWindow } from './un-transcripts.ts';

/** Eligible: completed (transcript published), not in the future, body label consistent. */
export function isEligible(m: IndexedMeeting, today: string): boolean {
  return m.hasTranscript && m.date <= today && bodyLabelAgrees(m);
}

export interface BodyWeek {
  body: Body;
  eligible: IndexedMeeting[];
  /** Listed in the index but without a published transcript yet. */
  pending: IndexedMeeting[];
}

export interface WeekListing {
  from: string;
  to: string;
  today: string;
  bodies: BodyWeek[];
  /** Index body label disagrees with the slug: excluded, shown for inspection. */
  labelMismatches: IndexedMeeting[];
  unrecognised: string[];
  totalEntries: number;
}

const byDateThenId = (a: IndexedMeeting, b: IndexedMeeting): number =>
  a.date.localeCompare(b.date) || a.id.localeCompare(b.id, 'en', { numeric: true });

export function groupWeek(window: IndexWindow, today: string): WeekListing {
  const inWeek = window.meetings.filter((m) => m.date >= window.from && m.date <= window.to);
  return {
    from: window.from,
    to: window.to,
    today,
    bodies: BODIES.map((body) => {
      const own = inWeek.filter((m) => m.body === body).sort(byDateThenId);
      return {
        body,
        eligible: own.filter((m) => isEligible(m, today)),
        pending: own.filter((m) => !m.hasTranscript && bodyLabelAgrees(m)),
      };
    }),
    labelMismatches: inWeek.filter((m) => !bodyLabelAgrees(m)),
    unrecognised: window.unrecognised,
    totalEntries: window.totalEntries,
  };
}

/** Lists the week (Monday to Sunday) containing `date`, from the live index. */
export async function listWeek(date: string, today: string): Promise<WeekListing> {
  const from = weekStart(date);
  return groupWeek(await fetchIndex(from, offsetDate(from, 6)), today);
}
