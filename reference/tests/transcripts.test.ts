import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { segmentTranscript } from '../engine/evidence/segments.ts';
import {
  downloadTranscript,
  normaliseIndexMeeting,
  TranscriptNotReadyError,
  TranscriptRejectedError,
  unJSON,
} from '../engine/ingest/un-transcripts.ts';
import { realFetch, routeFetch, transcriptRecord } from './support/fake-un.ts';

afterEach(() => {
  globalThis.fetch = realFetch;
});

const meeting = normaliseIndexMeeting({
  slug: 'ga/99/40',
  date: '2026-11-11',
  hasTranscript: true,
  body: 'General Assembly',
})!;

test('only the UN Transcripts host is fetched', async () => {
  await assert.rejects(unJSON('https://example.com/en/meetings.json'), /Untrusted/);
  await assert.rejects(unJSON('http://transcripts.un.org/en/meetings.json'), /Untrusted/);
});

test('a transcript is validated, segmented and speakers attached', async () => {
  routeFetch({ 'ga/99/40.json': transcriptRecord('ga/99/40', '2026-11-11', ['Opening.', 'Second sentence.']) });
  const t = await downloadTranscript(meeting);
  assert.equal(t.segments.length, 1);
  assert.equal(t.segments[0]?.id, 'E1');
  assert.match(t.segments[0]?.text ?? '', /\[0s\] Opening\.\n\[10s\] Second sentence\./);
  assert.equal(t.segments[0]?.speakers[0]?.label, 'GA · President');
});

test('identity, date and language mismatches are rejected', async () => {
  routeFetch({ 'ga/99/40.json': transcriptRecord('ga/99/41', '2026-11-11', ['x']) });
  await assert.rejects(downloadTranscript(meeting), TranscriptRejectedError);
  routeFetch({ 'ga/99/40.json': transcriptRecord('ga/99/40', '2026-11-10', ['x']) });
  await assert.rejects(downloadTranscript(meeting), TranscriptRejectedError);
  routeFetch({ 'ga/99/40.json': transcriptRecord('ga/99/40', '2026-11-11', ['x'], 'fr') });
  await assert.rejects(downloadTranscript(meeting), TranscriptRejectedError);
});

test('a listed transcript without text waits for a later run', async () => {
  routeFetch({ 'ga/99/40.json': transcriptRecord('ga/99/40', '2026-11-11', ['', '  ']) });
  await assert.rejects(downloadTranscript(meeting), TranscriptNotReadyError);
});

test('segmentation never truncates: over 24 segments is rejected', async () => {
  const long = Array.from({ length: 250 }, () => 'x'.repeat(990));
  routeFetch({ 'ga/99/40.json': transcriptRecord('ga/99/40', '2026-11-11', long) });
  await assert.rejects(
    downloadTranscript(meeting),
    (e) => e instanceof TranscriptRejectedError && /24 segments/.test(e.message),
  );
});

test('segments respect the 10,000-character limit and keep every row', () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ start: i, text: 'y'.repeat(900) }));
  const chunks = segmentTranscript(rows);
  assert.ok(chunks.every((c) => c.text.length <= 10_000));
  assert.equal(
    chunks.reduce((n, c) => n + c.text.split('\n').length, 0),
    50,
  );
});
