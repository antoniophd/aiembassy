// The press pack on a meeting page (2026-11-25): in the press tab, the three parts under their headings,
// each with a button that copies it. The button needs the one small script of the site (/static/copy.js); without
// it the text is still there to select.
import type { PressPack } from '../../engine/check/press-pack.ts';
import type { DocumentRow } from '../../engine/work/documents.ts';
import { html, raw, renderText, type Html } from '../html.ts';

/** One part: heading, copy button, the text in a block the button copies. */
const part = (id: string, title: string, text: string): Html =>
  html`<section class="packpart">
    <div class="packhead">
      <h3>${title}</h3>
      <button class="copy" type="button" data-copy="${id}">Copy</button>
    </div>
    <div id="${id}">${renderText(text)}</div>
  </section>`;

export function pressPackView(doc: DocumentRow): Html {
  const p = (JSON.parse(doc.body_json) as { pack: PressPack }).pack;
  return html`<div class="pack">
      ${part('pack-stakeout', 'Stakeout remarks', `${p.stakeout.remarks}\n\nQ: ${p.stakeout.question}\n\nA: ${p.stakeout.answer}`)}
      ${part('pack-release', 'Press release', `**${p.release.headline}**\n\n${p.release.dateline}\n\n${p.release.body}`)}
      ${part('pack-social', 'Social media post', p.social)}
    </div>
    ${raw('<script src="/static/copy.js" defer></script>')}`;
}
