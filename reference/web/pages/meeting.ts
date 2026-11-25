// One meeting file: level; for full files the position, who
// decided, who the State stands with (or is closest to) and whether the
// standing position changed; the six roles; documents in tabs. The internal
// check's figures are shown in Metrics only (2026-11-13).
import type { Db } from '../../engine/db/index.ts';
import { loadProfile, loadTeam } from '../../engine/profile/index.ts';
import type { DocumentRow } from '../../engine/work/documents.ts';
import { stanceText, votedWithOf } from '../../engine/check/decision.ts';
import {
  body,
  bodyLabel,
  doc,
  dossierEvents,
  fileEvent,
  meeting,
  meetingNumber,
  meetingRef,
  segmentSpans,
  textOf,
  topic,
  type DecisionBody,
  type MeetingRow,
} from '../data.ts';
import { coincidesNote } from '../../engine/check/line-mark.ts';
import { dot } from '../agents.ts';
import { dayLabel, html, minutes, raw, renderText, type Html } from '../html.ts';
import { describe, meetingHref, triageReason } from './meetings.ts';
import { pressPackView } from './press-pack.ts';

const team = loadTeam();
/** Display order of the strip (mockup): Deputy, counsellors, PR, press. */
const STRIP = ['dpr', 'political', 'legal', 'economic', 'pr', 'press'];
const profile = loadProfile();
const KIND_LABEL: Record<string, string> = {
  triage: 'Triage',
  note: 'Note',
  report: 'Meeting report',
  cable: 'Cable',
  opinion: 'Opinion',
  options_memo: 'Options memo',
  decision: 'Decision',
  press: 'Press draft',
};

interface FileDocs {
  triage?: DocumentRow;
  note?: DocumentRow;
  report?: DocumentRow;
  opinions: DocumentRow[];
  memo?: DocumentRow;
  a?: DocumentRow;
  b?: DocumentRow;
  press?: DocumentRow;
  pack?: DocumentRow;
  cable?: DocumentRow;
}

function docsOf(db: Db, m: MeetingRow): FileDocs {
  const roles = JSON.parse(m.opinions_json ?? '[]') as string[];
  // Opinions, memo, decisions and press belong to a full file; a file shown as a report or a note (one that
  // failed for good, `publicView`) shows only what that level has (2026-11-25).
  const full = m.level === 'full_file';
  return {
    triage: doc(db, m, 'triage'),
    note: doc(db, m, 'note'),
    report: doc(db, m, 'report'),
    opinions: full ? roles.map((r) => doc(db, m, 'opinion', r)).filter((d): d is DocumentRow => !!d) : [],
    memo: full ? doc(db, m, 'options_memo') : undefined,
    a: full ? doc(db, m, 'decision', 'A') : undefined,
    b: full ? doc(db, m, 'decision', 'B') : undefined,
    press: full ? doc(db, m, 'press') : undefined,
    pack: full ? doc(db, m, 'press', 'pack') : undefined,
    cable: doc(db, m, 'cable'),
  };
}

/** Who worked on the meeting: each of the six roles and what it wrote. */
function roleStrip(d: FileDocs, decision: DecisionBody | undefined, triageNote = false): Html {
  const wrote = new Map<string, string[]>();
  const add = (row: DocumentRow | undefined, what: string) => {
    if (!row) return;
    wrote.set(row.author_role, [...(wrote.get(row.author_role) ?? []), what]);
  };
  add(d.triage, triageNote ? 'Note' : 'Triage');
  add(d.note, 'Note');
  add(d.report, 'Meeting report');
  for (const o of d.opinions) {
    const objection = (JSON.parse(o.body_json) as { objection?: boolean }).objection;
    add(o, objection ? 'Opinion · objection' : 'Opinion');
  }
  add(d.memo, 'Options memo');
  add(d.a, decision ? `Decision · option ${decision.option}` : 'Decision');
  add(d.press, 'Press draft');
  add(d.pack, 'Press pack');
  return html`<div class="roles">
    ${STRIP.map((id) => team.roles.find((x) => x.id === id)!).map((r) => {
      const w = wrote.get(r.id);
      return html`<div class="ag-${r.id} ${w ? (r.id === 'pr' ? 'on' : '') : 'off'}">
        <div class="who">${r.title}</div>
        <div class="did">${w ? w.join(' · ') : 'Not required'}</div>
      </div>`;
    })}
  </div>`;
}

const cite = (c: string | undefined) => (c ? html` <span class="cite">[${c.replace(/^\[|\]$/g, '')}]</span>` : html``);

/** Stands with, or for national capacity the closest group and where the State differs; who voted the same way. */
export function standsWith(d: DecisionBody): Html {
  const nc = d.stands_with.length === 1 && d.stands_with[0]?.toLowerCase() === 'national capacity';
  return html`<div>
      <span class="k">Stands with</span>${nc ? 'No group · national capacity' : d.stands_with.join(', ')}
    </div>
    ${
      d.closest_to
        ? html`<div><span class="k">Closest to</span>${d.closest_to}</div>
            <div><span class="k">Differs on</span>${d.differs_on?.text ?? ''}${cite(d.differs_on?.cite)}</div>`
        : ''
    }
    ${votedWith(d)}`;
}

/** "L/12: Arvenia [E1], Belmora [E4] (abstained on PP2 and OP1); L/8: Corvalia [E2]" (invented names) */
export const votedWithLine = (d: DecisionBody): Html =>
  html`${votedWithOf(d.voted_with).map(
    (t, j) =>
      html`${j ? '; ' : ''}${t.text ? html`<strong>${t.text}</strong>: ` : ''}${t.states.map(
        (v, i) => html`${i ? ', ' : ''}${v.state}${cite(v.cite)}${v.note ? ` (${v.note})` : ''}`,
      )}`,
  )}`;

export const votedWith = (d: DecisionBody): Html =>
  votedWithOf(d.voted_with).length
    ? html`<div><span class="k">Voted the same way</span>${votedWithLine(d)}</div>`
    : html``;

/**
 * Against the dossier: the earlier meeting of the same dossier is linked (2026-11-23), the one just
 * before this meeting in meeting order (date, then meeting id), never a later meeting of the same day.
 */
function changeLine(db: Db, m: MeetingRow, d: DecisionBody): Html {
  const earlier = m.dossier_id
    ? dossierEvents(db, m.dossier_id).find(
        (e) => e.meeting_id !== m.id && (e.date < m.date || (e.date === m.date && e.meeting_id < m.id)),
      )
    : undefined;
  const number = earlier ? meetingRef(earlier.title, earlier.body) : undefined;
  const link = earlier
    ? html` <a href="${meetingHref(earlier.meeting_id)}">${dayLabel(earlier.date)}${number ? ` · ${number}` : ''}</a>`
    : '';
  const ev = fileEvent(db, m.file_id);
  const change = ev?.change ?? d.change;
  if (change === 'first' || !earlier) return html`No · first position on this file`;
  // The change of groups is said apart from the mark (2026-11-23).
  const note = coincidesNote(
    JSON.parse(earlier.stands_with) as string[],
    ev ? (JSON.parse(ev.stands_with) as string[]) : d.stands_with,
  );
  const extra = [change === 'revises' ? d.line_change : null, note]
    .filter((x): x is string => !!x)
    .map((x) => x.replace(/\.$/, ''));
  const tail = extra.length ? html`. ${extra.join('. ')}.` : '';
  return change === 'maintains'
    ? html`No · maintains the line of the earlier meeting,${link}${tail}`
    : html`Yes · revises the line of the earlier meeting,${link}${tail}`;
}

function decisionDoc(d: DecisionBody, spans: Map<string, string>): Html {
  const interest = (id: string) => profile.interests.find((i) => i.id === id)?.text ?? id;
  const red = (id: string) => profile.red_lines.find((r) => r.id === id)?.text ?? id;
  return html`<h3>Position</h3>
    <p class="serif17">${d.position}</p>
    ${
      d.would_have_voted
        ? html`<h3>On the vote already held</h3>
            <p>${d.would_have_voted}</p>`
        : ''
    }
    <h3>Why this option</h3>
    <p><strong>Option ${d.option}.</strong> ${renderInline(d.why, spans)}</p>
    ${
      d.rejected.length
        ? html`<h3>Options not taken</h3>
            ${d.rejected.map((r) => html`<p><strong>${r.option}.</strong> ${renderInline(r.why, spans)}</p>`)}`
        : ''
    }
    <h3>Stands with</h3>
    <p>${d.stands_with.join(', ').replace(/^\w/, (c) => c.toUpperCase())}. ${d.stands_with_reason}</p>
    ${d.closest_to ? html`<p>Closest to ${d.closest_to}. Differs on: ${d.differs_on?.text ?? ''}${cite(d.differs_on?.cite)}</p>` : ''}
    ${
      d.group_positions?.length
        ? html`<ul>
            ${d.group_positions.map((g) => html`<li><strong>${g.group}</strong>${cite(g.cite)}: ${stanceText(g)}. ${g.position}</li>`)}
          </ul>`
        : ''
    }
    ${
      votedWithOf(d.voted_with).length
        ? html`<h3>Voted the same way</h3>
            <p>${votedWithLine(d)}</p>`
        : ''
    }
    <h3>Interests</h3>
    <ul>
      ${d.interests.map((i) => html`<li>${interest(i)}</li>`)}
    </ul>
    ${
      d.red_lines.length
        ? html`<h3>Red lines in play</h3>
            <ul>
              ${d.red_lines.map((r) => html`<li>${red(r)}</li>`)}
            </ul>`
        : ''
    }
    <h3>What reopens the file</h3>
    <p>${d.reopens_if}</p>`;
}

const renderInline = (s: string, spans: Map<string, string>) =>
  raw(renderText(s, spans).value.replace(/^<p>|<\/p>$/g, ''));

/** A document tab; `roles` are the agents who wrote it (a dot each by the label, 2026-11-23). */
type Tab = { id: string; label: string; roles: string[]; render: () => Html };

export function meetingPage(db: Db, id: string, tabId: string | null): { title: string; body: Html } | null {
  const m = meeting(db, id);
  if (!m) return null;
  if (m.duplicate_of) {
    return {
      title: topic(db, m),
      body: html`<article class="file plain">
        <div class="meta">${dayLabel(m.date)} · ${bodyLabel(m.body)} · ${meetingNumber(m)}</div>
        <h1 class="title">${topic(db, m)}</h1>
        <p>
          Resumed part of the same session. Its report is in the file of
          <a href="${meetingHref(m.duplicate_of)}">${m.duplicate_of}</a>.
        </p>
        <p><a href="${m.page_url}" rel="noopener">Source transcript ↗</a></p>
      </article>`,
    };
  }
  const d = docsOf(db, m);
  const decision = body<DecisionBody>(d.a);
  const spans = segmentSpans(db, [
    m.id,
    ...(db.prepare('SELECT meeting_id FROM files WHERE duplicate_of = ?').all(m.id) as { meeting_id: string }[]).map(
      (r) => r.meeting_id,
    ),
  ]);
  const show = (row: DocumentRow) =>
    html`${renderText(textOf(row), spans)}
      <p class="meta docmeta">
        ${KIND_LABEL[row.kind] ?? row.kind} ·
        ${dot(row.author_role)}${team.roles.find((r) => r.id === row.author_role)?.title ?? row.author_role}
      </p>`;
  const tabs: Tab[] = [];
  if (d.note) tabs.push({ id: 'note', label: 'Note', roles: [d.note.author_role], render: () => show(d.note!) });
  // A file that failed for good before an accepted report is shown as its triage, a note (2026-11-25).
  if (!d.note && m.triage_note && d.triage)
    tabs.push({
      id: 'note',
      label: 'Note',
      roles: ['dpr'],
      render: () =>
        html`${renderText(triageReason(db, m), spans)}
          <p class="meta docmeta">Note · ${dot('dpr')}Deputy Permanent Representative</p>`,
    });
  if (d.report)
    tabs.push({ id: 'report', label: 'Meeting report', roles: [d.report.author_role], render: () => show(d.report!) });
  if (d.opinions.length)
    tabs.push({
      id: 'opinions',
      label: d.opinions.length > 1 ? 'Section opinions' : 'Opinion',
      roles: d.opinions.map((o) => o.author_role),
      render: () =>
        html`${d.opinions.map(
          (o) =>
            html`<h3>${team.roles.find((r) => r.id === o.author_role)?.title}</h3>
              ${show(o)}`,
        )}`,
    });
  if (d.memo)
    tabs.push({ id: 'memo', label: 'Options memo', roles: [d.memo.author_role], render: () => show(d.memo!) });
  if (decision)
    tabs.push({
      id: 'decision',
      label: 'Decision',
      roles: ['pr'],
      render: () =>
        html`${decisionDoc(decision, spans)}
          <p class="meta docmeta">Decision · ${dot('pr')}Permanent Representative</p>
          ${d.b ? html`<p class="meta">A second, independent decision chose option ${body<DecisionBody>(d.b)?.option} with ${body<DecisionBody>(d.b)?.stands_with.join(', ')}.</p>` : ''}`,
    });
  // The cable: after the decision on full files, after the report on reports (2026-11-13).
  if (d.cable)
    tabs.push({
      id: 'cable',
      label: 'Cable',
      roles: [d.cable.author_role],
      render: () =>
        html`<div class="cable">${renderText(textOf(d.cable!), spans)}</div>
          <p class="meta docmeta">
            Drafted by
            ${dot(d.cable!.author_role)}${team.roles.find((r) => r.id === d.cable!.author_role)?.title ?? d.cable!.author_role}
            · ${dot('pr')}Released by the Permanent Representative
          </p>`,
    });
  // The press tab: the statement or explanation of vote, then the press pack (2026-11-25).
  if (d.press || d.pack)
    tabs.push({
      id: 'press',
      label: 'Press draft',
      roles: ['press'],
      render: () => html`${d.press ? show(d.press) : ''}${d.pack ? pressPackView(d.pack) : ''}`,
    });
  if (d.triage && !m.triage_note)
    tabs.push({
      id: 'triage',
      label: 'Triage',
      roles: ['dpr'],
      render: () => {
        const t = JSON.parse(d.triage!.body_json) as {
          level: string;
          reason: string;
          decisionPoint?: string;
          decisionStatus?: { status: string; cite: string; next_step: string | null } | null;
        };
        const ds = t.decisionStatus;
        return html`<p><strong>${t.level.replace('_', ' ')}.</strong> ${t.reason}</p>
          ${t.decisionPoint ? html`<p>Decision point: ${t.decisionPoint}</p>` : ''}
          ${
            ds
              ? html`<p>
                  ${ds.status === 'already_taken' ? 'Already taken' : 'Pending'}${cite(ds.cite)}${ds.status === 'already_taken' && ds.next_step ? html`. Next step: ${ds.next_step.replace(/\.+$/, '')}` : ''}.
                </p>`
              : ''
          }
          <p class="meta docmeta">Triage · ${dot('dpr')}Deputy Permanent Representative</p>`;
      },
    });
  const preferred = tabId && tabs.some((t) => t.id === tabId) ? tabId : decision ? 'decision' : (tabs[0]?.id ?? '');
  const current = tabs.find((t) => t.id === preferred);
  const desc = describe(db, m);
  const levelBadge =
    m.level === 'full_file'
      ? html`<span class="badge dark">Full file</span>`
      : m.level
        ? html`<span class="badge">${m.level === 'note' ? 'Note' : 'Report'}</span>`
        : '';
  const statusBadge = m.status === 'adopted' ? html`<span class="badge ok">${desc.state}</span>` : '';
  return {
    title: topic(db, m),
    body: html`<article class="file${m.level === 'full_file' ? '' : ' plain'}">
      <div class="file-head">
        <div class="meta">
          ${dayLabel(m.date)} · ${bodyLabel(m.body)} · ${meetingNumber(m)} · ${minutes(m.duration_seconds)}
        </div>
        <div class="badges">${levelBadge}${statusBadge}</div>
      </div>
      <h1 class="title">${topic(db, m)}</h1>
      ${
        decision
          ? html`<div class="grid">
              <div class="span8">
                <div class="eyebrow">The Mission's position</div>
                <p class="serif17">${decision.position}</p>
              </div>
              <div class="span4 facts">
                <div><span class="k">Decided by</span>Permanent Representative</div>
                ${standsWith(decision)}
                <div><span class="k">Changes earlier position</span>${changeLine(db, m, decision)}</div>
              </div>
            </div>`
          : ''
      }
      <div class="eyebrow gap">Who worked on this meeting</div>
      ${roleStrip(d, decision, !!m.triage_note)}
      <nav class="tabs" id="documents" aria-label="Documents of this meeting">
        ${tabs.map((t) => html`<a href="?doc=${t.id}#documents" ${raw(t.id === preferred ? ' aria-current="page"' : '')}>${t.roles.map(dot)}${t.label}</a>`)}<a
          href="${m.page_url}"
          rel="noopener"
          >Source transcript ↗</a
        >
      </nav>
      <div class="doc">${current ? current.render() : html`<p class="meta">No document yet.</p>`}</div>
    </article>`,
  };
}
