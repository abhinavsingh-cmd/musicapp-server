import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../config/api', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    apiFetch: vi.fn(),
    api: (path: string) => `/api${path}`,
    ApiError: actual.ApiError,
    RateLimitError: actual.RateLimitError,
    NetworkError: actual.NetworkError,
    TimeoutError: actual.TimeoutError,
    OfflineError: actual.OfflineError,
  };
});

import { youtubeSearch, SEARCH_TIMEOUT_MS } from './youtubeSearchService';
import { apiFetch } from '../config/api';

const mockedApiFetch = apiFetch as unknown as ReturnType<typeof vi.fn>;

function serverOk(results: unknown[]) {
  return { json: async () => ({ results }) };
}

describe('youtubeSearch — server response normalization', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('normalizes a well-formed server result', async () => {
    mockedApiFetch.mockResolvedValueOnce(serverOk([
      { id: 'abc123XYZ', title: 'Test Song (Official Audio)', artist: 'Test Artist', duration: 210, thumbnail: 'https://cdn.example.com/t.jpg', viewCount: 5000 },
    ]));

    const results = await youtubeSearch('test song');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('abc123XYZ');
    expect(typeof results[0].duration).toBe('number');
    expect(results[0].duration).toBe(210);
    expect(results[0].artist).toBe('Test Artist');
    expect(results[0].thumbnail).toBe('https://cdn.example.com/t.jpg');
  });

  it('drops results that have no playable id at all', async () => {
    mockedApiFetch.mockResolvedValueOnce(serverOk([
      { title: 'No id here', artist: 'X', duration: 200 },
      { id: '', youtubeId: '', title: 'Blank ids', duration: 200 },
      { id: null, title: 'Null id', duration: 200 },
      { id: 'valid1', title: 'Kept Song', artist: 'A', duration: 200 },
    ]));

    const results = await youtubeSearch('test');
    expect(results.map(r => r.id)).toEqual(['valid1']);
  });

  it('falls back to youtubeId when id is missing', async () => {
    mockedApiFetch.mockResolvedValueOnce(serverOk([
      { youtubeId: 'ytFallback1', title: 'Only youtubeId', duration: 150 },
    ]));

    const results = await youtubeSearch('ytfallback query');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('ytFallback1');
  });

  it('coerces malformed durations and viewCounts to finite numbers', async () => {
    mockedApiFetch.mockResolvedValueOnce(serverOk([
      { id: 's1', title: 'String duration', duration: '245', viewCount: '1000' },
      { id: 's2', title: 'Garbage duration', duration: 'abc', viewCount: null },
      { id: 's3', title: 'Negative duration', duration: -50, viewCount: -1 },
      { id: 's4', title: 'Missing duration' },
    ]));

    const results = await youtubeSearch('coerce query');
    expect(results).toHaveLength(4);
    expect(results[0].duration).toBe(245);
    expect(results[0].viewCount).toBe(1000);
    expect(results[1].duration).toBe(0);
    expect(results[1].viewCount).toBe(0);
    expect(results[2].duration).toBe(0);
    expect(results[2].viewCount).toBe(0);
    expect(results[3].duration).toBe(0);
    for (const r of results) {
      expect(Number.isFinite(r.duration)).toBe(true);
      expect(Number.isFinite(r.viewCount)).toBe(true);
    }
  });

  it('replaces missing/non-http thumbnails with a valid URL built from the real id', async () => {
    mockedApiFetch.mockResolvedValueOnce(serverOk([
      { id: 'thumb1', title: 'No thumb', duration: 120 },
      { id: 'thumb2', title: 'Relative thumb', thumbnail: '/vi/whatever.jpg', duration: 120 },
    ]));

    const results = await youtubeSearch('thumb query');
    expect(results[0].thumbnail).toBe('https://img.youtube.com/vi/thumb1/mqdefault.jpg');
    expect(results[1].thumbnail).toBe('https://img.youtube.com/vi/thumb2/mqdefault.jpg');
    // Never a garbage URL with an empty id segment
    for (const r of results) {
      expect(r.thumbnail).not.toContain('/vi//');
    }
  });

  it('fills in defaults for missing title/artist instead of leaking undefined', async () => {
    mockedApiFetch.mockResolvedValueOnce(serverOk([
      { id: 'meta1', duration: 120 },
    ]));

    const results = await youtubeSearch('meta query');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Unknown');
    expect(results[0].artist).toBe('Unknown');
    expect(results[0].album).toBe('');
  });

  it('dedupes rows with the same video id', async () => {
    mockedApiFetch.mockResolvedValueOnce(serverOk([
      { id: 'dup1', title: 'First copy', duration: 120 },
      { id: 'dup1', title: 'Second copy', duration: 120 },
      { id: 'dup2', title: 'Unique', duration: 130 },
    ]));

    const results = await youtubeSearch('dedupe query');
    expect(results.map(r => r.id)).toEqual(['dup1', 'dup2']);
  });

  it('returns [] for an empty query without hitting any API', async () => {
    const results = await youtubeSearch('   ');
    expect(results).toEqual([]);
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });

  it.skip('rejects when the server body is malformed (no Invidious fallback available)', async () => {
    mockedApiFetch.mockResolvedValueOnce({ json: async () => { throw new Error('bad json'); } });

    await expect(youtubeSearch('test noinvidious')).rejects.toThrow('bad json');
  });

  it.skip('returns [] only for a definitive empty server answer', async () => {
    // Server replies authoritatively: valid envelope, zero results.
    mockedApiFetch.mockResolvedValueOnce(serverOk([]));

    const results = await youtubeSearch('test empty');
    expect(results).toEqual([]);
  });

  it('rejects with the server error when the server times out', async () => {
    mockedApiFetch.mockRejectedValueOnce(new Error('Request timed out'));
    // Invidious fallback also fails quickly (mocked), so the whole search rejects
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Invidious failed'))));

    await expect(youtubeSearch('test timeout')).rejects.toThrow('Request timed out');
  });

  it.skip('never hangs on a stalled server body — it rejects with a timeout after the deadlines elapse', async () => {
    vi.useFakeTimers();
    try {
      // Headers arrive (apiFetch resolves), but the body never completes.
      // Use the real raceWithDeadline which respects fake timers
      mockedApiFetch.mockResolvedValueOnce({
        ok: true,
        json: () => new Promise(() => {}),
      });

      const p = youtubeSearch('test stall body');
      let settled = false;
      p.then(() => { settled = true; }, () => { settled = true; });

      // 20s body deadline (matches the server-side yt-dlp search budget)
      await vi.advanceTimersByTimeAsync(20_000 + 200);
      await expect(p).rejects.toThrow('Request timed out');
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('youtubeSearch — query enhancement', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.skip('appends "music" when the query has no music-related terms', async () => {
    mockedApiFetch.mockResolvedValueOnce(serverOk([]));
    await youtubeSearch('taylor swift unique query');
    const calledUrl = mockedApiFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('music');
  });

  it.skip('does NOT append anything when the query already has music-related terms', async () => {
    mockedApiFetch.mockResolvedValueOnce(serverOk([]));
    await youtubeSearch('arijit singh song unique query');
    const calledUrl = mockedApiFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('song');
    expect(calledUrl).not.toContain('official');
  });
});
