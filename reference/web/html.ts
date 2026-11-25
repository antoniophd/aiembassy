// HTML helpers: escaping, the page layout (header, views, footer notice) and
// a small renderer for the documents' plain text (headings, bullets, bold,
// segment cites). No client-side script is needed.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const esc = (v: unknown): string =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

/** A trusted HTML fragment (already escaped). */
export class Html {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString(): string {
    return this.value;
  }
}
export const raw = (s: string): Html => new Html(s);

/** Tagged template: interpolations are escaped unless they are Html (or arrays of Html). */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0] ?? '';
  values.forEach((v, i) => {
    const part = (x: unknown): string =>
      x instanceof Html ? x.value : Array.isArray(x) ? x.map(part).join('') : x == null || x === false ? '' : esc(x);
    out += part(v) + (strings[i + 1] ?? '');
  });
  return new Html(out);
}

/** The notice on every page and in About (2026-11-13). */
export const NOTICE = [
  'The "State" and its Permanent Mission are fictional and do not represent any government, delegation or organisation. Every document is written by AI agents from the public UN Transcripts, which are automatic and unofficial text. No person reviews or edits the work.',
];

export type View = 'meetings' | 'positions' | 'about' | 'metrics';

/** A version for the stylesheet link, so a changed site.css is never served from a browser's cache. */
const CSS_VERSION = createHash('sha256')
  .update(readFileSync(new URL('./static/site.css', import.meta.url)))
  .digest('hex')
  .slice(0, 10);

export function page(opts: {
  title: string;
  view: View;
  updated: string | null;
  body: Html;
  noindex?: boolean;
  alerts?: string[];
}): string {
  const tab = (v: View, label: string, href: string) =>
    html`<a href="${href}" ${raw(opts.view === v ? ' aria-current="page"' : '')}>${label}</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${opts.noindex ? '<meta name="robots" content="noindex, nofollow">' : ''}
<title>${esc(opts.title)} — AI Embassy</title>
<link rel="stylesheet" href="/static/site.css?v=${CSS_VERSION}">
</head>
<body>
<div class="wrap">
<header class="top"><a class="site" href="/">AI Embassy</a><nav class="demos" aria-label="Section"><a href="/meetings" aria-current="page">Embassy</a></nav></header>
${html`<nav class="views" aria-label="Embassy views">${tab('meetings', 'Meetings', '/meetings')}${tab('about', 'About', '/about')}${opts.view === 'metrics' ? tab('metrics', 'Metrics', '/metrics') : ''}<span class="updated">${opts.updated ? `Updated ${opts.updated} UTC` : 'Not updated yet'}</span></nav>`}
${(opts.alerts ?? []).map((a) => `<p class="alert" role="status">Alert: ${esc(a)}</p>`).join('')}
<main>
${opts.body}
</main>
<footer class="foot">${NOTICE.map((p) => `<p>${esc(p)}</p>`).join('')}</footer>
</div>
</body>
</html>`;
}

/** "[E3]" and "[E3][E4]" become small cite marks; the title gives the segment time span. */
function cites(escaped: string, spans: Map<string, string>): string {
  return escaped.replace(/\[(E\d{1,2})\]/g, (_m, label: string) => {
    const t = spans.get(label);
    return `<span class="cite" title="${esc(t ? `Segment ${label}, ${t}` : 'Segment ' + label)}">[${label}]</span>`;
  });
}

const inline = (s: string, spans: Map<string, string>): string =>
  cites(esc(s), spans).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

/**
 * Renders a document's text: "# " is dropped (the page has the title), "## " is
 * a subheading, "- " a bullet, blank lines separate paragraphs.
 */
export function renderText(text: string, spans: Map<string, string> = new Map()): Html {
  const out: string[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.map((l) => inline(l, spans)).join('<br>')}</p>`);
    if (list.length) out.push(`<ul>${list.map((l) => `<li>${inline(l, spans)}</li>`).join('')}</ul>`);
    para = [];
    list = [];
  };
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) flush();
    else if (t.startsWith('# ')) flush();
    else if (t.startsWith('### ')) {
      flush();
      out.push(`<h4>${inline(t.slice(4), spans)}</h4>`);
    } else if (t.startsWith('## ')) {
      flush();
      out.push(`<h3>${inline(t.slice(3), spans)}</h3>`);
    } else if (/^[-*] /.test(t)) {
      if (para.length) flush();
      list.push(t.slice(2));
    } else {
      if (list.length) flush();
      para.push(t);
    }
  }
  flush();
  return raw(out.join('\n'));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const parts = (d: string) => {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return { y, m, day, dow: new Date(Date.UTC(y, m - 1, day)).getUTCDay() };
};

/** "Mon, Nov 2" */
export function dayLabel(d: string): string {
  const p = parts(d);
  return `${DAYS[p.dow]}, ${MONTHS[p.m - 1]} ${p.day}`;
}
/** "Nov 2, 2026" */
export function dateLabel(d: string): string {
  const p = parts(d);
  return `${MONTHS[p.m - 1]} ${p.day}, ${p.y}`;
}
/** "Nov 2 – 6" or "Oct 26 – Nov 1" */
export function rangeLabel(from: string, to: string): string {
  const a = parts(from);
  const b = parts(to);
  return a.m === b.m
    ? `${MONTHS[a.m - 1]} ${a.day} – ${b.day}`
    : `${MONTHS[a.m - 1]} ${a.day} – ${MONTHS[b.m - 1]} ${b.day}`;
}
/** "12:40" from seconds */
export const clock = (s: number): string =>
  `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
export const minutes = (s: number): string =>
  s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
