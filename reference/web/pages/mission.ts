// About (formerly Mission): the State, interests, red lines, variable
// alignment (one rule, no table by subject), the team, how it works (team,
// levels, internal control, without figures) and the notice. All from profile/state.json and profile/team.json.
import { loadProfile, loadTeam } from '../../engine/profile/index.ts';
import { html, NOTICE, type Html } from '../html.ts';
import { dot } from '../agents.ts';
import { flowFigure } from './flow.ts';

const profile = loadProfile();
const team = loadTeam();

export function missionPage(): Html {
  const t = profile.traits as Record<string, string>;
  return html`<section class="intro">
      <h1>Permanent Mission of a Member State</h1>
      <p>
        The State has no name, no map and no real-world counterpart. It is defined only by what it needs from the United
        Nations. Every position the Mission adopts must follow from this page.
      </p>
    </section>
    ${flowFigure()}
    <div class="mission">
      <div>
        <section class="panel">
          <h2>The State</h2>
          <dl>
            <div>
              <dt>Weight</dt>
              <dd>${t.weight}</dd>
            </div>
            <div>
              <dt>Economy</dt>
              <dd>${t.economy}</dd>
            </div>
            <div>
              <dt>Security</dt>
              <dd>${t.security}</dd>
            </div>
            <div>
              <dt>At the United Nations</dt>
              <dd>${t.at_the_un}</dd>
            </div>
          </dl>
        </section>
        <section class="panel">
          <h2>Interests, in order</h2>
          <ol class="ranked">
            ${profile.interests.map(
              (i) =>
                html`<li>
                  <span class="n">${String(i.rank).padStart(2, '0')}</span>
                  <div>${i.text}</div>
                </li>`,
            )}
          </ol>
          <p class="meta mt">${profile.conflict_rule}</p>
        </section>
        <section class="panel">
          <h2>Variable alignment</h2>
          <p>${profile.alignment.rule}</p>
          <p class="meta mt">
            On every full file the decision records who spoke in the meeting and whether each group defended the same
            position. The State stands with those that did; when none did, it acts in national capacity.
          </p>
        </section>
        <section class="panel">
          <h2>Red lines</h2>
          <ul class="bul">
            ${profile.red_lines.map((r) => html`<li>${r.text}</li>`)}
          </ul>
          <h2 class="mt">How it behaves</h2>
          <ul class="bul">
            ${(profile.behaviour ?? []).map((b) => html`<li>${b}</li>`)}
          </ul>
        </section>
      </div>
      <aside>
        <section class="panel">
          <h2>The team</h2>
          <p>Six AI agents. ${team.rule}</p>
          <div class="team">
            ${team.roles.map(
              (r) =>
                html`<div class="ag-${r.id}">
                  <div>${dot(r.id)}<strong>${r.title}</strong></div>
                  <div class="small">${r.function}</div>
                </div>`,
            )}
          </div>
        </section>
        <section class="panel">
          <h2>How it works</h2>
          <p>
            <strong>Team.</strong> The Deputy reads every completed Security Council and General Assembly meeting in the
            UN Transcripts and decides how much work it deserves. Counsellors report and give opinions on their
            subjects; the Permanent Representative decides; the Press Counsellor drafts only when asked.
          </p>
          <p>
            <strong>Three levels.</strong> <em>Note</em>: procedural or of no interest, a few lines by the Deputy.
            <em>Report</em>: worth knowing, one counsellor reports, no decision; a cable to Capital on every Security
            Council meeting, and elsewhere when the meeting touches an interest and a text was voted or adopted.
            <em>Full file</em>: an interest is engaged, so report, opinions, an options memo and a decision by the
            Permanent Representative, a cable to Capital, and a press draft when called for.
          </p>
          <p>
            <strong>Internal control.</strong> Every figure, quotation and speaker in a report is checked by code
            against the cited transcript segment. On full files a checker model of another family verifies each claim
            and asks one yes/no question per red line; the Permanent Representative decides twice, independently, and
            the two decisions are compared. A document that fails is written again by the same writer, shown what
            failed, and then by a backup writer; a file that still fails is not adopted, and the reason is shown.
            Anything written by the fallback model, or decided differently twice, is marked low confidence.
          </p>
          <p class="meta">
            No person reviews or edits the work. The check confirms coherence and source support; it is not independent
            fact-checking.
          </p>
        </section>
        <section class="panel">
          <h2>About this site</h2>
          ${NOTICE.map((p) => html`<p>${p}</p>`)}
        </section>
      </aside>
    </div>`;
}
