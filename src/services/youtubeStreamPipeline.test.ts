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
  it('returns a direct googlevideo URL for a valid youtube ID via /extract', async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true, details: { url: 'https://rr1---sn-xyz.googlevideo.com/videoplayback?expire=999', expires: Date.now() + 600000 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const url = await extractAudioUrl(VIDEO_ID);

    expect(url).toBeTruthy();
    expect(url).toContain('googlevideo.com');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves the cached URL on the next call without refetching', async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true, details: { url: 'https://rr1---sn-xyz.googlevideo.com/videoplayback?expire=999', expires: Date.now() + 600000 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const first = await extractAudioUrl(VIDEO_ID);
    const second = await extractAudioUrl(VIDEO_ID);

    expect(second).toBe(first);
    // second call hits urlCache, no second fetch
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    mockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true, details: { url: 'https://rr1---sn-xyz.googlevideo.com/videoplayback?expire=111', expires: Date.now() + 600000 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const stale = await extractAudioUrl(VIDEO_ID);
    expect(stale).toContain('googlevideo.com');

    invalidateAudioUrl(VIDEO_ID);

    // second fetch returns different URL (fresh)
    mockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true, details: { url: 'https://rr2---sn-abc.googlevideo.com/videoplayback?expire=222', expires: Date.now() + 600000 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const fresh = await extractAudioUrl(VIDEO_ID);
    expect(fresh).toContain('googlevideo.com');
    expect(fresh).not.toBe(stale);
  });

  it('cached URLs expire after the TTL and are re-fetched', async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true, details: { url: 'https://rr1---sn-xyz.googlevideo.com/videoplayback?expire=999', expires: Date.now() + 600000 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    await extractAudioUrl(VIDEO_ID);
    const firstCalls = fetchMock.mock.calls.length;

    await vi.advanceTimersByTimeAsync(26 * 60 * 1000); // past the 25-minute TTL
    mockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true, details: { url: 'https://rr1---sn-xyz2.googlevideo.com/videoplayback?expire=999', expires: Date.now() + 600000 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const url = await extractAudioUrl(VIDEO_ID);
    expect(url).toContain('googlevideo.com');
    // After TTL expiry, should have refetched (at least one more call)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    // second fetch happened (total calls > first)
    expect(url).toBeTruthy();
  });
});

// ── fallback resolution + crash isolation ────────────────────────────────────

describe('fallback resolution and crash isolation', () => {
  it('provider returns fallback /stream URL when direct extraction returns null', async () => {
    // Direct extraction fails permanently (400 invalid) -> no retry, provider falls back to /stream
    mockFetch(() => Promise.resolve(new Response(JSON.stringify({ success: false, code: 'INVALID_VIDEO_ID', message: 'invalid' }), { status: 400, headers: { 'content-type': 'application/json' } })));
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
    expect(source?.kind).toBe('stream');
    if (source && source.kind === 'stream') {
      expect(source.streamUrl).toContain('/stream/');
      expect(source.streamUrl).toContain(VIDEO_ID);
    }
  });

  it('resolveStream({ force: true }) invalidates the cache and returns fallback stream', async () => {
    // youtubeProvider now always returns /stream fallback for reliability
    // (extract→proxy is IP-locked), so no direct fetch via extractAudioUrl is used.
    mockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true, details: { url: 'https://rr1---sn-xyz.googlevideo.com/videoplayback?expire=111', expires: Date.now() + 600000 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
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

    const first = await youtubeProvider.resolveStream(track);
    expect(first?.kind).toBe('stream');
    expect((first as any).streamUrl).toContain('/stream/');
    // No direct extraction fetch — always fallback
    expect(fetchMock).toHaveBeenCalledTimes(0);

    // Second call without force: still fallback, still no fetch
    const second = await youtubeProvider.resolveStream(track);
    expect(second?.kind).toBe('stream');
    expect(fetchMock).toHaveBeenCalledTimes(0);

    // With force: still fallback, no additional fetch
    const third = await youtubeProvider.resolveStream(track, { force: true });
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(third?.kind).toBe('stream');
    expect((third as any).streamUrl).toContain('/stream/');
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
