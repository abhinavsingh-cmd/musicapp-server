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
// Ping IMMEDIATELY on start: the whole point is waking the frozen instance
// BEFORE the user taps play (a cold start takes 30-60s; waiting another 30s
// after launch guaranteed the first play still hit the cold path).
const FIRST_PING_DELAY_MS = 500;

let started = false;

function pingServer(timeoutMs = 10_000): void {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
  // The wake-up ping must outlast a full Render cold boot (30-60s) — a 10s
  // abort here would kill the very request that's supposed to wake it.
  setTimeout(() => pingServer(90_000), FIRST_PING_DELAY_MS);
  setTimeout(() => {
    pingServer();
    setInterval(pingServer, PING_INTERVAL_MS);
  }, 15_000);
}