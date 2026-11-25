// Positions (dossiers): list by subject; standing position; who the State
// stands with (or is closest to); how it moved, linking each meeting file.
import type { Db } from '../../engine/db/index.ts';
import { loadProfile } from '../../engine/profile/index.ts';
import {
  bodyLabel,
  documentBody,
  dossierEvents,
  dossiers,
  meetingNumber,
  type DecisionBody,
  type MeetingRow,
} from '../data.ts';
import { dateLabel, dayLabel, html, raw, type Html } from '../html.ts';
import { meetingHref } from './meetings.ts';
import { standsWith, votedWithLine } from './meeting.ts';
import { votedWithOf } from '../../engine/check/decision.ts';

const profile = loadProfile();
const CHANGE: Record<string, string> = {
  first: 'Position first adopted',
  maintains: 'Position maintained',
  revises: 'Position revised',
};
const STATE: Record<string, string> = {
  first: 'position adopted',
  maintains: 'position held',
  revises: 'position revised',
};
const slug = (id: string) => id.replace(/^dossier:/, '');

export function positionsPage(db: Db, selected: string | null): Html | null {
  const all = dossiers(db);
  const current = selected ? all.find((d) => slug(d.id) === selected) : all[0];
  if (selected && !current) return null;
  const list = html`<nav class="dossiers" aria-label="Positions">
    ${all.map(
      (d) =>
        html`<a href="/positions/${slug(d.id)}" ${raw(d.id === current?.id ? ' aria-current="true"' : '')}
          ><div class="name">${d.title}</div>
          <div class="meta">
            ${d.body ? bodyLabel(d.body) : ''} · ${d.meetings} meeting${d.meetings === 1 ? '' : 's'} ·
            ${d.last ? STATE[d.last] : 'no position yet'}
          </div></a
        >`,
    )}
  </nav>`;
  if (!current)
    return html`<section class="intro">
      <h1>Positions</h1>
      <p class="meta">No positions yet. A position is taken only on a full file.</p>
    </section>`;
  const events = dossierEvents(db, current.id);
  const latest = events[0] ? documentBody<DecisionBody>(db, events[0].document_id) : undefined;
  const interest = profile.interests.find((i) => i.id === current.interest);
  const red = profile.red_lines.find((r) => r.id === current.red_line);
  const opened = events.at(-1)?.date ?? current.created_at.slice(0, 10);
  return html`<section class="intro">
      <h1>Positions</h1>
      <p>What the Mission holds on each file, and how that changed from meeting to meeting.</p>
    </section>
    <div class="positions">
      ${list}
      <section class="dossier">
        <div class="meta">${current.body ? bodyLabel(current.body) : ''} · open since ${dateLabel(opened)}</div>
        <h2 class="title dossier-title">${current.title}</h2>
        <div class="eyebrow">Standing position</div>
        <p class="serif17">${current.standing_position ?? 'No standing position.'}</p>
        <div class="kv">
          ${latest ? html`<div class="facts-inline">${standsWith(latest)}</div>` : ''}
          <div>
            <div class="k">Interest engaged</div>
            <div>${interest ? `${String(interest.rank).padStart(2, '0')} · ${interest.text}` : '—'}</div>
          </div>
          <div>
            <div class="k">Red line in play</div>
            <div>${red?.text ?? 'None'}</div>
          </div>
          <div>
            <div class="k">Reopens if</div>
            <div>${latest?.reopens_if ?? '—'}</div>
          </div>
        </div>
        <h3 class="eyebrow section-h">How the position moved</h3>
        <ol class="moves">
          ${events.map((e) => {
            const d = documentBody<DecisionBody>(db, e.document_id);
            return html`<li>
              <div class="meta">
                ${dayLabel(e.date)}<br />${meetingNumber({ title: e.title, id: e.meeting_id, body: e.body as MeetingRow['body'] })}
              </div>
              <div class="dot" aria-hidden="true"></div>
              <div>
                <div><strong>${CHANGE[e.change] ?? e.change}</strong> · ${JSON.parse(e.stands_with).join(', ')}</div>
                <div>${e.position}</div>
                ${d?.closest_to ? html`<div class="meta">Closest to ${d.closest_to}; differs on: ${d.differs_on?.text ?? ''}</div>` : ''}
                ${d && votedWithOf(d.voted_with).length ? html`<div class="meta">Voted the same way: ${votedWithLine(d)}</div>` : ''}
                <div><a href="${meetingHref(e.meeting_id)}">Open the meeting file</a></div>
              </div>
            </li>`;
          })}
        </ol>
      </section>
    </div>`;
}
