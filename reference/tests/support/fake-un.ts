// Mocked UN Transcripts responses for tests. No network.
import { readFileSync } from 'node:fs';

export const realFetch = globalThis.fetch;

export const indexFixture = (): { meetings: Record<string, unknown>[]; hasMore: boolean } =>
  JSON.parse(readFileSync(new URL('../fixtures/index-2026-11-02.json', import.meta.url), 'utf8'));

/** Routes fetch by URL; unmatched URLs fail the test loudly. */
export function routeFetch(routes: Record<string, unknown>, log: string[] = []): string[] {
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    log.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response('not found', { status: 404 });
    return Response.json(routes[key]);
  }) as typeof fetch;
  return log;
}

/** A small transcript record in the published shape. */
export function transcriptRecord(slug: string, date: string, sentences: string[], language = 'en'): unknown {
  return {
    url: 'https://transcripts.un.org/en/' + slug,
    video: { date: date + 'T00:00:00.000Z', title: 'Test meeting ' + slug },
    transcript: {
      language,
      data: [
        {
          start: 0,
          speaker: { affiliation: 'PGA', affiliation_full: 'GA', function: 'President', group: null },
          paragraphs: [{ sentences: sentences.map((text, i) => ({ start: i * 10, end: i * 10 + 9, text })) }],
        },
      ],
    },
  };
}
