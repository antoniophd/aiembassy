// One agent palette for the site (2026-11-23): CSS variables, used only where listed, never without the name.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { loadTeam } from '../engine/profile/index.ts';
import { runOnce } from '../engine/run/run.ts';
import { AGENT_COLOURS } from '../web/agents.ts';
import { startServer } from '../web/server.ts';
import { addMeeting, fakeLlm, goodTriage, scripted, services } from './support/world.ts';

const css = readFileSync(new URL('../web/static/site.css', import.meta.url), 'utf8');
const lum = (h: string) => {
  const c = [1, 3, 5]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

test('the palette: CSS variables match, the PR is the accent green, every colour 4:1 on the site backgrounds', () => {
  assert.equal(AGENT_COLOURS.pr, '#1f6245');
  assert.match(css, /--accent:#1f6245/);
  for (const [role, hex] of Object.entries(AGENT_COLOURS)) {
    assert.match(css, new RegExp(`--agent-${role}:${hex}`), role);
    for (const bg of ['#ffffff', '#f4f7f4', '#e8f0ea']) assert.ok(ratio(hex, bg) >= 4, `${role} on ${bg}`);
  }
  assert.deepEqual(
    Object.keys(AGENT_COLOURS).sort(),
    loadTeam()
      .roles.map((r) => r.id)
      .sort(),
  );
  // Used only by the agent classes, the strip border, the tabs, the Meetings row, the flow figure.
  const uses = [...css.matchAll(/([^{}]+)\{[^}]*var\(--agent[^)]*\)/g)].map((m) => m[1]!.trim());
  for (const sel of uses)
    assert.match(
      sel,
      /^(\.ag-[a-z]+|\.agent-dot|\.roles>div|\.team>div|\.flow-[\w.:>\s-]+)(,.*)?$/,
      'colour used on ' + sel,
    );
});

// Colour-vision simulation (Machado et al. 2009, severity 1, linear RGB) and CIE76 ΔE in Lab: every pair of agents
// stays apart (ΔE ≥ 10) for protanopia, deuteranopia and tritanopia (2026-11-23).
const MACHADO: Record<string, number[][]> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};
const lab = (h: string, m?: number[][]) => {
  const c = [1, 3, 5]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const [r, g, b] = m
    ? m.map((row) => Math.min(1, Math.max(0, row[0]! * c[0]! + row[1]! * c[1]! + row[2]! * c[2]!)))
    : c;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = (0.4124 * r! + 0.3576 * g! + 0.1805 * b!) / 0.95047;
  const Y = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  const Z = (0.0193 * r! + 0.1192 * g! + 0.9505 * b!) / 1.08883;
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
};

test('the agents stay apart under the usual colour-vision simulations (ΔE ≥ 10 for every pair)', () => {
  const roles = Object.keys(AGENT_COLOURS);
  for (const [kind, m] of [['normal', undefined], ...Object.entries(MACHADO)] as const)
    for (let i = 0; i < roles.length; i++)
      for (let j = i + 1; j < roles.length; j++) {
        const [a, b] = [lab(AGENT_COLOURS[roles[i]!]!, m), lab(AGENT_COLOURS[roles[j]!]!, m)];
        const d = Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
        assert.ok(d >= 10, `${roles[i]} and ${roles[j]} under ${kind}: ΔE ${d.toFixed(1)}`);
      }
});

test('every dot is shown with its agent name: strip, tabs, document footers, Meetings row, About legend', async () => {
  const s = services(fakeLlm(scripted(() => goodTriage('full_file', { opinions: ['legal'] }))));
  addMeeting(s.db, 'sc/900', { date: '2026-11-10' });
  await runOnce(s, { trigger: 'manual', maxMinutes: 5, maxCalls: 300, ingest: false });
  const server = startServer(s.db, '127.0.0.1', 0);
  await new Promise((r) => server.once('listening', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (p: string) => (await fetch(origin + p)).text();
  try {
    const file = await get('/meetings/sc/900');
    // Strip: each cell in its agent's class, with the agent's title.
    for (const r of loadTeam().roles)
      assert.match(file, new RegExp(`class="ag-${r.id}[^"]*">\\s*<div class="who">${r.title.replace('&', '&amp;')}`));
    // Tabs: a dot, then the document's name.
    assert.match(
      file,
      /<a href="\?doc=decision#documents"[^>]*><span class="agent-dot ag-pr" aria-hidden="true"><\/span>Decision<\/a>/,
    );
    assert.match(
      file,
      /<a href="\?doc=opinions#documents"[^>]*><span class="agent-dot ag-legal" aria-hidden="true"><\/span>Opinion<\/a>/,
    );
    // Footer: the dot comes with the agent's title.
    assert.match(file, /Decision · <span class="agent-dot ag-pr" aria-hidden="true"><\/span>Permanent Representative/);
    for (const p of ['report', 'opinions', 'memo', 'cable', 'triage'])
      assert.match(
        await get(`/meetings/sc/900?doc=${p}`),
        /class="meta docmeta">[\s\S]*?agent-dot ag-[a-z]+" aria-hidden="true"><\/span>[A-Z][a-z]/,
        p,
      );
    // Meetings: a row of named dots on the full file.
    const week = await get('/meetings?week=2026-11-09');
    const row = week.slice(week.indexOf('<span class="agents"'), week.indexOf('class="cable"'));
    const named = [...row.matchAll(/ag-([a-z]+)" role="img" aria-label="([^"]+)" title="\2"/g)].map((m) => m[1]);
    assert.deepEqual(named, ['dpr', 'political', 'legal', 'pr', 'press']);
    // About: the legend (each role's dot by its title) and the figure.
    const about = await get('/about');
    for (const r of loadTeam().roles)
      assert.match(
        about,
        new RegExp(`ag-${r.id}" aria-hidden="true"></span><strong>${r.title.replace('&', '&amp;')}</strong>`),
      );
    assert.match(about, /flow-step decision[\s\S]*?ag-pr[\s\S]*?Decision/);
    for (const r of loadTeam().roles) assert.match(about, new RegExp(`<div class="ag-${r.id}">`));
    assert.match(about, /flow-step\s+two/);
  } finally {
    server.close();
  }
});
