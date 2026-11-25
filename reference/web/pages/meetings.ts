// Meetings: one week at a time. Header: the week on the left (the
// label opens the list of weeks, the only way between weeks; 2026-11-24),
// one search box on the right. One line per meeting; notes collapsed into
// "+ N procedural meetings".
import type { Db } from '../../engine/db/index.ts';
import { offsetDate, weekStart } from '../../engine/ingest/scope.ts';
import { loadTeam } from '../../engine/profile/index.ts';
import {
  body,
  bodyLabel,
  clip,
  doc,
  firstSentence,
  meetingNumber,
  search,
  topic,
  fileEvent,
  weekCounts,
  weekMeetings,
  weeks,
  type DecisionBody,
  type MeetingRow,
} from '../data.ts';
import { namedDot } from '../agents.ts';
import { dayLabel, esc, html, raw, rangeLabel, type Html } from '../html.ts';

const team = loadTeam();
const roleTitle = (id: string) => team.roles.find((r) => r.id === id)?.title ?? id;
export const meetingHref = (id: string) => '/meetings/' + id;

/** The week label: Monday to Friday, or to the last day with a meeting. */
export function weekLabel(monday: string, rows: { date: string }[] = []): string {
  const last = rows.reduce((d, r) => (r.date > d ? r.date : d), offsetDate(monday, 4));
  return rangeLabel(monday, last);
}

/** The one state shown on a line, in plain words (2026-11-16). */
// No line says "Not adopted" or "Low confidence" (2026-11-25): a file that failed for good arrives here as a
// report or a note (`publicView`).
export type RowState = 'Position adopted' | 'Position revised' | 'Report' | 'Note' | 'In preparation';

/** A file not finished yet: queued, triaged (held or not) or in progress. */
export const inPreparation = (m: MeetingRow): boolean => ['queued', 'triaged', 'in_progress'].includes(m.status);

/** Characters of the summary that fit two lines (wide and narrow screens); the full text is on the meeting page. */
// The title is never cut by characters (2026-11-24): it is shown whole, up to three lines on a wide screen.
// Measured on the 2026-11-24 screenshots: at 1440 px the summary column holds about 40 sans characters a line; on a
// phone it runs full width (about 45 a line).
export const LINE_CHARS = { what: { wide: 76, narrow: 80 } };

/** What a line says about a meeting: class, one sentence and its one state. */
export function describe(db: Db, m: MeetingRow): { cls: string; what: string; state: RowState } {
  if (inPreparation(m))
    return { cls: 'prep', what: m.duplicate_of ? `Resumed part of ${m.duplicate_of}.` : '', state: 'In preparation' };
  if (m.duplicate_of)
    return {
      cls: '',
      what: `Resumed part of ${m.duplicate_of}; reported in that file.`,
      state: m.status === 'noted' ? 'Note' : 'Report',
    };
  if (m.status === 'adopted') {
    const d = body<DecisionBody>(doc(db, m, 'decision', 'A'));
    // "maintains" is a position adopted again, unchanged; only a revision is named apart.
    return {
      cls: 'full',
      what: d?.position ?? '',
      state: (fileEvent(db, m.file_id)?.change ?? d?.change) === 'revises' ? 'Position revised' : 'Position adopted',
    };
  }
  if (m.status === 'noted') {
    const n = doc(db, m, 'note');
    if (n) return { cls: '', what: firstSentence(n.text.replace(/^Low confidence:[^\n]*\n/, '')), state: 'Note' };
    const t = triageReason(db, m);
    return { cls: '', what: t ? firstSentence(t) : '', state: 'Note' };
  }
  const r = doc(db, m, 'report');
  return { cls: '', what: r ? `Reported by the ${roleTitle(r.author_role)}` : 'Reported', state: 'Report' };
}

/** The triage's reason: the note of a file shown as its triage (`publicView`). */
export function triageReason(db: Db, m: MeetingRow): string {
  const t = doc(db, m, 'triage');
  return t ? String((JSON.parse(t.body_json) as { reason?: string }).reason ?? '') : '';
}

const hasCable = (db: Db, m: MeetingRow): boolean => !!doc(db, m, 'cable');

/** A text in two lengths, cut at a word, so it keeps to two lines on a wide and on a narrow screen. */
export function twoLines(s: string, size: { wide: number; narrow: number }): Html {
  const wide = clip(s, size.wide);
  const narrow = clip(s, size.narrow);
  return wide === narrow ? html`${wide}` : html`<span class="wide">${wide}</span><span class="narrow">${narrow}</span>`;
}

/** The agents who worked on a full file, in the order of the role strip (2026-11-23: a row of dots). */
function agentDots(db: Db, m: MeetingRow): Html {
  if (m.level !== 'full_file' || inPreparation(m)) return html``;
  const report = doc(db, m, 'report');
  const roles = [
    'dpr',
    ...(report ? [report.author_role] : []),
    ...(JSON.parse(m.opinions_json ?? '[]') as string[]),
    'pr',
    ...(doc(db, m, 'press') || doc(db, m, 'press', 'pack') ? ['press'] : []),
  ];
  const order = ['dpr', 'political', 'legal', 'economic', 'pr', 'press'];
  const seen = [...new Set(roles)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return html`<span class="agents"
    >${seen.map((r) => namedDot(r, team.roles.find((x) => x.id === r)?.title ?? r))}</span
  >`;
}

function row(db: Db, m: MeetingRow, snippet?: Html, title = topic(db, m)): Html {
  const d = describe(db, m);
  return html`<a class="row ${d.cls}" href="${meetingHref(m.id)}"
    ><span class="when">${dayLabel(m.date)}<span class="body">${bodyLabel(m.body)}</span></span
    ><span class="topic" title="${title}">${title}</span
    ><span class="what">${snippet ?? twoLines(d.what, LINE_CHARS.what)}</span
    ><span class="state"
      ><span class="label">${d.state}${agentDots(db, m)}</span
      ><span class="cable">${hasCable(db, m) ? html`<span class="rowmark">Cable</span>` : ''}</span></span
    ></a
  >`;
}

/**
 * Topics of a week; two meetings with the same topic get their meeting number (2026-11-16), in front so
 * that the three-line cut of a very long title never hides it (2026-11-23).
 */
export function weekTopics(db: Db, rows: MeetingRow[]): Map<string, string> {
  const t = new Map(rows.map((m) => [m.id, topic(db, m)]));
  const count = new Map<string, number>();
  for (const v of t.values()) count.set(v.toLowerCase(), (count.get(v.toLowerCase()) ?? 0) + 1);
  for (const m of rows) {
    const v = t.get(m.id) as string;
    if ((count.get(v.toLowerCase()) ?? 0) > 1) t.set(m.id, `${meetingNumber(m)}: ${v}`);
  }
  return t;
}

/** Newest day first; within a day, finished meetings first and those in preparation at the end. */
export const ordered = (rows: MeetingRow[]): MeetingRow[] =>
  [...rows].sort(
    (a, b) =>
      b.date.localeCompare(a.date) || Number(inPreparation(a)) - Number(inPreparation(b)) || b.id.localeCompare(a.id),
  );

/** One sentence under the tabs, linking to About (2026-11-16). */
const intro = html`<p class="context">
  A fictional Permanent Mission, run by AI agents, follows real UN meetings and takes positions. No person reviews the
  work. <a href="/about">How it works</a>
</p>`;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * The week selector (2026-11-23): the date opens a list of every week with work, newest first, grouped
 * by month (of the Monday), with the number of meetings of each; the week shown and the week in course are
 * marked. A native <details>: it opens with a click, a tap, Enter or Space, and its links are reached with Tab.
 */
export function weekMenu(
  db: Db,
  monday: string | null,
  all: string[],
  label: string,
  rows: MeetingRow[],
  today = new Date().toISOString().slice(0, 10),
): Html {
  const counts = weekCounts(db);
  const current = weekStart(today);
  const groups: { month: string; weeks: string[] }[] = [];
  for (const w of all) {
    const month = `${MONTHS[Number(w.slice(5, 7)) - 1]} ${w.slice(0, 4)}`;
    if (groups.at(-1)?.month !== month) groups.push({ month, weeks: [] });
    groups.at(-1)!.weeks.push(w);
  }
  const n = (w: string) => counts.get(w) ?? 0;
  return html`<details class="weeks">
    <summary aria-label="${label}. Choose a week">
      <h1>${label}</h1>
      <span class="caret" aria-hidden="true">▾</span>
    </summary>
    <div class="weekmenu">
      ${groups.map(
        (g) =>
          html`<p class="month">${g.month}</p>
            <ul>
              ${g.weeks.map(
                (w) =>
                  html`<li>
                    <a href="/meetings?week=${w}" ${raw(w === monday ? ' aria-current="true"' : '')}
                      ><span
                        >${weekLabel(w, w === monday ? rows : [])}${w === current ? html` <span class="now">This week</span>` : ''}</span
                      ><span class="count">${n(w)} meeting${n(w) === 1 ? '' : 's'}</span></a
                    >
                  </li>`,
              )}
            </ul>`,
      )}
    </div>
  </details>`;
}

/** The week bar: the week selector alone, no arrows beside it (2026-11-24), and the search box. */
function weekBar(db: Db, monday: string | null, all: string[], q: string, rows: MeetingRow[]): Html {
  const label = monday ? weekLabel(monday, rows) : 'Search';
  return html`<section class="weekbar">
    <div class="weeknav">${weekMenu(db, monday, all, label, rows)}</div>
    <form class="search" action="/meetings" method="get" role="search">
      <label class="visually-hidden" for="q">Search meetings and documents</label
      ><input id="q" name="q" type="search" value="${q}" placeholder="Search meetings by topic, country or body" />
    </form>
  </section>`;
}

export function meetingsPage(db: Db, monday: string | null): Html {
  const all = weeks(db);
  if (!monday)
    return html`${intro}${weekBar(db, null, all, '', [])}
      <div class="list"><p class="empty">No meetings yet.</p></div>`;
  const rows = ordered(weekMeetings(db, monday));
  const topics = weekTopics(db, rows);
  const main = rows.filter((m) => m.status !== 'noted' || m.duplicate_of);
  const notes = rows.filter((m) => m.status === 'noted' && !m.duplicate_of);
  return html`${intro}${weekBar(db, monday, all, '', rows)}
    <div class="list">
      ${main.length ? main.map((m) => row(db, m, undefined, topics.get(m.id))) : html`<p class="empty">No meetings followed this week.</p>`}${
        notes.length
          ? html`<details class="more">
              <summary>+ ${notes.length} procedural meeting${notes.length > 1 ? 's' : ''}</summary>
              ${notes.map((m) => row(db, m, undefined, topics.get(m.id)))}
            </details>`
          : ''
      }
    </div>`;
}

export function searchPage(db: Db, q: string): Html {
  const all = weeks(db);
  const results = q.trim().length >= 2 ? search(db, q.trim()) : [];
  const mark = (s: string) => {
    if (!s) return html``;
    const i = s.toLowerCase().indexOf(q.trim().toLowerCase());
    if (i < 0) return html`${s}`;
    return raw(
      `…${esc(s.slice(0, i))}<mark>${esc(s.slice(i, i + q.trim().length))}</mark>${esc(s.slice(i + q.trim().length))}…`,
    );
  };
  return html`${intro}${weekBar(db, null, all, q, [])}
    <p class="meta">
      ${results.length} result${results.length === 1 ? '' : 's'} for “${q}” in all weeks.
      <a href="/meetings">Back to the week</a>
    </p>
    <div class="list">
      ${results.length ? results.map((r) => row(db, r.m, r.snippet ? mark(r.snippet) : undefined)) : html`<p class="empty">Nothing found.</p>`}
    </div>`;
}

export { meetingNumber };
