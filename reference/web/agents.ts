// One palette for the agents across the site (2026-11-23: well-separated tones), CSS variables in site.css
// (--agent-<role>). Used only on: the top border of each cell of "Who worked on this meeting", a dot by each
// document tab and in each document's footer, a row of dots on full files in Meetings, the legend in About and the
// workflow figure. Never the only signal: the agent's name is always shown next to it (or, in the Meetings row,
// given as the dot's accessible name and title, and on the file's page).
import { html, type Html } from './html.ts';

export const AGENT_COLOURS: Record<string, string> = {
  pr: '#1f6245', // Permanent Representative: green (the accent)
  dpr: '#2a5db0', // Deputy: blue
  political: '#b5432a', // Political Counsellor: brick red
  legal: '#9a3a8c', // Legal Counsellor: violet (#7b3fa3 moved towards magenta: it read as the Deputy's blue under protanopia)
  economic: '#986a00', // Economic & Environment Counsellor: amber (#b07a00 darkened to reach 4:1 on the tint)
  press: '#4a4f55', // Press Counsellor: charcoal grey
};

export const isAgent = (role: string): boolean => role in AGENT_COLOURS;

/** A decorative dot in the agent's colour; the name is given beside it. */
export const dot = (role: string): Html =>
  isAgent(role) ? html`<span class="agent-dot ag-${role}" aria-hidden="true"></span>` : html``;

/** A dot that stands alone (Meetings row): it carries the name as its accessible name and title. */
export const namedDot = (role: string, name: string): Html =>
  isAgent(role)
    ? html`<span class="agent-dot ag-${role}" role="img" aria-label="${name}" title="${name}"></span>`
    : html``;
