/**
 * Server Keep-Alive
 *
 * Render's free tier spins the instance down after ~15 minutes of idle.
 * A cold start adds 10-20s to the FIRST request (playback, search, charts),
 * which reads as "music won't play" / "search is broken". Pinging /api/health
 * on a timer keeps the instance warm so first-play latency stays at the
 * warm-path (~5s extraction) instead of the cold path.
 *
 * Best-effort by design: failures are swallowed silently — the keepalive
 * must never produce noise, errors, or visible side effects.
 */

import { api } from '../config/api';

const PING_INTERVAL_MS = 4 * 60 * 1000; // 4 minutes — under Render's 15-min idle timeout
const FIRST_PING_DELAY_MS = 30_000; // wait for boot traffic to settle before pinging

let started = false;

function pingServer(): void {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  fetch(api('/health'), {
    signal: controller.signal,
    cache: 'no-store',
    headers: { 'Accept': 'application/json' },
  })
    .then(() => {})
    .catch(() => {})
    .finally(() => clearTimeout(timer));
}

/** Start the periodic keep-alive. Idempotent — safe to call multiple times. */
export function startServerKeepAlive(): void {
  if (started) return;
  started = true;
  setTimeout(() => {
    pingServer();
    setInterval(pingServer, PING_INTERVAL_MS);
  }, FIRST_PING_DELAY_MS);
}