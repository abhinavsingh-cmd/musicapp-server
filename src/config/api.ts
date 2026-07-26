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

const DEFAULT_TIMEOUT = 5_000;
const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 400;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
  response: Response;
  bodyPromise: Promise<any>;
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
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    responseCache.delete(url);
    return null;
  }
  return entry.response.clone();
}

function setCachedResponse(url: string, response: Response): void {
  const ttl = getCacheTTL(url);
  // Cache the cloned response + pre-read body so subsequent reads are instant
  const clone = response.clone();
  responseCache.set(url, {
    response: clone,
    bodyPromise: clone.clone().text().catch(() => ''),
    expiresAt: Date.now() + ttl,
  });
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
    return inFlightRequests.get(dedupeKey)!.then(r => r.clone());
  }

  const promise = _doFetch(url, { timeout, retries, ...fetchOptions });

  if (dedupeKey) {
    inFlightRequests.set(dedupeKey, promise.finally(() => inFlightRequests.delete(dedupeKey)));
  }

  const response = await promise;

  // Cache successful GET responses
  if (method === 'GET' && response.ok && cacheTTL !== 0) {
    setCachedResponse(url, response);
  }

  return response;
}

async function _doFetch(
  url: string,
  options: { timeout: number; retries: number } & RequestInit,
): Promise<Response> {
  const { timeout, retries, ...fetchOptions } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      clearTimeout(timer);

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
      clearTimeout(timer);

      if (err instanceof ApiError) throw err;

      if (err.name === 'AbortError') {
        lastError = new TimeoutError(url);
      } else if (!isOnline()) {
        throw new OfflineError();
      } else {
        lastError = new NetworkError(url, err);
      }
    }

    if (attempt < retries) {
      await sleep(delayForAttempt(attempt));
    }
  }

  throw lastError;
}
