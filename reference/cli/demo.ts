// A demo with no key and no network: an in-memory mission, three invented meetings and a scripted model
// in place of a real one, worked by the real engine (triage, report, opinions, options, decision, cable,
// press) and shown on the real site. Every name, figure and sentence is invented; nothing is stored.
//   npm run demo        then open http://127.0.0.1:3910
import { runOnce } from '../engine/run/run.ts';
import { startServer } from '../web/server.ts';
import { addMeeting, fakeLlm, goodTriage, scripted, services } from '../tests/support/world.ts';

/** One meeting of each level of work: a note, a report and a full file. */
export const DEMO_MEETINGS: Record<string, 'note' | 'report' | 'full_file'> = {
  'ga/81/50': 'note',
  'ga/c2/81/20': 'report',
  'ga/c3/81/40': 'full_file',
};

export async function buildDemo() {
  const llm = fakeLlm(
    scripted((req) => {
      const input = req.messages[1]?.content ?? '';
      const slug = Object.keys(DEMO_MEETINGS).find((s) => input.includes(s));
      return goodTriage(slug ? DEMO_MEETINGS[slug] : 'report');
    }),
  );
  const mission = services(llm);
  for (const slug of Object.keys(DEMO_MEETINGS)) addMeeting(mission.db, slug);
  const run = await runOnce(mission, { trigger: 'manual', maxMinutes: 5, maxCalls: 400, ingest: false });
  return { mission, run, calls: llm.requests.length };
}

if (import.meta.main) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT) || 3910;
  const { mission, run, calls } = await buildDemo();
  console.log(
    `Demo run ${run.outcome}: ${Object.keys(DEMO_MEETINGS).length} invented meetings, ${calls} scripted calls.`,
  );
  startServer(mission.db, host, port).on('listening', () =>
    console.log(`Demo site on http://${host}:${port} (invented data; Ctrl+C to stop)`),
  );
}
