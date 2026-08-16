import { metricsCollector } from '../services/metricsCollector';

const API_BASE = import.meta.env.VITE_API_URL || '';

export function api(path: string): string {
  return `${API_BASE}/api${path}`;
}

export { API_BASE };

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public url: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class NetworkError extends ApiError {
  constructor(url: string, networkError?: Error) {
    super('Network error — check your connection', 0, 'NETWORK', url);
    this.name = 'NetworkError';
    this.networkError = networkError;
  }
  networkError?: Error;
}

export class TimeoutError extends ApiError {
  constructor(url: string) {
    super('Request timed out', 0, 'TIMEOUT', url);
    this.name = 'TimeoutError';
  }
}

export class OfflineError extends ApiError {
  constructor() {
    super('You are offline', 0, 'OFFLINE', '');
    this.name = 'OfflineError';
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT = 15_000;
const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 400;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Hard settlement guarantee for a promise that must never hang its caller.
 *
 * Races `promise` against a deadline timer and rejects with a TimeoutError
 * when the deadline fires — even if the wrapped operation (for example a
 * fetch that ignored its AbortController abort) never settles on its own.
 * `onTimeout` runs first so the caller can cancel the underlying operation
 * best-effort.
 */
export function raceWithDeadline<T>(
  promise: Promise<T>,
  ms: number,
  url: string,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new TimeoutError(url));
    }, ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

function delayForAttempt(attempt: number): number {
  return RETRY_DELAY_MS * Math.pow(2, attempt);
}

// ---------------------------------------------------------------------------
// Request deduplication
// ---------------------------------------------------------------------------

const inFlightRequests = new Map<string, Promise<Response>>();

// ---------------------------------------------------------------------------
// Response memory cache (TTL-based)
// ---------------------------------------------------------------------------

interface CacheEntry {
  /** Raw response body as text — safe to re-parse multiple times. */
  bodyText: string;
  status: number;
  ok: boolean;
  headers: Headers;
  expiresAt: number;
}

const responseCache = new Map<string, CacheEntry>();

export interface CacheTTL {
  /** Cache duration in ms. Default 30s for generic, 5m for songs, 30m for charts. */
  ttl?: number;
}

const DEFAULT_CACHE_TTL = 30_000;
const SONGS_CACHE_TTL = 5 * 60_000;
const CHARTS_CACHE_TTL = 30 * 60_000;
const SEARCH_CACHE_TTL = 2 * 60_000;

function getCacheTTL(url: string): number {
  if (url.includes('/songs')) return SONGS_CACHE_TTL;
  if (url.includes('/charts')) return CHARTS_CACHE_TTL;
  if (url.includes('/search')) return SEARCH_CACHE_TTL;
  if (url.includes('/youtube')) return CHARTS_CACHE_TTL;
  return DEFAULT_CACHE_TTL;
}

function getCachedResponse(url: string): Response | null {
  const entry = responseCache.get(url);
  if (!entry) {
    metricsCollector.pushCacheEvent(false, url);
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    responseCache.delete(url);
    metricsCollector.pushCacheEvent(false, url);
    return null;
  }
  metricsCollector.pushCacheEvent(true, url);
  // Return a fresh Response object with the cached body text
  return new Response(entry.bodyText, {
    status: entry.status,
    statusText: entry.ok ? 'OK' : 'Unknown',
    headers: entry.headers,
  });
}

async function setCachedResponse(url: string, response: Response, timeout: number): Promise<void> {
  // Clone BEFORE reading the body. Consuming the original response here
  // made every first request's json()/text() fail with "Body is unusable",
  // and broke the dedup-join clone with "Body has already been consumed" —
  // which silently emptied YouTube search results the server DID return.
  let copy: Response;
  try {
    copy = response.clone();
  } catch {
    return; // body already locked elsewhere — skip caching, caller keeps it
  }
  try {
    // Bounded body read: a server that stalls MID-BODY (headers arrived,
    // stream never completes) must NOT hang apiFetch — callers like the
    // search pipeline bound their own body reads, so a wedged cache read
    // would leave their await pending forever. On any read failure the
    // response is simply not cached; the caller still gets the response.
    const text = await raceWithDeadline(copy.text(), timeout, url);
    const ttl = getCacheTTL(url);
    responseCache.set(url, {
      bodyText: text,
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      expiresAt: Date.now() + ttl,
    });
  } catch {
    return; // stalled/unreadable body — never block the caller on caching
  }
}

/** Clear all cached responses. Call after mutations that invalidate data. */
export function clearResponseCache(pattern?: string): void {
  if (!pattern) {
    responseCache.clear();
    return;
  }
  for (const key of responseCache.keys()) {
    if (key.includes(pattern)) responseCache.delete(key);
  }
}

/**
 * Item counts of the in-memory response cache, bucketed by URL pattern for
 * the dev dashboard. This is the ONE place cache stats are read from — the
 * old standalone cacheManager held a parallel LRU cache that nothing wrote
 * to, so its counters were always zero.
 */
export function getResponseCacheStats(): Record<string, number> {
  const stats: Record<string, number> = {
    search: 0,
    trending: 0,
    lyrics: 0,
    stream: 0,
    metadata: 0,
  };
  for (const key of responseCache.keys()) {
    if (key.includes('/search')) stats.search++;
    else if (key.includes('/charts') || key.includes('/youtube')) stats.trending++;
    else if (key.includes('/lyrics')) stats.lyrics++;
    else if (key.includes('/proxy-audio') || key.includes('/stream')) stats.stream++;
    else stats.metadata++;
  }
  return stats;
}

// ---------------------------------------------------------------------------
// apiFetch — the single fetch wrapper used everywhere
// ---------------------------------------------------------------------------

export interface ApiFetchOptions extends RequestInit {
  timeout?: number;
  retries?: number;
  deduplicate?: boolean;
  /** Override cache TTL. Set 0 to skip cache. */
  cacheTTL?: number;
}

export async function apiFetch(
  url: string,
  options: ApiFetchOptions = {},
): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUT, retries = MAX_RETRIES, deduplicate = true, cacheTTL, ...fetchOptions } = options;

  if (!isOnline()) throw new OfflineError();

  const method = (fetchOptions.method || 'GET').toUpperCase();

  // Check memory cache for GET requests (unless explicitly disabled)
  if (method === 'GET' && cacheTTL !== 0) {
    const cached = getCachedResponse(url);
    if (cached) return cached;
  }

  const dedupeKey = deduplicate && method === 'GET' ? url : '';

  if (dedupeKey && inFlightRequests.has(dedupeKey)) {
    const existing = inFlightRequests.get(dedupeKey);
    if (existing) return existing.then(r => r.clone());
  }

  const startTime = performance.now();
  const promise = _doFetch(url, { timeout, retries, ...fetchOptions });

  if (dedupeKey) {
    const trackedPromise = promise.finally(() => inFlightRequests.delete(dedupeKey));
    trackedPromise.catch(() => {});
    inFlightRequests.set(dedupeKey, trackedPromise);
  }

  let response: Response;
  try {
    response = await promise;
  } catch (err: any) {
    metricsCollector.pushFailedRequest({
      url,
      status: 0,
      error: err?.message || String(err),
      timestamp: Date.now(),
    });
    throw err;
  }

  const duration = performance.now() - startTime;
  metricsCollector.pushApiLatency({
    url,
    duration,
    timestamp: Date.now(),
    cached: false,
    ok: response.ok,
  });

  // Cache successful GET responses (best-effort — a stalled body read never
  // blocks the caller; the request has already succeeded at this point).
  if (method === 'GET' && response.ok && cacheTTL !== 0) {
    await setCachedResponse(url, response, timeout);
  }

  return response;
}

async function _doFetch(
  url: string,
  options: { timeout: number; retries: number } & RequestInit,
): Promise<Response> {
  const { timeout, retries, signal: callerSignal, ...fetchOptions } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (callerSignal?.aborted) {
      throw new DOMException('Request was aborted', 'AbortError');
    }

    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort(callerSignal?.reason);
    callerSignal?.addEventListener('abort', abortFromCaller, { once: true });

    try {
      // Hard deadline: the fetch MUST settle within `timeout`. A platform
      // that ignores the AbortController abort (wedged network stack, mobile
      // WebView) would otherwise leave this request — and every caller
      // awaiting it (search, charts, playback) — pending forever. The
      // deadline rejects with a TimeoutError no matter what the fetch does.
      const res = await raceWithDeadline(
        fetch(url, {
          ...fetchOptions,
          signal: controller.signal,
        }),
        timeout,
        url,
        () => {
          timedOut = true;
          controller.abort();
        },
      );

      if (res.ok) return res;

      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new ApiError(
          `Request failed: ${res.status} ${res.statusText}`,
          res.status,
          res.status === 404 ? 'NOT_FOUND' : 'CLIENT_ERROR',
          url,
        );
      }

      lastError = new ApiError(
        `Server error: ${res.status}`,
        res.status,
        'SERVER_ERROR',
        url,
      );
    } catch (err: any) {
      if (err instanceof ApiError && !(err instanceof TimeoutError)) throw err;

      // Cancellation belongs to the caller (for example, an outdated search),
      // not to the retry policy. Let the caller discard it immediately.
      if (callerSignal?.aborted) throw err;

      // The hard deadline fires with a TimeoutError; the abort timer used to
      // surface as an AbortError with timedOut set. Both mean the same thing:
      // this attempt exceeded its budget — record it and let retry policy run.
      if (err instanceof TimeoutError || (err.name === 'AbortError' && timedOut)) {
        lastError = new TimeoutError(url);
      } else if (!isOnline()) {
        throw new OfflineError();
      } else {
        lastError = new NetworkError(url, err);
      }
    } finally {
      callerSignal?.removeEventListener('abort', abortFromCaller);
    }

    if (attempt < retries) {
      await sleep(delayForAttempt(attempt));
    }
  }

  throw lastError;
}
