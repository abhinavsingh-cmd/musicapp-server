/**
 * YouTube streaming-pipeline tests.
 *
 * Covers the stream-resolution stage of the playback pipeline:
 *
 *   song selection → YouTube ID → stream resolver → API → returned stream
 *
 * Cases required by the audit:
 *   - success           → a proxy stream URL is produced and cached
 *   - invalid response  → malformed/empty payloads fail controlled, never throw
 *   - timeout           → aborted request retries exactly once, never infinitely
 *   - unavailable video → permanent HTTP error stops immediately, no retry storm
 *   - expired URL       → forced re-resolution bypasses the cache (fresh URL)
 *   - network failure   → transient errors retry once, then back off on a TTL
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
const GOOGLE_URL = 'https://rr3.googlevideo.com/videoplayback?id=abc';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function successBody(formats: unknown[]): unknown {
  return {
    success: true,
    code: 'OK',
    details: { title: 'Song', formats },
  };
}

const goodFormats = [
  { url: GOOGLE_URL, quality: 'medium', ext: 'm4a', bitrate: 128 },
  { url: 'https://rr3.googlevideo.com/low', quality: 'low', ext: 'webm', bitrate: 64 },
];

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

/** Drive all pending timers (4s extraction timeout, 400ms backoff) to completion. */
async function flush(seconds = 30): Promise<void> {
  await vi.advanceTimersByTimeAsync(seconds * 1000);
}

// ── success ──────────────────────────────────────────────────────────────────

describe('stream resolution — success', () => {
  it('returns a proxy stream URL for the best audio format', async () => {
    mockFetch(() => Promise.resolve(jsonResponse(successBody(goodFormats))));

    const url = await extractAudioUrl(VIDEO_ID);

    expect(url).toBeTruthy();
    expect(url).toContain('/proxy-audio?url=');
    expect(url).toContain(encodeURIComponent(GOOGLE_URL));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves the cached URL on the next call without refetching', async () => {
    mockFetch(() => Promise.resolve(jsonResponse(successBody(goodFormats))));

    const first = await extractAudioUrl(VIDEO_ID);
    const second = await extractAudioUrl(VIDEO_ID);

    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('prefers the highest-bitrate format with a usable URL', async () => {
    mockFetch(() =>
      Promise.resolve(
        jsonResponse(
          successBody([
            { url: '', quality: 'high', ext: 'm4a', bitrate: 999 }, // empty URL — skipped
            { url: 'https://rr3.googlevideo.com/low', quality: 'low', ext: 'm4a', bitrate: 64 },
            { url: GOOGLE_URL, quality: 'medium', ext: 'm4a', bitrate: 128 },
          ]),
        ),
      ),
    );

    const url = await extractAudioUrl(VIDEO_ID);
    expect(url).toContain(encodeURIComponent(GOOGLE_URL));
  });
});

// ── invalid response ─────────────────────────────────────────────────────────

describe('stream resolution — invalid response', () => {
  it('returns null (never throws) when the server sends a malformed body', async () => {
    mockFetch(() =>
      Promise.resolve(new Response('this is not json', { status: 200 })),
    );

    const url = await extractAudioUrl(VIDEO_ID);
    expect(url).toBeNull();
    // Malformed payloads are permanent — no retry storm.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null when the response has no formats', async () => {
    mockFetch(() => Promise.resolve(jsonResponse(successBody([]))));

    await expect(extractAudioUrl(VIDEO_ID)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null when the server reports success:false', async () => {
    mockFetch(() =>
      Promise.resolve(jsonResponse({ success: false, code: 'YT_DLP_ERROR' })),
    );

    await expect(extractAudioUrl(VIDEO_ID)).resolves.toBeNull();
  });

  it('retries once when formats arrive without any usable URL (empty URL)', async () => {
    mockFetch(() =>
      Promise.resolve(
        jsonResponse(successBody([{ url: '', quality: 'medium', ext: 'm4a', bitrate: 128 }])),
      ),
    );

    const promise = extractAudioUrl(VIDEO_ID);
    await flush();
    await expect(promise).resolves.toBeNull();
    // Bounded: initial attempt + exactly one retry.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ── timeout ──────────────────────────────────────────────────────────────────

describe('stream resolution — timeout', () => {
  it('aborts after the 4s timeout, retries once, and gives up (bounded)', async () => {
    // A fetch that only ever settles via the AbortController timeout.
    mockFetch((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });

    const promise = extractAudioUrl(VIDEO_ID);
    await flush(30);
    await expect(promise).resolves.toBeNull();

    // Never retries infinitely: exactly two server attempts total.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('recovers when the retry succeeds after a timeout', async () => {
    let call = 0;
    mockFetch((_url: string, init?: RequestInit) => {
      call += 1;
      if (call === 1) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      }
      return Promise.resolve(jsonResponse(successBody(goodFormats)));
    });

    const promise = extractAudioUrl(VIDEO_ID);
    await flush();
    const url = await promise;

    expect(url).toContain('/proxy-audio');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ── unavailable video ────────────────────────────────────────────────────────

describe('stream resolution — unavailable video', () => {
  it('treats a permanent HTTP error as definitive: no retry, blocked for the TTL', async () => {
    mockFetch(() => Promise.resolve(jsonResponse({ success: false }, 404)));

    const url = await extractAudioUrl(VIDEO_ID);
    expect(url).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Subsequent taps within the TTL must not hammer the server.
    await expect(extractAudioUrl(VIDEO_ID)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a 400 invalid-id response is likewise permanent', async () => {
    mockFetch(() => Promise.resolve(jsonResponse({ success: false }, 400)));

    await expect(extractAudioUrl(VIDEO_ID)).resolves.toBeNull();
    await expect(extractAudioUrl(VIDEO_ID)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ── expired URL ──────────────────────────────────────────────────────────────

describe('stream resolution — expired URL', () => {
  it('forced invalidation re-resolves a FRESH url instead of the stale cached one', async () => {
    const staleUrl = 'https://rr3.googlevideo.com/stale';
    const freshUrl = 'https://rr3.googlevideo.com/fresh';
    mockFetch(() =>
      Promise.resolve(jsonResponse(successBody([{ url: staleUrl, bitrate: 128 }]))),
    );

    const stale = await extractAudioUrl(VIDEO_ID);
    expect(stale).toContain(encodeURIComponent(staleUrl));

    // The cached proxy URL expired upstream (403/416) — the engine calls
    // invalidateAudioUrl (via resolveStream({ force: true })) and re-resolves.
    invalidateAudioUrl(VIDEO_ID);
    mockFetch(() =>
      Promise.resolve(jsonResponse(successBody([{ url: freshUrl, bitrate: 128 }]))),
    );

    const fresh = await extractAudioUrl(VIDEO_ID);
    expect(fresh).toContain(encodeURIComponent(freshUrl));
    expect(fresh).not.toBe(stale);
  });

  it('cached URLs expire after the TTL and are re-fetched', async () => {
    mockFetch(() => Promise.resolve(jsonResponse(successBody(goodFormats))));
    await extractAudioUrl(VIDEO_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(26 * 60 * 1000); // past the 25-minute TTL
    await extractAudioUrl(VIDEO_ID);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ── network failure ──────────────────────────────────────────────────────────

describe('stream resolution — network failure', () => {
  it('retries once on network errors, then backs off via the transient TTL', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));

    const promise = extractAudioUrl(VIDEO_ID);
    await flush();
    await expect(promise).resolves.toBeNull();
    // Bounded: exactly two attempts, never an infinite loop.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Immediately after, the id is briefly blocked — no refetch.
    await expect(extractAudioUrl(VIDEO_ID)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // After the transient TTL lapses the id gets a fresh chance.
    await vi.advanceTimersByTimeAsync(61 * 1000);
    const retry = extractAudioUrl(VIDEO_ID);
    await flush();
    await retry;
    expect(fetchMock).toHaveBeenCalledTimes(4); // two more bounded attempts
  });

  it('invalidateAudioUrl clears a transient failure block', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const first = extractAudioUrl(VIDEO_ID);
    await flush();
    await first;
    expect(fetchMock).toHaveBeenCalledTimes(2);

    invalidateAudioUrl(VIDEO_ID);
    const second = extractAudioUrl(VIDEO_ID);
    await flush();
    await second;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('a 5xx server error is transient: one bounded retry', async () => {
    mockFetch(() => Promise.resolve(jsonResponse({ success: false }, 502)));

    const promise = extractAudioUrl(VIDEO_ID);
    await flush();
    await expect(promise).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ── fallback resolution + crash isolation ────────────────────────────────────

describe('fallback resolution and crash isolation', () => {
  it('provider falls back to the embedded IFrame source when no stream exists', async () => {
    mockFetch(() => Promise.resolve(jsonResponse({ success: false }, 404)));
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
    mockFetch(() => Promise.resolve(jsonResponse(successBody(goodFormats))));
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
