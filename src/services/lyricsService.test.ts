import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LyricsService } from './lyricsService';

// ---------------------------------------------------------------------------
// LyricsService regression tests — cache hits, in-flight dedupe, malformed
// API payloads, bounded timeouts, and the negative cache that keeps a
// lyrics-less song from re-running the whole slow source chain.
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 404,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

describe('source resolution and malformed payloads', () => {
  it('returns synced lyrics from the primary source', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ syncedLyrics: '[00:01.00]Hello\n[00:05.00]World' }),
    ) as any;
    const svc = new LyricsService();
    const lines = await svc.fetchLyrics('Song', 'Artist');
    expect(lines).toEqual([
      { time: 1, text: 'Hello' },
      { time: 5, text: 'World' },
    ]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to plain lyrics when synced are missing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ plainLyrics: 'static one\nstatic two' }),
    ) as any;
    const svc = new LyricsService();
    const lines = await svc.fetchLyrics('Song', 'Artist');
    expect(lines.map(l => l.text)).toEqual(['static one', 'static two']);
    expect(lines[1].time).toBe(4);
  });

  it('MALFORMED synced lyrics fall through to plain lyrics', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ syncedLyrics: 'garbage no stamps', plainLyrics: 'plain line' }),
    ) as any;
    const svc = new LyricsService();
    const lines = await svc.fetchLyrics('Song', 'Artist');
    expect(lines).toEqual([{ time: 0, text: 'plain line' }]);
  });

  it('a malformed JSON body never throws — resolves to no lyrics', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new Error('bad json')),
    } as unknown as Response) as any;
    const svc = new LyricsService();
    await expect(svc.fetchLyrics('Song', 'Artist')).resolves.toEqual([]);
  });

  it('a non-array search payload is ignored safely', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(null)) // get → 200 but null body
      .mockResolvedValueOnce(jsonResponse({ not: 'an array' })) // search
      .mockResolvedValueOnce(jsonResponse({})) // suggest
      .mockResolvedValueOnce(jsonResponse({})) // v1
    ;
    const svc = new LyricsService();
    await expect(svc.fetchLyrics('Song', 'Artist')).resolves.toEqual([]);
  });

  it('falls through the chain when the first source has nothing', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, false)) // get → 404
      .mockResolvedValueOnce(jsonResponse([
        { syncedLyrics: '[00:02.00]from search' },
      ])) // search → hit
    ;
    const svc = new LyricsService();
    const lines = await svc.fetchLyrics('Song', 'Artist');
    expect(lines).toEqual([{ time: 2, text: 'from search' }]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('no source has lyrics — resolves [] without throwing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({}, false)) as any;
    const svc = new LyricsService();
    await expect(svc.fetchLyrics('Song', 'Artist')).resolves.toEqual([]);
  });

  it('missing title/artist short-circuits to [] with zero network calls', async () => {
    globalThis.fetch = vi.fn() as any;
    const svc = new LyricsService();
    expect(await svc.fetchLyrics('', 'Artist')).toEqual([]);
    expect(await svc.fetchLyrics('Song', '')).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('caching', () => {
  it('a second request for the same song is served from cache', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ syncedLyrics: '[00:01.00]x' }),
    ) as any;
    const svc = new LyricsService();
    await svc.fetchLyrics('Song', 'Artist');
    await svc.fetchLyrics('Song', 'Artist');
    await svc.fetchLyrics('song', 'artist'); // case-insensitive key
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('cache survives across service instances via localStorage', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ syncedLyrics: '[00:01.00]x' }),
    ) as any;
    const svc1 = new LyricsService();
    await svc1.fetchLyrics('Song', 'Artist');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    const svc2 = new LyricsService(); // fresh instance, same storage
    const lines = await svc2.fetchLyrics('Song', 'Artist');
    expect(lines).toEqual([{ time: 1, text: 'x' }]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('a lyrics-LESS result is negatively cached (no chain re-run per play)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({}, false)) as any;
    const svc = new LyricsService();
    await svc.fetchLyrics('Song', 'Artist');
    const callsAfterFirst = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    await svc.fetchLyrics('Song', 'Artist');
    expect(globalThis.fetch).toHaveBeenCalledTimes(callsAfterFirst); // unchanged
  });

  it('clearCache forces a fresh fetch', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ syncedLyrics: '[00:01.00]x' }),
    ) as any;
    const svc = new LyricsService();
    await svc.fetchLyrics('Song', 'Artist');
    svc.clearCache();
    await svc.fetchLyrics('Song', 'Artist');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('a corrupted persisted cache never throws on load', async () => {
    localStorage.setItem('lyrics-cache', '{{{not json');
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ syncedLyrics: '[00:01.00]x' }),
    ) as any;
    const svc = new LyricsService();
    await expect(svc.fetchLyrics('Song', 'Artist')).resolves.toHaveLength(1);
  });
});

describe('slow API behavior', () => {
  it('concurrent fetches for the SAME song are deduplicated to one request', async () => {
    let resolveFetch!: (v: Response) => void;
    const slow = new Promise<Response>((r) => { resolveFetch = r; });
    globalThis.fetch = vi.fn().mockReturnValue(slow) as any;
    const svc = new LyricsService();

    const p1 = svc.fetchLyrics('Song', 'Artist');
    const p2 = svc.fetchLyrics('Song', 'Artist');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    resolveFetch(jsonResponse({ syncedLyrics: '[00:01.00]x' }));
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);
    expect(r1).toHaveLength(1);
  });

  it('every request is aborted by its timeout — a hung API never hangs the app', async () => {
    vi.useFakeTimers();
    // A fetch that only ever rejects when its AbortSignal fires.
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    ) as any;
    const svc = new LyricsService();

    const pending = svc.fetchLyrics('Song', 'Artist');
    // 3 sources x 2 URLs worst case — drive every per-request timeout.
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(6_500);
    await expect(pending).resolves.toEqual([]);
  });
});
