// The workflow figure on About (2026-11-23): one row of steps from the UN meeting to the cable, who does
// each, and three bars for how far each kind of meeting goes. HTML and CSS only, the site's type and colours; the
// agents' dots use the site's agent palette (web/agents.ts): the report and the cable are the lead counsellor's
// (shown in the Political Counsellor's colour, the usual lead), the opinions the other counsellors'. On a phone the
// steps stack with arrows down and the bars read as three sentences. No model names.
import { dot } from '../agents.ts';
import { html, type Html } from '../html.ts';

interface FlowStep {
  name: string;
  who: string;
  /** Agents whose dot the step carries (web/agents.ts); none for the UN meeting. */
  agents: string[];
  cls?: string;
}

export const FLOW_STEPS: FlowStep[] = [
  { name: 'UN meeting', who: 'Public transcript', agents: [], cls: 'origin' },
  { name: 'Triage', who: 'Deputy', agents: ['dpr'] },
  { name: 'Report', who: 'Counsellor', agents: ['political'] },
  { name: 'Opinions', who: 'Other counsellors', agents: ['legal', 'economic'] },
  { name: 'Options', who: 'Deputy', agents: ['dpr'] },
  { name: 'Decision', who: 'Permanent Representative', agents: ['pr'], cls: 'decision' },
  { name: 'Cable', who: 'To the capital', agents: ['political'] },
];

/** The bars: the steps (1-based columns) each kind of meeting reaches, and its sentence. */
export const FLOW_BARS = [
  { from: 1, to: 2, extra: null, cls: 'note', text: 'Procedural meetings stop at triage: a short note.' },
  {
    from: 1,
    to: 3,
    extra: 7,
    cls: 'report',
    text: 'Most meetings stop at the report. Security Council meetings and adopted texts also get a cable.',
  },
  {
    from: 1,
    to: 7,
    extra: null,
    cls: 'full',
    text: "Meetings that touch the State's interests go all the way: a full file with a position.",
  },
] as const;

export const FLOW_CAPTION =
  'Every document is checked against the transcript before it is published. No person reviews or edits the work.';

/** The text alternative: the whole figure in words. */
export const FLOW_ALT =
  'How a meeting is worked, from left to right: ' +
  FLOW_STEPS.map((s) => `${s.name} (${s.who})`).join(', then ') +
  '. ' +
  FLOW_BARS.map((b) => b.text).join(' ');

export function flowFigure(): Html {
  return html`<figure class="flow" aria-labelledby="flow-alt">
    <p id="flow-alt" class="visually-hidden">${FLOW_ALT}</p>
    <div class="flow-body" aria-hidden="true">
      <ol class="flow-steps">
        ${FLOW_STEPS.map(
          (s) =>
            html`<li
              class="flow-step ${s.cls ?? ''} ${s.agents.length === 1 ? `ag-${s.agents[0]}` : s.agents.length > 1 ? 'two' : ''}"
            >
              <span class="flow-name"
                ><span class="flow-dots"
                  >${s.agents.length ? s.agents.map(dot) : html`<span class="agent-dot ag-source"></span>`}</span
                >${s.name}</span
              >
              <span class="flow-who">${s.who}</span>
            </li>`,
        )}
      </ol>
      <div class="flow-bars">
        ${FLOW_BARS.map(
          (b, i) =>
            html`<div class="flow-bar ${b.cls}" style="--from:${b.from};--to:${b.to + 1};--row:${i + 1}">
                <span>${b.text}</span>
              </div>
              ${b.extra ? html`<div class="flow-bar ${b.cls} extra" style="--from:${b.extra};--to:${b.extra + 1};--row:${i + 1}"></div>` : ''}`,
        )}
      </div>
    </div>
    <figcaption>${FLOW_CAPTION}</figcaption>
  </figure>`;
}
