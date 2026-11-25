// Transcript completeness heuristic. Normal UN speech yields 10–15 characters
// per second of meeting (observed 2026-11: 10.4–15.3). Far less suggests an
// incomplete automatic transcript or long silences (ballots, suspensions).

export const MIN_CHARS_PER_SECOND = 6;
export const MIN_DURATION_SECONDS = 600;

export function isSuspectIncomplete(characters: number, durationSeconds: number | null): boolean {
  return (
    durationSeconds !== null &&
    durationSeconds >= MIN_DURATION_SECONDS &&
    characters < MIN_CHARS_PER_SECOND * durationSeconds
  );
}

const hm = (s: number): string =>
  Math.floor(s / 3600) + ' h ' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ' min';

/** The one line every document of such a file carries. */
export function incompleteLine(characters: number, durationSeconds: number): string {
  return (
    'Low confidence: the transcript is short for the meeting’s length (' +
    characters.toLocaleString('en-US') +
    ' characters for ' +
    hm(durationSeconds) +
    '); part of the proceedings may be missing or silent.'
  );
}
