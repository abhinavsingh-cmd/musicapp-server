import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Shared mock handles survive vi.resetModules() because the factories close
// over these hoisted references.
const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  librarySongs: [] as any[],
  loggerWarn: vi.fn(),
  loggerDebug: vi.fn(),
}));

vi.mock('../config/api', () => ({
  api: (path: string) => `/api${path}`,
  apiFetch: mocks.apiFetch,
}));

vi.mock('../stores/songsStore', () => ({
  useSongsStore: { getState: () => ({ songs: mocks.librarySongs }) },
}));

vi.mock('../utils/logger', () => ({
  logger: { debug: mocks.loggerDebug, info: vi.fn(), warn: mocks.loggerWarn, error: vi.fn() },
}));

const CACHE_KEY = 'trending_unified_v1';

/** Build a Response-like object matching the server's ok() envelope. */
function jsonResponse(payload: any, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    json: async () => ({ success: ok, code: 'OK', message: '', details: payload }),
  };
}

function livePayload(overrides: Record<string, unknown> = {}) {
  return {
    results: [
      { id: 'vid001', title: 'Hit Song One', artist: 'Star A', duration: 210, thumbnail: 'https://img.youtube.com/vi/vid001/mqdefault.jpg' },
      { id: 'vid002', title: 'Hit Song Two', artist: 'Star B', duration: 190, thumbnail: 'https://img.youtube.com/vi/vid002/mqdefault.jpg' },
    ],
    source: 'youtube_music',
    lastUpdated: Date.now(),
    fresh: true,
    ...overrides,
  };
}

/** Fresh singleton for every test (module holds cache state). */
async function loadService() {
  vi.resetModules();
  const mod = await import('./trendingService');
  return mod.trendingService;
}

/** Pump the fake clock so retry backoffs (1s, 2s, 4s…) all elapse. */
async function settle<T>(pending: Promise<T>): Promise<T> {
  for (let i = 0; i < 12; i++) {
    await vi.advanceTimersByTimeAsync(10_000);
  }
  return pending;
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.apiFetch.mockReset();
  mocks.loggerWarn.mockReset();
  mocks.loggerDebug.mockReset();
  mocks.librarySongs = [];
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// LIVE success
// ---------------------------------------------------------------------------

describe('live success', () => {
  it('accepts a live response, labels it LIVE and keeps the origin', async () => {
    mocks.apiFetch.mockResolvedValue(jsonResponse(livePayload()));
    const svc = await loadService();

    const result = await svc.getTrending();

    expect(result.source).toBe('LIVE');
    expect(result.origin).toBe('youtube_music');
    expect(result.songs).toHaveLength(2);
    expect(result.songs[0]).toMatchObject({ id: 'trending-vid001', youtubeId: 'vid001', title: 'Hit Song One' });
  });

  it('serves subsequent requests from cache without hitting the network', async () => {
    mocks.apiFetch.mockResolvedValue(jsonResponse(livePayload()));
    const svc = await loadService();

    await svc.getTrending();
    const second = await svc.getTrending();

    expect(second.source).toBe('LIVE');
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
  });

  it('persists the live result so a restart can serve it as CACHED', async () => {
    mocks.apiFetch.mockResolvedValue(jsonResponse(livePayload()));
    const svc = await loadService();
    await svc.getTrending();

    const raw = localStorage.getItem(CACHE_KEY);
    expect(raw).not.toBeNull();
    const entry = JSON.parse(raw!);
    expect(entry.data.source).toBe('LIVE');
    expect(entry.data.songs).toHaveLength(2);
  });

  it('labels server-served stale live data (fresh:false) as CACHED, never LIVE', async () => {
    mocks.apiFetch.mockResolvedValue(jsonResponse(livePayload({ fresh: false })));
    const svc = await loadService();

    const result = await svc.getTrending();

    expect(result.source).toBe('CACHED');
    expect(result.origin).toBe('youtube_music');
    expect(result.songs).toHaveLength(2);
    // CACHED data must not be persisted as successful trending data
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// LIVE empty
// ---------------------------------------------------------------------------

describe('live empty', () => {
  it('treats HTTP 200 with zero valid items as failure and falls back', async () => {
    mocks.apiFetch.mockResolvedValue(jsonResponse({ results: [], source: 'youtube_music', fresh: true }));
    const svc = await loadService();

    const result = await settle(svc.getTrending());

    expect(result.source).toBe('BUILT_IN');
    expect(result.songs.length).toBeGreaterThan(0);
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1); // definitive answer — no wasted retries
  });

  it('never caches an empty result as successful trending data', async () => {
    mocks.apiFetch.mockResolvedValue(jsonResponse({ results: [], source: 'youtube_music', fresh: true }));
    const svc = await loadService();

    await settle(svc.getTrending());

    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    expect(svc.isFresh()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LIVE malformed
// ---------------------------------------------------------------------------

describe('live malformed', () => {
  it('skips only the bad items and keeps the valid ones', async () => {
    mocks.apiFetch.mockResolvedValue(jsonResponse({
      results: [
        { id: 'good1', title: 'Valid Song', artist: 'Artist A', duration: 200 },
        { id: '', title: 'Missing id' },            // unplayable — skip
        { id: 'blankTitle', title: '    ' },        // unplayable — skip
        null,                                        // garbage — skip
        { id: 'good2', title: 'Another Valid', duration: 'not-a-number' }, // coerced duration
      ],
      source: 'charts',
      fresh: true,
    }));
    const svc = await loadService();

    const result = await svc.getTrending();

    // A few bad rows must never discard the whole live response
    expect(result.source).toBe('LIVE');
    expect(result.origin).toBe('charts');
    expect(result.songs.map(s => s.id)).toEqual(['trending-good1', 'trending-good2']);
    expect(result.songs[1].duration).toBe(0);
    expect(result.songs[1].artist).toBe('Unknown');
  });

  it('falls back without crashing when results is not an array', async () => {
    mocks.apiFetch.mockResolvedValue(jsonResponse({ results: { broken: true }, source: 'youtube_music', fresh: true }));
    const svc = await loadService();

    const result = await settle(svc.getTrending());

    expect(result.source).toBe('BUILT_IN');
    expect(result.songs.length).toBeGreaterThan(0);
  });

  it('retries a structurally broken live body instead of falling back at once', async () => {
    mocks.apiFetch.mockResolvedValue(jsonResponse({ results: { broken: true }, source: 'youtube_music', fresh: true }));
    const svc = await loadService();

    const result = await settle(svc.getTrending());

    // A broken body is NOT a definitive answer — all retries are used
    expect(mocks.apiFetch).toHaveBeenCalledTimes(3);
    expect(result.source).toBe('BUILT_IN');
    expect(mocks.loggerWarn.mock.calls.some(c => String(c[0]).includes('Malformed live response'))).toBe(true);
  });

  it('retries a malformed envelope with no source origin, then falls back honestly', async () => {
    // Valid rows but no origin field — cannot be accepted as LIVE, yet might
    // be a transient glitch, so it must be retried, not cached, never LIVE.
    mocks.apiFetch.mockResolvedValue(jsonResponse({
      results: [{ id: 'x1', title: 'Mystery Song', artist: 'X', duration: 200 }],
      fresh: true,
    }));
    const svc = await loadService();

    const result = await settle(svc.getTrending());

    expect(mocks.apiFetch).toHaveBeenCalledTimes(3);
    expect(result.source).not.toBe('LIVE');
    expect(result.source).toBe('BUILT_IN');
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    expect(mocks.loggerWarn.mock.calls.some(c => String(c[0]).includes('missing source origin'))).toBe(true);
  });

  it('recovers to LIVE when a malformed stream becomes well-formed', async () => {
    mocks.apiFetch
      .mockResolvedValueOnce(jsonResponse({ results: null }))
      .mockResolvedValueOnce(jsonResponse(livePayload()));
    const svc = await loadService();

    const result = await settle(svc.getTrending());

    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
    expect(result.source).toBe('LIVE');
    expect(result.origin).toBe('youtube_music');
  });

  it('does not let a minor parsing error replace previously valid live data', async () => {
    mocks.apiFetch.mockResolvedValueOnce(jsonResponse(livePayload()));
    const svc = await loadService();
    await svc.getTrending();

    // Age the cache out, then the server returns a broken payload
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
    mocks.apiFetch.mockResolvedValue(jsonResponse({ results: null, source: 'youtube_music', fresh: true }));

    const result = await settle(svc.getTrending());

    expect(result.source).toBe('CACHED'); // still the earlier live songs
    expect(result.songs[0].id).toBe('trending-vid001');
  });
});

// ---------------------------------------------------------------------------
// LIVE timeout / HTTP error — must retry, not fall back on first failure
// ---------------------------------------------------------------------------

describe('live timeout', () => {
  it('retries with backoff before falling back', async () => {
    mocks.apiFetch.mockRejectedValue(new Error('timeout'));
    const svc = await loadService();

    const result = await settle(svc.getTrending());

    expect(mocks.apiFetch).toHaveBeenCalledTimes(3); // first failure is NOT the end
    expect(result.source).toBe('BUILT_IN');
    expect(result.songs.length).toBeGreaterThan(0);
  });

  it('recovers when a later retry succeeds (server finished its live fetch)', async () => {
    mocks.apiFetch
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(jsonResponse(livePayload()));
    const svc = await loadService();

    const result = await settle(svc.getTrending());

    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
    expect(result.source).toBe('LIVE');
    expect(result.songs).toHaveLength(2);
  });
});

describe('live HTTP error', () => {
  it('retries on HTTP 500 and falls back with honest labeling', async () => {
    mocks.apiFetch.mockResolvedValue(jsonResponse({}, false, 500));
    const svc = await loadService();

    const result = await settle(svc.getTrending());

    expect(mocks.apiFetch).toHaveBeenCalledTimes(3);
    expect(result.source).toBe('BUILT_IN');
  });

  it('treats a non-JSON response as a retriable failure, not a crash', async () => {
    mocks.apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      json: async () => ({}),
    });
    const svc = await loadService();

    const result = await settle(svc.getTrending());

    expect(mocks.apiFetch).toHaveBeenCalledTimes(3);
    expect(result.source).toBe('BUILT_IN');
  });
});

// ---------------------------------------------------------------------------
// CACHED live data
// ---------------------------------------------------------------------------

describe('cached live data', () => {
  it('serves previously fetched live data as CACHED when the network fails', async () => {
    mocks.apiFetch.mockResolvedValueOnce(jsonResponse(livePayload()));
    const svc = await loadService();
    await svc.getTrending();

    // Age the in-memory cache past the fresh window
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
    mocks.apiFetch.mockRejectedValue(new Error('network down'));

    const result = await settle(svc.getTrending());

    expect(result.source).toBe('CACHED');
    expect(result.songs.map(s => s.id)).toEqual(['trending-vid001', 'trending-vid002']);
  });

  it('recovers CACHED data from disk when memory is empty', async () => {
    // First run: live success persists to disk
    mocks.apiFetch.mockResolvedValueOnce(jsonResponse(livePayload()));
    const first = await loadService();
    await first.getTrending();

    // Second run: brand-new singleton (empty memory), network is down
    mocks.apiFetch.mockRejectedValue(new Error('offline'));
    const second = await loadService();

    const result = await settle(second.getTrending());

    expect(result.source).toBe('CACHED');
    expect(result.songs[0].id).toBe('trending-vid001');
  });

  it('never labels first-paint disk data as LIVE', async () => {
    mocks.apiFetch.mockResolvedValueOnce(jsonResponse(livePayload()));
    const first = await loadService();
    await first.getTrending();

    // Brand-new singleton: first paint shows disk data before any fetch.
    // That data is stale by definition — it must read CACHED, never LIVE.
    const second = await loadService();

    expect(second.getState().source).toBe('CACHED');
    expect(second.getState().songs[0].id).toBe('trending-vid001');
  });
});

// ---------------------------------------------------------------------------
// LIBRARY fallback
// ---------------------------------------------------------------------------

describe('library fallback', () => {
  it('falls back to playable library songs when no cached live data exists', async () => {
    mocks.librarySongs = [
      { id: 'lib-1', youtubeId: 'yt-abc', title: 'My Song', artist: 'Me', duration: 180, coverArt: 'c.jpg' },
      { id: 'lib-2', youtubeId: null, title: 'No YouTube', artist: 'X', duration: 100, coverArt: '' },
      { id: 'lib-3', youtubeId: 'yt-def', title: 'Other Song', artist: 'You', duration: 200, coverArt: 'd.jpg' },
    ];
    mocks.apiFetch.mockRejectedValue(new Error('offline'));
    const svc = await loadService();

    const result = await settle(svc.getTrending());

    expect(result.source).toBe('LIBRARY');
    // Only songs with a playable youtubeId are used
    expect(result.songs.map(s => s.id)).toEqual(['trending-yt-abc', 'trending-yt-def']);
    expect(result.songs.every(s => s.genre === 'Trending')).toBe(true);
  });

  it('never caches library fallback data as live', async () => {
    mocks.librarySongs = [
      { id: 'lib-1', youtubeId: 'yt-abc', title: 'My Song', artist: 'Me', duration: 180, coverArt: 'c.jpg' },
    ];
    mocks.apiFetch.mockRejectedValue(new Error('offline'));
    const svc = await loadService();

    await settle(svc.getTrending());

    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    expect(svc.isFresh()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BUILT_IN fallback
// ---------------------------------------------------------------------------

describe('built-in fallback', () => {
  it('uses the built-in catalog when library and network are both empty', async () => {
    mocks.librarySongs = [];
    mocks.apiFetch.mockRejectedValue(new Error('offline'));
    const svc = await loadService();

    const result = await settle(svc.getTrending());

    expect(result.source).toBe('BUILT_IN');
    expect(result.songs.length).toBeGreaterThan(0);
    expect(result.songs.every(s => typeof s.id === 'string' && s.id.length > 0)).toBe(true);
  });

  it('uses built-in when the server itself already fell back (builtin origin)', async () => {
    mocks.apiFetch.mockResolvedValue(jsonResponse({
      results: [{ id: 'b1', title: 'Server Builtin', artist: 'X', duration: 100 }],
      source: 'builtin',
      lastUpdated: Date.now(),
      fresh: false,
    }));
    const svc = await loadService();

    const result = await settle(svc.getTrending());

    // Server fallback data must never be labeled LIVE
    expect(result.source).not.toBe('LIVE');
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1); // definitive answer — no retries
  });
});

// ---------------------------------------------------------------------------
// Fallback transition logging — every downgrade must be observable
// ---------------------------------------------------------------------------

describe('fallback transition logging', () => {
  it('logs a warning on every fallback transition', async () => {
    mocks.apiFetch.mockRejectedValue(new Error('network down'));
    const svc = await loadService();

    const result = await settle(svc.getTrending());

    expect(result.source).toBe('BUILT_IN');
    const warns = mocks.loggerWarn.mock.calls.map(c => String(c[0]));
    // Each failed attempt is logged...
    expect(warns.filter(w => w.includes('Request failed')).length).toBe(3);
    // ...the overall live-fetch failure is logged...
    expect(warns.some(w => w.includes('Live fetch unsuccessful'))).toBe(true);
    // ...and the final fallback choice is logged
    expect(warns.some(w => w.includes('Falling back to BUILT_IN'))).toBe(true);
  });

  it('logs when serving cached live data instead of live', async () => {
    mocks.apiFetch.mockResolvedValueOnce(jsonResponse(livePayload()));
    const svc = await loadService();
    await svc.getTrending();

    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
    mocks.loggerWarn.mockClear();
    mocks.apiFetch.mockRejectedValue(new Error('down'));

    const result = await settle(svc.getTrending());

    expect(result.source).toBe('CACHED');
    expect(mocks.loggerWarn.mock.calls.some(c => String(c[0]).includes('Serving cached live data as CACHED'))).toBe(true);
  });

  it('never labels fallback data as LIVE (labeling matrix)', async () => {
    const cases: Array<{ payload: any; label: string }> = [
      { payload: livePayload(), label: 'LIVE' },
      { payload: livePayload({ fresh: false }), label: 'CACHED' },
      // Server fallback / empty live are rejected by the client; with no
      // cached live data they surface as BUILT_IN, and with cached live
      // data still in memory as CACHED — never as LIVE.
      { payload: { results: [{ id: 'b1', title: 'B', artist: 'X', duration: 100 }], source: 'builtin', fresh: false }, label: 'BUILT_IN|CACHED' },
      { payload: { results: [], source: 'youtube_music', fresh: true }, label: 'BUILT_IN|CACHED' },
    ];
    for (const { payload, label } of cases) {
      mocks.apiFetch.mockReset();
      mocks.apiFetch.mockResolvedValue(jsonResponse(payload));
      const svc = await loadService();
      const result = await settle(svc.getTrending());
      expect(label.split('|'), `payload source=${payload.source}`).toContain(result.source);
      // Fallback labels must never carry a live origin claim
      if (result.source === 'LIBRARY' || result.source === 'BUILT_IN') {
        expect(result.origin === 'youtube_music' || result.origin === 'charts').toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Dev logging markers — every resolution is observable for the operator
// ---------------------------------------------------------------------------

describe('dev logging markers', () => {
  it('logs LIVE_YOUTUBE when serving genuinely live data', async () => {
    mocks.apiFetch.mockResolvedValue(jsonResponse(livePayload()));
    const svc = await loadService();

    const result = await svc.getTrending();

    expect(result.source).toBe('LIVE');
    expect(mocks.loggerDebug.mock.calls.some(c => String(c[0]).includes('LIVE_YOUTUBE'))).toBe(true);
  });

  it('logs CACHED_YOUTUBE for server-stale live data', async () => {
    mocks.apiFetch.mockResolvedValue(jsonResponse(livePayload({ fresh: false })));
    const svc = await loadService();

    const result = await svc.getTrending();

    expect(result.source).toBe('CACHED');
    expect(mocks.loggerDebug.mock.calls.some(c => String(c[0]).includes('CACHED_YOUTUBE'))).toBe(true);
  });

  it('logs LIBRARY_FALLBACK when falling back to the library', async () => {
    mocks.librarySongs = [
      { id: 'lib-1', youtubeId: 'yt-abc', title: 'My Song', artist: 'Me', duration: 180, coverArt: 'c.jpg' },
    ];
    mocks.apiFetch.mockRejectedValue(new Error('offline'));
    const svc = await loadService();

    const result = await settle(svc.getTrending());

    expect(result.source).toBe('LIBRARY');
    expect(mocks.loggerWarn.mock.calls.some(c => String(c[0]).includes('LIBRARY_FALLBACK'))).toBe(true);
  });

  it('logs BUILT_IN_FALLBACK when nothing else is available', async () => {
    mocks.apiFetch.mockRejectedValue(new Error('offline'));
    const svc = await loadService();

    const result = await settle(svc.getTrending());

    expect(result.source).toBe('BUILT_IN');
    expect(mocks.loggerWarn.mock.calls.some(c => String(c[0]).includes('BUILT_IN_FALLBACK'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Recovery: fallback → back to LIVE
// ---------------------------------------------------------------------------

describe('recovery from fallback back to live', () => {
  it('returns to LIVE once the server recovers, bypassing any response cache', async () => {
    // Phase 1: network down → LIBRARY fallback
    mocks.librarySongs = [
      { id: 'lib-1', youtubeId: 'yt-abc', title: 'My Song', artist: 'Me', duration: 180, coverArt: 'c.jpg' },
    ];
    mocks.apiFetch.mockRejectedValue(new Error('server down'));
    const svc = await loadService();

    const down = await settle(svc.getTrending());
    expect(down.source).toBe('LIBRARY');

    // Phase 2: server recovers → must get LIVE back, not stay stuck on fallback
    mocks.apiFetch.mockResolvedValue(jsonResponse(livePayload()));
    const recovered = await settle(svc.getTrending());

    expect(recovered.source).toBe('LIVE');
    expect(recovered.origin).toBe('youtube_music');
    expect(recovered.songs).toHaveLength(2);

    // The recovery request must bypass the generic apiFetch response cache
    const lastCall = mocks.apiFetch.mock.calls.at(-1);
    expect(lastCall?.[1]).toMatchObject({ cacheTTL: 0 });
  });

  it('a CACHED result also recovers to LIVE when live data returns', async () => {
    mocks.apiFetch.mockResolvedValueOnce(jsonResponse(livePayload()));
    const svc = await loadService();
    await svc.getTrending();

    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
    mocks.apiFetch.mockRejectedValueOnce(new Error('blip'));
    mocks.apiFetch.mockRejectedValueOnce(new Error('blip'));
    mocks.apiFetch.mockRejectedValueOnce(new Error('blip'));
    const cached = await settle(svc.getTrending());
    expect(cached.source).toBe('CACHED');

    mocks.apiFetch.mockResolvedValue(jsonResponse(livePayload()));
    const live = await settle(svc.getTrending());

    expect(live.source).toBe('LIVE');
  });
});
