// Requests per visitor (2026-11-23): at most 60 a minute, sliding window, in memory. The visitor is the
// client address Caddy passes in X-Forwarded-For (Caddy sets it from the connection and does not trust a
// client's own header), else the socket address. Static files (stylesheet, fonts; cached a day) do not count.
import type { IncomingMessage } from 'node:http';

export const RATE_LIMIT = 60;
export const RATE_WINDOW_MS = 60_000;

export function visitor(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private sweep = 0;
  private readonly limit: number;
  private readonly windowMs: number;
  constructor(limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Seconds to wait when over the limit, else 0 (and the request is counted). */
  take(key: string, now = Date.now()): number {
    const from = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > from);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return Math.max(1, Math.ceil((list[0]! + this.windowMs - now) / 1000));
    }
    list.push(now);
    this.hits.set(key, list);
    if (now - this.sweep > this.windowMs) {
      this.sweep = now;
      for (const [k, v] of this.hits) if (!v.some((t) => t > from)) this.hits.delete(k);
    }
    return 0;
  }
}
