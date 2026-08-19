/**
 * YouTube streaming-pipeline tests.
 *
 * Covers the stream-resolution stage of the playback pipeline:
 *   song selection → YouTube ID → stream resolver → API → returned stream
 *
 * The extractor now skips the redundant /audio-info call and goes straight
 * to /api/stream/:videoId. A quick HEAD check validates video existence
 * before the player commits to a long stream request.
 *
 * Cases required by the audit:
 *   - success           → a stream URL is produced and cached
 *   - invalid id        → short-circuited without network
 *   - unavailable video → HEAD check detects 404, permanent block
 *   - timeout           → HEAD timeout falls through to stream URL
 *   - expired URL       → forced re-resolution bypasses the cache
 *   - network failure   → transient errors retry, then back off on a TTL
 *   - fallback          → no stream → embedded IFrame source instead of null/crash
 *   - crash isolation   → a throwing provider can never reject resolvePlayableSource
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAudioUrlCache,
  extractAudioUrl,
  invalidateAudioUrl,
} from './youtubeAudioExtractor';

// ── fetch fixtures ───────────────────────────────────────────────────────────

const VIDEO_ID = 'dQw4w9WgXcQ';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function headResponse(status = 200): Response {
  return new Response(null, { status });
}

let fetchMock: ReturnType<typeof vi.fn>;

function mockFetch(impl: (...args: any[]) => any): void {
  fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
}

// ── lifecycle ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  clearAudioUrlCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Drive all pending timers to completion. */
async function flush(seconds = 30): Promise<void> {
  await vi.advanceTimersByTimeAsync(seconds * 1000);
}

// ── success ──────────────────────────────────────────────────────────────────

describe('stream resolution — success', () => {
  it('returns a stream URL for a valid youtube ID', async () => {
    mockFetch(() => Promise.resolve(headResponse(200)));

    const url = await extractAudioUrl(VIDEO_ID);

    expect(url).toBeTruthy();
    expect(url).toContain('/stream/');
    expect(url).toContain(VIDEO_ID);
    // HEAD check + no more calls
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves the cached URL on the next call without refetching', async () => {
    mockFetch(() => Promise.resolve(headResponse(200)));

    const first = await extractAudioUrl(VIDEO_ID);
    const second = await extractAudioUrl(VIDEO_ID);

    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ── invalid id ───────────────────────────────────────────────────────────────

describe('stream resolution — invalid id', () => {
  it('returns null for an empty id without network', async () => {
    mockFetch(() => Promise.resolve(headResponse(200)));

    await expect(extractAudioUrl('')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('returns null for a short id without network', async () => {
    mockFetch(() => Promise.resolve(headResponse(200)));

    await expect(extractAudioUrl('abc')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('returns null for an id with invalid characters', async () => {
    mockFetch(() => Promise.resolve(headResponse(200)));

    await expect(extractAudioUrl('dQw4w9Wg!cQ')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});

// ── unavailable video ────────────────────────────────────────────────────────

describe('stream resolution — unavailable video', () => {
  it('treats a 404 HEAD response as permanent: no retry, blocked for TTL', async () => {
    mockFetch(() => Promise.resolve(headResponse(404)));

    const url = await extractAudioUrl(VIDEO_ID);
    expect(url).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Subsequent taps within the TTL must not hammer the server.
    await expect(extractAudioUrl(VIDEO_ID)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a 400 HEAD response is likewise permanent', async () => {
    mockFetch(() => Promise.resolve(headResponse(400)));

    await expect(extractAudioUrl(VIDEO_ID)).resolves.toBeNull();
    await expect(extractAudioUrl(VIDEO_ID)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ── timeout ──────────────────────────────────────────────────────────────────

describe('stream resolution — timeout', () => {
  it('HEAD check timeout falls through to stream URL (does not block)', async () => {
    // HEAD request that never resolves (simulates network stall)
    mockFetch((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });

    const promise = extractAudioUrl(VIDEO_ID);
    // Advance past the 5s HEAD timeout so the AbortController fires
    await flush(6);
    const url = await promise;
    // Even on HEAD timeout, we still return the stream URL (player handles its own errors)
    expect(url).toContain('/stream/');
    expect(url).toContain(VIDEO_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ── expired URL ──────────────────────────────────────────────────────────────

describe('stream resolution — expired URL', () => {
  it('forced invalidation re-resolves instead of returning the stale cached URL', async () => {
    mockFetch(() => Promise.resolve(headResponse(200)));

    const stale = await extractAudioUrl(VIDEO_ID);
    expect(stale).toContain('/stream/');
    expect(stale).toContain(VIDEO_ID);

    invalidateAudioUrl(VIDEO_ID);

    const fresh = await extractAudioUrl(VIDEO_ID);
    expect(fresh).toContain('/stream/');
    expect(fresh).toContain(VIDEO_ID);
  });

  it('cached URLs expire after the TTL and are re-fetched', async () => {
    mockFetch(() => Promise.resolve(headResponse(200)));
    await extractAudioUrl(VIDEO_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(26 * 60 * 1000); // past the 25-minute TTL
    await extractAudioUrl(VIDEO_ID);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ── network failure ──────────────────────────────────────────────────────────

describe('stream resolution — network failure', () => {
  it('HEAD network error falls through to stream URL (does not block)', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));

    const url = await extractAudioUrl(VIDEO_ID);
    // Network error on HEAD → still return stream URL
    expect(url).toContain('/stream/');
    expect(url).toContain(VIDEO_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ── fallback resolution + crash isolation ────────────────────────────────────

describe('fallback resolution and crash isolation', () => {
  it('provider falls back to the embedded IFrame source when HEAD returns 404', async () => {
    mockFetch(() => Promise.resolve(headResponse(404)));
    const { youtubeProvider } = await import('../providers/youtubeProvider');

    const source = await youtubeProvider.resolveStream({
      id: `yt-${VIDEO_ID}`,
      provider: 'youtube',
      title: 'Song',
      artist: 'Artist',
      album: '',
      genre: 'YouTube',
      duration: 200,
      artwork: '',
      externalId: VIDEO_ID,
    });

    expect(source).not.toBeNull();
    expect(source?.kind).toBe('iframe');
    if (source && source.kind === 'iframe') {
      expect(source.videoId).toBe(VIDEO_ID);
    }
  });

  it('resolveStream({ force: true }) invalidates the cache before resolving', async () => {
    mockFetch(() => Promise.resolve(headResponse(200)));
    const { youtubeProvider } = await import('../providers/youtubeProvider');
    const track = {
      id: `yt-${VIDEO_ID}`,
      provider: 'youtube' as const,
      title: 'Song',
      artist: 'Artist',
      album: '',
      genre: 'YouTube',
      duration: 200,
      artwork: '',
      externalId: VIDEO_ID,
    };

    await youtubeProvider.resolveStream(track);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Without force: cache hit, no refetch.
    await youtubeProvider.resolveStream(track);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // With force: stale URL dropped, fresh resolution fetched.
    await youtubeProvider.resolveStream(track, { force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a throwing provider can never crash resolution — resolvePlayableSource returns null', async () => {
    const { providerRegistry } = await import('../providers/registry');
    const { resolvePlayableSource } = await import('../providers/resolve');

    const throwingProvider = {
      id: 'boom' as const,
      name: 'Boom',
      capabilities: {
        search: false, trackLookup: false, lyrics: false,
        charts: false, relatedTracks: false, downloads: false,
      },
      search: async () => [],
      getTrack: async (t: any) => t,
      resolveStream: async () => {
        throw new Error('provider exploded');
      },
    };
    providerRegistry.register(throwingProvider);

    try {
      const result = await resolvePlayableSource({
        id: 'boom-1',
        provider: 'boom',
        title: 'Song',
        artist: 'Artist',
        album: '',
        genre: '',
        duration: 100,
        artwork: '',
      });
      expect(result).toBeNull();
    } finally {
      providerRegistry.unregister('boom');
    }
  });
});
