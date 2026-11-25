// The site: server-rendered pages from the database, read-only. Listens on
// HOST:PORT (127.0.0.1:3910); Caddy terminates TLS in front of it.
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Db } from '../engine/db/index.ts';
import { weekStart } from '../engine/ingest/scope.ts';
import { defaultWeek, openAlerts, updatedAt } from './data.ts';
import { esc, html, page, type View } from './html.ts';
import { meetingPage } from './pages/meeting.ts';
import { meetingsPage, searchPage } from './pages/meetings.ts';
import { metricsPage } from './pages/metrics.ts';
import { missionPage } from './pages/mission.ts';
import { positionsPage } from './pages/positions.ts';
import { RateLimiter, visitor } from './rate-limit.ts';

/**
 * Metrics is served only behind its own credentials (2026-11-23). Caddy checks them in the Metrics
 * handle and then sets this header on the proxied request; the site's handle removes it. A request that the app
 * reads as /metrics without it (another spelling of the path that Caddy routed to the site) is not found.
 */
export const METRICS_HEADER = 'x-embassy-metrics';
export const METRICS_GRANTED = 'granted';
/** Not indexed (2026-11-23): robots.txt, this header on every response, and the page meta. */
const ROBOTS = 'User-agent: *\nDisallow: /\n';
const limiter = new RateLimiter();

const STATIC: Record<string, string> = {
  'site.css': 'text/css; charset=utf-8',
  'copy.js': 'text/javascript; charset=utf-8',
  'newsreader.ttf': 'font/ttf',
  'public-sans-regular.ttf': 'font/ttf',
  'public-sans-semibold.ttf': 'font/ttf',
};
const staticDir = new URL('./static/', import.meta.url);

function send(res: ServerResponse, status: number, body: string | Buffer, type: string, cache = 'no-cache'): void {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': cache,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    'x-robots-tag': 'noindex, nofollow',
  });
  res.end(body);
}

export function handle(db: Db, req: IncomingMessage, res: ServerResponse, rate = limiter): void {
  let url: URL;
  let path: string;
  try {
    url = new URL(req.url ?? '/', 'http://localhost');
    path = decodeURIComponent(url.pathname).replace(/\/+$/, '') || '/';
  } catch {
    return send(res, 400, 'Bad request', 'text/plain');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
  if (!path.startsWith('/static/')) {
    const wait = rate.take(visitor(req));
    if (wait) {
      res.setHeader('retry-after', String(wait));
      return send(res, 429, 'Too many requests', 'text/plain');
    }
  }
  // Internal alerts are shown on Metrics only, never on the public pages (2026-11-23).
  const out = (view: View, title: string, body: ReturnType<typeof html>, noindex = true) =>
    send(
      res,
      200,
      page({ title, view, updated: updatedAt(db), body, noindex, alerts: view === 'metrics' ? openAlerts(db) : [] }),
      'text/html; charset=utf-8',
    );
  const notFound = () =>
    send(
      res,
      404,
      page({
        title: 'Not found',
        view: 'meetings',
        updated: updatedAt(db),
        body: html`<section class="intro">
          <h1>Not found</h1>
          <p><a href="/meetings">Back to Meetings</a></p>
        </section>`,
      }),
      'text/html; charset=utf-8',
    );

  if (path === '/robots.txt') return send(res, 200, ROBOTS, 'text/plain; charset=utf-8');
  if (path.toLowerCase() === '/metrics' || path.toLowerCase().startsWith('/metrics/')) {
    if (req.headers[METRICS_HEADER] !== METRICS_GRANTED || path !== '/metrics') return notFound();
    return out('metrics', 'Metrics', metricsPage(db), true);
  }
  if (path === '/') {
    res.writeHead(302, { location: '/meetings' });
    return void res.end();
  }
  if (path.startsWith('/static/')) {
    const name = path.slice('/static/'.length);
    const type = STATIC[name];
    if (!type) return notFound();
    return send(res, 200, readFileSync(new URL(name, staticDir)), type, 'public, max-age=86400');
  }
  if (path === '/meetings') {
    const q = url.searchParams.get('q');
    if (q !== null && q.trim()) return out('meetings', `Search: ${q}`, searchPage(db, q.slice(0, 120)));
    const w = url.searchParams.get('week');
    const monday = w && /^\d{4}-\d{2}-\d{2}$/.test(w) ? weekStart(w) : defaultWeek(db);
    return out('meetings', 'Meetings', meetingsPage(db, monday));
  }
  if (path.startsWith('/meetings/')) {
    const r = meetingPage(db, path.slice('/meetings/'.length), url.searchParams.get('doc'));
    return r ? out('meetings', r.title, r.body) : notFound();
  }
  if (path === '/positions' || path.startsWith('/positions/')) {
    const r = positionsPage(db, path.startsWith('/positions/') ? path.slice('/positions/'.length) : null);
    return r ? out('positions', 'Positions', r) : notFound();
  }
  if (path === '/mission') {
    res.writeHead(301, { location: '/about' });
    return void res.end();
  }
  if (path === '/about') return out('about', 'About', missionPage());
  return notFound();
}

export function startServer(db: Db, host: string, port: number): Server {
  const server = createServer((req, res) => {
    try {
      handle(db, req, res);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) send(res, 500, `<p>${esc('Something went wrong.')}</p>`, 'text/html; charset=utf-8');
      else res.end();
    }
  });
  server.listen(port, host);
  return server;
}
