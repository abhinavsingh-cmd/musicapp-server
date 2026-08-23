/**
 * Provider isolation tests — integration level.
 *
 * Proves that a broken/hanging provider can never:
 *   - crash the app
 *   - block other providers from working
 *   - leave the application in a permanent loading state
 *
 * These tests register test-only providers that deliberately fail in
 * various ways (timeout, exception, returning bad data) and verify that
 * the rest of the system continues to function normally.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { providerRegistry } from './registry';
import { searchProviders } from './search';
import { resolvePlayableSource, resolveDownloadDescriptor } from './resolve';
import { healthTracker } from './healthTracker';
import type { Track, TrackProvider } from './types';

vi.mock('../services/youtubeAudioExtractor', () => ({
  extractAudioUrl: vi.fn(),
  invalidateAudioUrl: vi.fn(),
}));
vi.mock('../services/youtubeSearchService', () => ({
  youtubeSearch: vi.fn(),
}));
vi.mock('../services/trendingService', () => ({
  trendingService: { getTrending: vi.fn() },
}));
vi.mock('../services/musicApi', () => ({
  fetchSongs: vi.fn(),
  searchSongs: vi.fn(),
}));
vi.mock('../services/lyricsService', () => ({
  lyricsService: { fetchLyrics: vi.fn() },
}));
vi.mock('../services/recommendationService', () => ({
  getRecommendations: vi.fn(),
}));

const NO_CAPS = {
  search: false,
  trackLookup: false,
  lyrics: false,
  charts: false,
  relatedTracks: false,
  downloads: false,
} as const;

function makeTrack(overrides: Partial<Track>): Track {
  return {
    id: 't-1',
    provider: 'test-provider',
    title: 'Test Track',
    artist: 'Test Artist',
    album: 'Test Album',
    genre: 'Pop',
    duration: 200,
    artwork: '',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  healthTracker.reset();
});

afterEach(() => {
  // Clean up any test providers
  for (const p of providerRegistry.list()) {
    if (p.id.startsWith('test-')) {
      providerRegistry.unregister(p.id);
    }
  }
  healthTracker.reset();
});

// ---------------------------------------------------------------------------
// Search isolation — one broken provider never blocks others
// ---------------------------------------------------------------------------

describe('search isolation', () => {
  it('one provider timing out does not block other providers from returning results', async () => {
    // Register a working provider
    providerRegistry.register({
      id: 'test-working',
      name: 'Working',
      capabilities: { ...NO_CAPS, search: true },
      search: async () => [makeTrack({ id: 'w-1', provider: 'test-working' })],
      getTrack: async t => t,
      resolveStream: async () => null,
    });

    // Register a provider that hangs forever
    providerRegistry.register({
      id: 'test-hanging',
      name: 'Hanging',
      capabilities: { ...NO_CAPS, search: true },
      search: () => new Promise(() => {}), // never resolves
      getTrack: async t => t,
      resolveStream: async () => null,
    });

    try {
      // searchProviders wraps each call in safeProviderCall with 20s timeout.
      // The hanging provider will timeout; the working one returns immediately.
      const results = await searchProviders('test', {
        providers: ['test-working', 'test-hanging'],
      });

      // Should have 2 results
      expect(results).toHaveLength(2);

      // Working provider should have results
      const working = results.find(r => r.providerId === 'test-working')!;
      expect(working.tracks).toHaveLength(1);
      expect(working.error).toBeUndefined();

      // Hanging provider should have timed out
      const hanging = results.find(r => r.providerId === 'test-hanging')!;
      expect(hanging.tracks).toEqual([]);
      expect(hanging.error).toBeDefined();
      expect(hanging.error!.message).toContain('timed out');
    } finally {
      providerRegistry.unregister('test-working');
      providerRegistry.unregister('test-hanging');
    }
  }, 30_000);

  it('one provider throwing does not affect other providers', async () => {
    providerRegistry.register({
      id: 'test-ok',
      name: 'OK',
      capabilities: { ...NO_CAPS, search: true },
      search: async () => [makeTrack({ id: 'ok-1', provider: 'test-ok' })],
      getTrack: async t => t,
      resolveStream: async () => null,
    });

    providerRegistry.register({
      id: 'test-broken',
      name: 'Broken',
      capabilities: { ...NO_CAPS, search: true },
      search: async () => { throw new Error('provider is broken'); },
      getTrack: async t => t,
      resolveStream: async () => null,
    });

    try {
      const results = await searchProviders('test', {
        providers: ['test-ok', 'test-broken'],
      });

      expect(results).toHaveLength(2);

      const ok = results.find(r => r.providerId === 'test-ok')!;
      expect(ok.tracks).toHaveLength(1);
      expect(ok.error).toBeUndefined();

      const broken = results.find(r => r.providerId === 'test-broken')!;
      expect(broken.tracks).toEqual([]);
      expect(broken.error?.message).toBe('provider is broken');
    } finally {
      providerRegistry.unregister('test-ok');
      providerRegistry.unregister('test-broken');
    }
  });

  it('all providers timing out returns empty results (not a hang)', async () => {
    providerRegistry.register({
      id: 'test-slow-a',
      name: 'SlowA',
      capabilities: { ...NO_CAPS, search: true },
      search: () => new Promise(() => {}),
      getTrack: async t => t,
      resolveStream: async () => null,
    });

    providerRegistry.register({
      id: 'test-slow-b',
      name: 'SlowB',
      capabilities: { ...NO_CAPS, search: true },
      search: () => new Promise(() => {}),
      getTrack: async t => t,
      resolveStream: async () => null,
    });

    try {
      const results = await searchProviders('test', {
        providers: ['test-slow-a', 'test-slow-b'],
      });

      expect(results).toHaveLength(2);
      expect(results.every(r => r.tracks.length === 0)).toBe(true);
      expect(results.every(r => r.error !== undefined)).toBe(true);
    } finally {
      providerRegistry.unregister('test-slow-a');
      providerRegistry.unregister('test-slow-b');
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Resolution isolation — one broken provider never crashes the app
// ---------------------------------------------------------------------------

describe('resolution isolation', () => {
  it('a provider that throws returns null (not a crash)', async () => {
    providerRegistry.register({
      id: 'test-throwing',
      name: 'Throwing',
      capabilities: { ...NO_CAPS },
      search: async () => [],
      getTrack: async t => t,
      resolveStream: async () => { throw new Error('resolveStream exploded'); },
    });

    try {
      const track = makeTrack({ provider: 'test-throwing' });
      const result = await resolvePlayableSource(track);
      expect(result).toBeNull();
    } finally {
      providerRegistry.unregister('test-throwing');
    }
  });

  it('a provider that hangs returns null after timeout (not a permanent load)', async () => {
    providerRegistry.register({
      id: 'test-hang-resolve',
      name: 'HangResolve',
      capabilities: { ...NO_CAPS },
      search: async () => [],
      getTrack: async t => t,
      resolveStream: () => new Promise(() => {}), // never resolves
    });

    try {
      const track = makeTrack({ provider: 'test-hang-resolve' });
      const result = await resolvePlayableSource(track);
      expect(result).toBeNull();
    } finally {
      providerRegistry.unregister('test-hang-resolve');
    }
  }, 35_000);

  it('a provider returning malformed data does not crash the app', async () => {
    providerRegistry.register({
      id: 'test-malformed',
      name: 'Malformed',
      capabilities: { ...NO_CAPS },
      search: async () => [],
      getTrack: async t => t,
      resolveStream: async () => 'not a PlayableSource' as any,
    });

    try {
      const track = makeTrack({ provider: 'test-malformed' });
      // The provider returns invalid data. The facade should not throw —
      // it returns whatever the provider returned, and the caller (audioService)
      // handles type mismatches gracefully.
      const result = await resolvePlayableSource(track);
      expect(result).toBeDefined();
      // The result is not a valid PlayableSource, but the app doesn't crash.
      // The audioService will handle this gracefully (emitPlaybackError).
    } finally {
      providerRegistry.unregister('test-malformed');
    }
  });

  it('download resolution with a throwing provider returns null', async () => {
    providerRegistry.register({
      id: 'test-dl-throw',
      name: 'DLThrow',
      capabilities: { ...NO_CAPS, downloads: true },
      search: async () => [],
      getTrack: async t => t,
      resolveStream: async () => null,
      resolveDownload: async () => { throw new Error('download exploded'); },
    });

    try {
      const track = makeTrack({ provider: 'test-dl-throw' });
      const result = await resolveDownloadDescriptor(track);
      expect(result).toBeNull();
    } finally {
      providerRegistry.unregister('test-dl-throw');
    }
  });

  it('download resolution with a hanging provider returns null after timeout', async () => {
    providerRegistry.register({
      id: 'test-dl-hang',
      name: 'DLHang',
      capabilities: { ...NO_CAPS, downloads: true },
      search: async () => [],
      getTrack: async t => t,
      resolveStream: async () => null,
      resolveDownload: () => new Promise(() => {}), // never resolves
    });

    try {
      const track = makeTrack({ provider: 'test-dl-hang' });
      const result = await resolveDownloadDescriptor(track);
      expect(result).toBeNull();
    } finally {
      providerRegistry.unregister('test-dl-hang');
    }
  }, 20_000);
});

// ---------------------------------------------------------------------------
// Mixed scenario — one good, one broken, one hanging
// ---------------------------------------------------------------------------

describe('mixed provider scenario', () => {
  it('search returns results from the good provider when others fail', async () => {
    providerRegistry.register({
      id: 'test-good',
      name: 'Good',
      capabilities: { ...NO_CAPS, search: true },
      search: async () => [makeTrack({ id: 'g-1', provider: 'test-good', title: 'Good Song' })],
      getTrack: async t => t,
      resolveStream: async () => null,
    });

    providerRegistry.register({
      id: 'test-broken2',
      name: 'Broken2',
      capabilities: { ...NO_CAPS, search: true },
      search: async () => { throw new Error('broken'); },
      getTrack: async t => t,
      resolveStream: async () => null,
    });

    providerRegistry.register({
      id: 'test-hang2',
      name: 'Hang2',
      capabilities: { ...NO_CAPS, search: true },
      search: () => new Promise(() => {}),
      getTrack: async t => t,
      resolveStream: async () => null,
    });

    try {
      const results = await searchProviders('test', {
        providers: ['test-good', 'test-broken2', 'test-hang2'],
      });

      expect(results).toHaveLength(3);

      // Good provider has results
      const good = results.find(r => r.providerId === 'test-good')!;
      expect(good.tracks).toHaveLength(1);
      expect(good.tracks[0].title).toBe('Good Song');

      // Broken provider has error
      const broken = results.find(r => r.providerId === 'test-broken2')!;
      expect(broken.tracks).toEqual([]);
      expect(broken.error?.message).toBe('broken');

      // Hanging provider has timeout error
      const hanging = results.find(r => r.providerId === 'test-hang2')!;
      expect(hanging.tracks).toEqual([]);
      expect(hanging.error?.message).toContain('timed out');
    } finally {
      providerRegistry.unregister('test-good');
      providerRegistry.unregister('test-broken2');
      providerRegistry.unregister('test-hang2');
    }
  }, 30_000);
});
