import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../config/api', () => ({
  apiFetch: vi.fn(),
  api: (path: string) => `/api${path}`,
  raceWithDeadline: <T,>(
    promise: Promise<T>,
    ms: number,
    _url: string,
    onTimeout?: () => void,
  ) => {
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        onTimeout?.();
        reject(new Error('Request timed out'));
      }, ms);
    });
    return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
  },
}));

import { youtubeSearch, SEARCH_TIMEOUT_MS } from './youtubeSearchService';
import { apiFetch } from '../config/api';

const mockedApiFetch = apiFetch as unknown as ReturnType<typeof vi.fn>;

function serverOk(results: unknown[]) {
  return { json: async () => ({ results }) };
}

describe('youtubeSearch — server response normalization', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

    const results = await youtubeSearch('test');
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

    const results = await youtubeSearch('test');
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

    const results = await youtubeSearch('test');
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

    const results = await youtubeSearch('test');
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

    const results = await youtubeSearch('test');
    expect(results.map(r => r.id)).toEqual(['dup1', 'dup2']);
  });

  it('returns [] for an empty query without hitting any API', async () => {
    const results = await youtubeSearch('   ');
    expect(results).toEqual([]);
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });

  it('rejects (not fake "no results") when the server body is malformed and Invidious is down', async () => {
    mockedApiFetch.mockResolvedValueOnce({ json: async () => { throw new Error('bad json'); } });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));

    await expect(youtubeSearch('test')).rejects.toThrow('bad json');
  });

  it('returns [] only for a definitive empty server answer, even when Invidious is down', async () => {
    // Server replies authoritatively: valid envelope, zero results.
    mockedApiFetch.mockResolvedValueOnce(serverOk([]));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));

    const results = await youtubeSearch('test');
    expect(results).toEqual([]);
  });

  it('rejects with the server error when the server times out and Invidious is down', async () => {
    mockedApiFetch.mockRejectedValueOnce(new Error('Request timed out'));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));

    await expect(youtubeSearch('test')).rejects.toThrow('Request timed out');
  });

  it('falls back to Invidious when every server row is invalid', async () => {
    mockedApiFetch.mockResolvedValueOnce(serverOk([
      { title: 'no id', duration: 100 },
      { id: '   ', title: 'whitespace id', duration: 100 },
    ]));
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('yewtu.be')) {
        return {
          ok: true,
          json: async () => ([
            { videoId: 'inv1', title: 'Invidious Song', author: 'Inv Artist', lengthSeconds: 180, viewCount: 10 },
          ]),
        };
      }
      throw new Error('instance down');
    }));

    const results = await youtubeSearch('test');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('inv1');
  });

  it('Invidious path: drops id-less entries and coerces string lengthSeconds', async () => {
    mockedApiFetch.mockRejectedValueOnce(new Error('server down'));
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('yewtu.be')) {
        return {
          ok: true,
          json: async () => ([
            { videoId: 'inv2', title: 'Good Song', author: 'A', lengthSeconds: '200', viewCount: '99' },
            { title: 'Missing videoId', lengthSeconds: 200 },
            { videoId: 'inv3', title: 'Too Short', author: 'B', lengthSeconds: 30 },
            null,
          ]),
        };
      }
      throw new Error('instance down');
    }));

    const results = await youtubeSearch('test');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('inv2');
    expect(results[0].duration).toBe(200);
    expect(typeof results[0].duration).toBe('number');
    expect(results[0].viewCount).toBe(99);
  });

  // ---- Hard-deadline guarantees: the search must ALWAYS settle ----

  it('never hangs when Invidious instances neither resolve nor reject — the deadline bounds the fallback and surfaces a real error', async () => {
    vi.useFakeTimers();
    try {
      mockedApiFetch.mockRejectedValueOnce(new Error('server down'));
      // Platform-wedged instances: the fetch ignores its abort and never settles.
      vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

      const p = youtubeSearch('test');
      let settled = false;
      p.then(() => { settled = true; }, () => { settled = true; });

      await vi.advanceTimersByTimeAsync(SEARCH_TIMEOUT_MS + 100);
      await expect(p).rejects.toThrow('server down');
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never hangs on a stalled server body — it rejects with a timeout after the deadlines elapse', async () => {
    vi.useFakeTimers();
    try {
      // Headers arrive (apiFetch resolves), but the body never completes.
      mockedApiFetch.mockResolvedValueOnce({ json: () => new Promise(() => {}) });
      vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

      const p = youtubeSearch('test');
      let settled = false;
      p.then(() => { settled = true; }, () => { settled = true; });

      // 12s body deadline + 8s Invidious deadlines, all parallel.
      await vi.advanceTimersByTimeAsync(12_000 + SEARCH_TIMEOUT_MS + 200);
      await expect(p).rejects.toThrow('Request timed out');
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
