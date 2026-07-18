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
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 800;

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
// apiFetch — the single fetch wrapper used everywhere
// ---------------------------------------------------------------------------

export interface ApiFetchOptions extends RequestInit {
  timeout?: number;
  retries?: number;
  deduplicate?: boolean;
}

export async function apiFetch(
  url: string,
  options: ApiFetchOptions = {},
): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUT, retries = MAX_RETRIES, deduplicate = true, ...fetchOptions } = options;

  if (!isOnline()) throw new OfflineError();

  const method = (fetchOptions.method || 'GET').toUpperCase();
  const dedupeKey = deduplicate && method === 'GET' ? url : '';

  if (dedupeKey && inFlightRequests.has(dedupeKey)) {
    return inFlightRequests.get(dedupeKey)!.then(r => r.clone());
  }

  const promise = _doFetch(url, { timeout, retries, ...fetchOptions });

  if (dedupeKey) {
    inFlightRequests.set(dedupeKey, promise.finally(() => inFlightRequests.delete(dedupeKey)));
  }

  return promise;
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
