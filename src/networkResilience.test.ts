/**
 * Network-resilience integration tests.
 *
 * Covers 14 distinct network failure/recovery scenarios that the app
 * must handle gracefully — from HTTP status codes to provider isolation
 * and playback recovery. Each scenario proves a specific resilience
 * contract and uses only public APIs (no internal state poking).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — keep minimal, only what's needed for each block
// ---------------------------------------------------------------------------

vi.mock('./services/metricsCollector', () => ({
  metricsCollector: {
    pushCacheEvent: vi.fn(),
    pushFailedRequest: vi.fn(),
    pushApiLatency: vi.fn(),
    pushSearchLatency: vi.fn(),
  },
}));

vi.mock('./utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('./services/youtubeAudioExtractor', () => ({
  extractAudioUrl: vi.fn(),
  invalidateAudioUrl: vi.fn(),
}));

vi.mock('./services/youtubeSearchService', () => ({
  youtubeSearch: vi.fn(),
}));

vi.mock('./services/trendingService', () => ({
  trendingService: { getTrending: vi.fn() },
}));

vi.mock('./services/musicApi', () => ({
  fetchSongs: vi.fn(),
  searchSongs: vi.fn(),
}));

vi.mock('./services/lyricsService', () => ({
  lyricsService: { fetchLyrics: vi.fn() },
}));

vi.mock('./services/recommendationService', () => ({
  getRecommendations: vi.fn(),
}));

vi.mock('./services/librarySearchIndex', () => ({
  initLibrarySearchIndex: vi.fn(),
  librarySearchIndex: { search: vi.fn().mockResolvedValue([]), suggest: vi.fn().mockResolvedValue([]) },
}));

vi.mock('./providers/search', () => ({
  searchProviders: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  apiFetch,
  clearResponseCache,
  TimeoutError,
  NetworkError,
  RateLimitError,
  ApiError,
} from './config/api';
import { searchProviders, type ProviderSearchResult } from './providers/search';
import { useSearchStore } from './stores/searchStore';
import { providerRegistry } from './providers/registry';
import { healthTracker } from './providers/healthTracker';
import { safeProviderCall, RESOLVE_TIMEOUT_MS } from './providers/safeProviderCall';
import { isTransientError } from './services/audioService';
import type { Track, TrackProvider } from './providers/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const URL = 'http://test.local/api/test';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function emptyResponse(status = 200): Response {
  return new Response('', { status, statusText: 'OK' });
}

function rateLimitResponse(retryAfter?: number): Response {
  const headers: Record<string, string> = {};
  if (retryAfter !== undefined) headers['Retry-After'] = String(retryAfter);
  return new Response('Too Many Requests', { status: 429, statusText: 'Too Many Requests', headers });
}

function serverErrorResponse(status: number): Response {
  return new Response('Server Error', { status, statusText: 'Server Error' });
}

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-1',
    provider: 'test-provider',
    title: 'Test Track',
    artist: 'Test Artist',
    album: '',
    duration: 200,
    artwork: '',
    ...overrides,
  } as Track;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (r?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (r?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearResponseCache();
  healthTracker.reset();
  useSearchStore.getState().clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const p of providerRegistry.list()) {
    if (p.id.startsWith('test-')) providerRegistry.unregister(p.id);
  }
  healthTracker.reset();
});

// ---------------------------------------------------------------------------
// 1. HTTP 200 — successful response
// ---------------------------------------------------------------------------

describe('scenario 1: HTTP 200 success', () => {
  it('returns the response body on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true })));

    const res = await apiFetch(URL, { retries: 0, cacheTTL: 0, deduplicate: false });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. HTTP 200 with empty body
// ---------------------------------------------------------------------------

describe('scenario 2: HTTP 200 empty body', () => {
  it('returns an empty response without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => emptyResponse(200)));

    const res = await apiFetch(URL, { retries: 0, cacheTTL: 0, deduplicate: false });
    expect(res.ok).toBe(true);
    const text = await res.text();
    expect(text).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 3. HTTP 429 — rate limited
// ---------------------------------------------------------------------------

describe('scenario 3: HTTP 429 rate limit', () => {
  it('rejects with RateLimitError containing retryAfterMs from Retry-After header', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => rateLimitResponse(30)));

    try {
      await apiFetch(URL, { retries: 0, cacheTTL: 0, deduplicate: false });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
      expect((e as RateLimitError).retryAfterMs).toBe(30_000);
    }
  });

  it('rejects with RateLimitError when no Retry-After header', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => rateLimitResponse()));

    const p = apiFetch(URL, { retries: 0, cacheTTL: 0, deduplicate: false });
    await expect(p).rejects.toThrow(RateLimitError);
  });
});

// ---------------------------------------------------------------------------
// 4. HTTP 503 — service unavailable (transient)
// ---------------------------------------------------------------------------

describe('scenario 4: HTTP 503 service unavailable', () => {
  it('rejects with RateLimitError (same class as 429)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => serverErrorResponse(503)));

    const p = apiFetch(URL, { retries: 0, cacheTTL: 0, deduplicate: false });
    await expect(p).rejects.toThrow(RateLimitError);
  });
});

// ---------------------------------------------------------------------------
// 5. HTTP 500 — server error
// ---------------------------------------------------------------------------

describe('scenario 5: HTTP 500 server error', () => {
  it('rejects with ApiError with SERVER_ERROR code after retries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => serverErrorResponse(500)));

    try {
      await apiFetch(URL, { retries: 1, cacheTTL: 0, deduplicate: false });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe('SERVER_ERROR');
    }
  });
});

// ---------------------------------------------------------------------------
// 6. HTTP 504 — gateway timeout
// ---------------------------------------------------------------------------

describe('scenario 6: HTTP 504 gateway timeout', () => {
  it('rejects with ApiError SERVER_ERROR (not retried as rate limit)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => serverErrorResponse(504)));

    try {
      await apiFetch(URL, { retries: 0, cacheTTL: 0, deduplicate: false });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe('SERVER_ERROR');
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Request timeout
// ---------------------------------------------------------------------------

describe('scenario 7: request timeout', () => {
  it('rejects with TimeoutError when fetch exceeds deadline', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    const p = apiFetch(URL, { timeout: 5_000, retries: 0, cacheTTL: 0, deduplicate: false });
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(5_010);
    await assertion;
  });
});

// ---------------------------------------------------------------------------
// 8. Connection failure (network error)
// ---------------------------------------------------------------------------

describe('scenario 8: connection failure', () => {
  it('rejects with NetworkError when fetch throws a TypeError (ECONNREFUSED)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    const p = apiFetch(URL, { retries: 0, cacheTTL: 0, deduplicate: false });
    await expect(p).rejects.toThrow(NetworkError);
  });
});

// ---------------------------------------------------------------------------
// 9. Retry success — first attempt fails, second succeeds
// ---------------------------------------------------------------------------

describe('scenario 9: retry success after transient failure', () => {
  it('returns success on second attempt after first times out', async () => {
    vi.useFakeTimers();
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      callCount++;
      if (callCount === 1) return new Promise(() => {}); // first: wedged
      return Promise.resolve(jsonResponse({ data: 'ok' })); // second: success
    }));

    const p = apiFetch(URL, { timeout: 3_000, retries: 1, cacheTTL: 0, deduplicate: false });

    // First attempt times out after 3s
    await vi.advanceTimersByTimeAsync(3_010);
    // Retry delay: 400ms * 2^0 = 400ms
    await vi.advanceTimersByTimeAsync(500);
    // Second attempt succeeds immediately
    const res = await p;
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.data).toBe('ok');
  });

  it('returns success on second attempt after network error', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      callCount++;
      if (callCount === 1) throw new TypeError('Failed to fetch');
      return jsonResponse({ data: 'recovered' });
    }));

    const res = await apiFetch(URL, { retries: 1, cacheTTL: 0, deduplicate: false });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.data).toBe('recovered');
  });
});

// ---------------------------------------------------------------------------
// 10. Retry exhaustion — all retries fail
// ---------------------------------------------------------------------------

describe('scenario 10: retry exhaustion', () => {
  it('throws after exhausting all retries on 500', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => serverErrorResponse(500)));

    const p = apiFetch(URL, { retries: 2, cacheTTL: 0, deduplicate: false });
    await expect(p).rejects.toThrow(ApiError);
    expect((fetch as Mock)).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting all retries on timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    const p = apiFetch(URL, { timeout: 2_000, retries: 1, cacheTTL: 0, deduplicate: false });
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);

    // initial timeout
    await vi.advanceTimersByTimeAsync(2_010);
    // retry delay
    await vi.advanceTimersByTimeAsync(500);
    // retry timeout
    await vi.advanceTimersByTimeAsync(2_010);

    await assertion;
    expect((fetch as Mock)).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 11. Cached-after-failure — success is cached, then failure returns cache
// ---------------------------------------------------------------------------

describe('scenario 11: cached response survives backend failure', () => {
  it('returns cached data when backend starts returning 500', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      callCount++;
      if (callCount === 1) return jsonResponse({ songs: ['A', 'B'] });
      return serverErrorResponse(500);
    }));

    // First call succeeds and populates cache (default 30s TTL)
    const res1 = await apiFetch(URL, { retries: 0, deduplicate: false });
    expect(res1.ok).toBe(true);
    const data1 = await res1.json();
    expect(data1.songs).toEqual(['A', 'B']);

    // Second call — backend returns 500, but cache has the fresh response
    const res2 = await apiFetch(URL, { retries: 0, deduplicate: false });
    expect(res2.ok).toBe(true);
    const data2 = await res2.json();
    expect(data2.songs).toEqual(['A', 'B']);
  });
});

// ---------------------------------------------------------------------------
// 12. Stale search — out-of-order results don't overwrite newer query
// ---------------------------------------------------------------------------

describe('scenario 12: stale search results discarded', () => {
  it('late result from old query does not overwrite newer results', async () => {
    const d1 = deferred<ProviderSearchResult[]>();
    const d2 = deferred<ProviderSearchResult[]>();

    (searchProviders as Mock)
      .mockImplementationOnce((q: string) => {
        if (q === 'weeknd') return d1.promise;
        return d2.promise;
      })
      .mockImplementationOnce((q: string) => {
        if (q === 'weeknd') return d1.promise;
        return d2.promise;
      });

    const store = useSearchStore.getState();

    // Fire "weeknd" then "weeknd blinding lights" in quick succession
    const p1 = store.search('weeknd');
    await new Promise(r => setTimeout(r, 10));
    store.setQuery('weeknd blinding lights');
    const p2 = store.search('weeknd blinding lights');

    // Resolve "weeknd blinding lights" first (newer query)
    d2.resolve([{
      providerId: 'youtube',
      providerName: 'YouTube',
      tracks: [{ id: 'blinding-lights', title: 'Blinding Lights', artist: 'The Weeknd' } as Track],
    }]);

    await p2;
    const state1 = useSearchStore.getState();
    expect(state1.ytQuery).toBe('weeknd blinding lights');
    expect(state1.ytResults[0].id).toBe('blinding-lights');

    // Now resolve the OLD "weeknd" query — it should NOT overwrite
    d1.resolve([{
      providerId: 'youtube',
      providerName: 'YouTube',
      tracks: [{ id: 'old-result', title: 'Old Result', artist: 'The Weeknd' } as Track],
    }]);

    await p1;
    const state2 = useSearchStore.getState();
    expect(state2.ytQuery).toBe('weeknd blinding lights');
    expect(state2.ytResults[0].id).toBe('blinding-lights');
  });
});

// ---------------------------------------------------------------------------
// 13. Plugin failure with fallback — broken provider doesn't block others
// ---------------------------------------------------------------------------

describe('scenario 13: provider failure isolation', () => {
  function makeTestProvider(id: string, opts: { search?: () => Promise<Track[]>; resolveStream?: () => Promise<any> }): TrackProvider {
    return {
      id,
      name: id,
      capabilities: {
        search: !!opts.search,
        trackLookup: false,
        lyrics: false,
        charts: false,
        relatedTracks: false,
        downloads: false,
      },
      search: opts.search ?? (async () => { throw new Error('not supported'); }),
      resolveStream: opts.resolveStream ?? (async () => null),
    };
  }

  it('safeProviderCall isolates throwing provider without crashing', async () => {
    const explodingFn = async () => { throw new Error('Provider exploded'); };
    const result = await safeProviderCall(explodingFn, 'test.explode', RESOLVE_TIMEOUT_MS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('exception');
      expect(result.message).toContain('Provider exploded');
    }
  });

  it('safeProviderCall returns success for working provider', async () => {
    const okFn = async () => ({ url: 'http://stream.example.com/audio.mp3' });
    const result = await safeProviderCall(okFn, 'test.ok', RESOLVE_TIMEOUT_MS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.url).toContain('audio.mp3');
    }
  });

  it('resolveStream returns null for broken provider without crashing', async () => {
    providerRegistry.register(makeTestProvider('test-broken-resolve', {
      resolveStream: async () => { throw new Error('Resolution failed'); },
    }));

    const track = makeTrack({ provider: 'test-broken-resolve' });
    const result = await safeProviderCall(
      () => providerRegistry.get('test-broken-resolve')!.resolveStream(track),
      'test-broken-resolve.resolveStream',
      RESOLVE_TIMEOUT_MS,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('exception');
    }
  });

  it('health tracker degrades broken provider, promotes healthy one', () => {
    healthTracker.record('test-broken', 'serverError');
    healthTracker.record('test-broken', 'serverError');
    healthTracker.record('test-broken', 'serverError');
    healthTracker.record('test-good', 'success');
    healthTracker.record('test-good', 'success');

    const sorted = healthTracker.sortByHealth(['test-broken', 'test-good']);
    expect(sorted[0]).toBe('test-good');
    expect(sorted[1]).toBe('test-broken');
    expect(healthTracker.isHealthy('test-broken')).toBe(false);
    expect(healthTracker.isHealthy('test-good')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 14. Playback failure with recovery — transient error classification
// ---------------------------------------------------------------------------

describe('scenario 14: playback failure with recovery', () => {
  it('classifies network errors as transient (retryable)', () => {
    expect(isTransientError(new Error('network error'))).toBe(true);
    expect(isTransientError(new Error('Failed to fetch'))).toBe(true);
    expect(isTransientError(new Error('ECONNREFUSED'))).toBe(true);
  });

  it('classifies timeouts as transient', () => {
    expect(isTransientError(new Error('timeout exceeded'))).toBe(true);
    expect(isTransientError(new Error('Request timed out'))).toBe(true);
  });

  it('classifies server 5xx as transient', () => {
    expect(isTransientError(new Error('502 Bad Gateway'))).toBe(true);
    expect(isTransientError(new Error('503 Service Unavailable'))).toBe(true);
    expect(isTransientError(new Error('500 Internal Server Error'))).toBe(true);
  });

  it('defaults to transient for unrecognized errors (safe retry)', () => {
    // isTransientError defaults to true for unknown messages — safer to retry
    // than to give up. Only specific video/format errors are permanent.
    expect(isTransientError(new Error('400 Bad Request'))).toBe(true);
    expect(isTransientError(new Error('404 Not Found'))).toBe(true);
    expect(isTransientError(new Error('something weird'))).toBe(true);
  });

  it('classifies format errors as permanent', () => {
    const err = new DOMException('format not supported', 'NotSupportedError');
    expect(isTransientError(err)).toBe(false);
  });

  it('returns false for null/undefined (no crash)', () => {
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
  });

  it('safeProviderCall times out hung provider methods', async () => {
    const hungFn = () => new Promise<never>(() => {});
    const result = await safeProviderCall(hungFn, 'test.hung', 100);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('timeout');
    }
  });
});
