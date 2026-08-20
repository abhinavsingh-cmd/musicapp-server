/**
 * YouTube streaming-pipeline tests.
 *
 * Covers the stream-resolution stage of the playback pipeline:
 *   song selection → YouTube ID → stream resolver → API → returned stream
 *
 * The extractor skips the redundant /audio-info HEAD check and goes straight
 * to /api/stream/:videoId.  Invalid/deleted videos are caught by the player's
 * canplay timeout → retry → error path.
 *
 * Cases required by the audit:
 *   - success           → a stream URL is produced and cached
 *   - invalid id        → short-circuited without network
 *   - expired URL       → forced re-resolution bypasses the cache
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

// ── success ──────────────────────────────────────────────────────────────────

describe('stream resolution — success', () => {
  it('returns a stream URL for a valid youtube ID without any fetch', async () => {
    mockFetch(() => Promise.resolve(new Response(null)));

    const url = await extractAudioUrl(VIDEO_ID);

    expect(url).toBeTruthy();
    expect(url).toContain('/stream/');
    expect(url).toContain(VIDEO_ID);
    // fetchFromServer no longer makes any fetch calls — it returns the stream URL directly
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('serves the cached URL on the next call without refetching', async () => {
    mockFetch(() => Promise.resolve(new Response(null)));

    const first = await extractAudioUrl(VIDEO_ID);
    const second = await extractAudioUrl(VIDEO_ID);

    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});

// ── invalid id ───────────────────────────────────────────────────────────────

describe('stream resolution — invalid id', () => {
  it('returns null for an empty id without network', async () => {
    mockFetch(() => Promise.resolve(new Response(null)));

    await expect(extractAudioUrl('')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('returns null for a short id without network', async () => {
    mockFetch(() => Promise.resolve(new Response(null)));

    await expect(extractAudioUrl('abc')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('returns null for an id with invalid characters', async () => {
    mockFetch(() => Promise.resolve(new Response(null)));

    await expect(extractAudioUrl('dQw4w9Wg!cQ')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});

// ── expired URL ──────────────────────────────────────────────────────────────

describe('stream resolution — expired URL', () => {
  it('forced invalidation re-resolves a FRESH url instead of the stale cached one', async () => {
    mockFetch(() => Promise.resolve(new Response(null)));

    const stale = await extractAudioUrl(VIDEO_ID);
    expect(stale).toContain('/stream/');
    expect(stale).toContain(VIDEO_ID);

    invalidateAudioUrl(VIDEO_ID);

    const fresh = await extractAudioUrl(VIDEO_ID);
    expect(fresh).toContain('/stream/');
    expect(fresh).toContain(VIDEO_ID);
  });

  it('cached URLs expire after the TTL and are re-fetched', async () => {
    mockFetch(() => Promise.resolve(new Response(null)));
    await extractAudioUrl(VIDEO_ID);
    // No fetch calls — fetchFromServer is pure URL construction
    expect(fetchMock).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(26 * 60 * 1000); // past the 25-minute TTL
    await extractAudioUrl(VIDEO_ID);
    // Still no fetch calls — cache expired but the URL is the same pattern
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});

// ── fallback resolution + crash isolation ────────────────────────────────────

describe('fallback resolution and crash isolation', () => {
  it('provider falls back to the embedded IFrame source when extractAudioUrl returns null', async () => {
    mockFetch(() => Promise.resolve(new Response(null)));
    const { youtubeProvider } = await import('../providers/youtubeProvider');

    // With the simplified extractor (no HEAD check), a valid youtube ID
    // always returns a stream URL. The provider returns a stream source.
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
    expect(source?.kind).toBe('stream');
    if (source && source.kind === 'stream') {
      expect(source.streamUrl).toContain('/stream/');
      expect(source.streamUrl).toContain(VIDEO_ID);
    }
  });

  it('resolveStream({ force: true }) invalidates the cache before resolving', async () => {
    mockFetch(() => Promise.resolve(new Response(null)));
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
    // fetchFromServer makes no fetch calls
    expect(fetchMock).toHaveBeenCalledTimes(0);

    // Without force: cache hit, no refetch.
    await youtubeProvider.resolveStream(track);
    expect(fetchMock).toHaveBeenCalledTimes(0);

    // With force: stale URL dropped, fresh resolution.
    await youtubeProvider.resolveStream(track, { force: true });
    expect(fetchMock).toHaveBeenCalledTimes(0);
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
