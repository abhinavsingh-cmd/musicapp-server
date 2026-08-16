/**
 * apiFetch hard-settlement tests.
 *
 * The search hang root cause: every layer relied on AbortController
 * propagation to reject fetch. A platform that ignores the abort (wedged
 * network stack, mobile WebView) leaves `await fetch` pending forever, and
 * with it the store's loading state. These tests prove apiFetch now settles
 * within its deadline no matter what the underlying fetch does.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { apiFetch, TimeoutError, raceWithDeadline } from './api';

vi.mock('../services/metricsCollector', () => ({
  metricsCollector: {
    pushCacheEvent: vi.fn(),
    pushFailedRequest: vi.fn(),
    pushApiLatency: vi.fn(),
  },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const URL = 'http://x/api/youtube/search?q=test';

/** A fetch that never resolves, never rejects, and ignores its abort. */
function wedgedFetch() {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
}

describe('raceWithDeadline', () => {
  it('resolves with the wrapped promise when it settles first', async () => {
    vi.useFakeTimers();
    const p = raceWithDeadline(Promise.resolve(42), 10_000, URL);
    await expect(p).resolves.toBe(42);
  });

  it('rejects with TimeoutError when the wrapped promise never settles', async () => {
    vi.useFakeTimers();
    const p = raceWithDeadline(new Promise(() => {}), 10_000, URL, vi.fn());
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(10_000 + 10);
    await assertion;
  });
});

describe('apiFetch hard deadline', () => {
  it('rejects with TimeoutError when fetch never settles, even though it ignores the abort', async () => {
    vi.useFakeTimers();
    wedgedFetch();

    const p = apiFetch(URL, { timeout: 10_000, retries: 0, cacheTTL: 0, deduplicate: false });
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);

    await vi.advanceTimersByTimeAsync(10_000 + 10);
    await assertion;
  });

  it('still settles within the deadline when a caller abort is ignored by the platform', async () => {
    vi.useFakeTimers();
    wedgedFetch();
    const controller = new AbortController();

    const p = apiFetch(URL, {
      timeout: 10_000,
      retries: 0,
      cacheTTL: 0,
      deduplicate: false,
      signal: controller.signal,
    });
    controller.abort(); // fetch ignores this — only the deadline can settle

    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(10_000 + 10);
    await assertion;
  });

  it('keeps the retry policy: each timed-out attempt is retried, then the error surfaces', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);

    const p = apiFetch(URL, { timeout: 5_000, retries: 1, cacheTTL: 0, deduplicate: false });
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);

    await vi.advanceTimersByTimeAsync(5_000 + 10);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(400); // retry delay between attempts
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5_000 + 10);
    await assertion;
  });

  it('caller abort still cancels a request that honors it', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const abortSpy = vi.fn();
    const fetchMock = vi.fn((_input: unknown, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', abortSpy);
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const p = apiFetch(URL, {
      timeout: 10_000,
      retries: 0,
      cacheTTL: 0,
      deduplicate: false,
      signal: controller.signal,
    });
    const assertion = expect(p).rejects.toThrow('Aborted');

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(abortSpy).toHaveBeenCalled();
    await assertion;
  });
});

// ---- Response body must stay readable after apiFetch caches it ----

describe('apiFetch body readability', () => {
  it('the caller can still read the body of a response that got cached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ results: [1, 2, 3] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ));

    const res = await apiFetch(URL, { retries: 0, deduplicate: false });
    const data = await res.json();
    expect(data.results).toHaveLength(3);
  });

  it('a dedup-joined caller gets a readable clone of the cached response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ results: [1, 2, 3] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ));

    // Two callers race the same URL: the second joins the in-flight request
    // via the dedup map instead of fetching again.
    const [res1, res2] = await Promise.all([
      apiFetch(URL, { retries: 0 }),
      apiFetch(URL, { retries: 0 }),
    ]);
    const [d1, d2] = await Promise.all([res1.json(), res2.json()]);
    expect(d1.results).toHaveLength(3);
    expect(d2.results).toHaveLength(3);
  });

  it('a later call served from the response cache has a readable body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ results: [1, 2, 3] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ));

    await apiFetch(URL, { retries: 0, deduplicate: false });
    // Second call: no fetch() — served straight from the memory cache.
    const res = await apiFetch(URL, { retries: 0, deduplicate: false });
    const data = await res.json();
    expect(data.results).toHaveLength(3);
  });
});

// ---- Capacitor API-base fallback (the APK must never ship with a dead base) ----

/**
 * The APK used to ship with an EMPTY API base whenever the build shell
 * exported an empty VITE_API_URL (Vite lets process.env override .env
 * files), so every request went to https://localhost/api/... and failed —
 * library, downloads, streaming, trending. Inside Capacitor the base must
 * fall back to the production server at RUNTIME, regardless of what the
 * build baked in.
 */
describe('Capacitor API-base fallback', () => {
  const PROD = 'https://musicapp-server-alkf.onrender.com';

  beforeEach(() => {
    vi.resetModules();
    delete (window as any).Capacitor;
  });

  it('api() returns a same-origin path outside Capacitor (web build)', async () => {
    const { api } = await import('./api');
    expect(api('/songs')).toBe('/api/songs');
  });

  it('api() falls back to the production server inside Capacitor', async () => {
    (window as any).Capacitor = { isNativePlatform: () => true };
    const { api, DEFAULT_API_URL } = await import('./api');
    expect(DEFAULT_API_URL).toBe(PROD);
    expect(api('/songs')).toBe(`${PROD}/api/songs`);
  });
});
