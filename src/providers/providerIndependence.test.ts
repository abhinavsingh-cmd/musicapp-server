/**
 * Provider-independence guarantees (architecture redesign).
 *
 * Proves that a brand-new provider can be added without rewriting the
 * player, the preload path, or the search surface:
 *
 *   - provider identity survives the Song layer (queue/persistence)
 *   - the playback engine's input (EnginePlayParams) is produced purely
 *     from the normalized Track/PlayableSource for an unknown provider
 *   - the download system consumes the unknown provider's descriptor
 *   - the search facade aggregates providers and isolates failures
 *   - network warmup flows through the provider contract (`preconnect`)
 *     without any provider-id branching in generic code
 *
 * All fixture providers below are test-only — the shipped app contains no
 * fake providers.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  inferProvider,
  playableToEngineParams,
  providerRegistry,
  resolveDownloadDescriptor,
  resolvePlayableSource,
  searchProviders,
  toSong,
  toTrack,
  type Track,
  type TrackProvider,
} from '../providers';
import { preloadNextSongs } from '../services/preloadService';
import { youtubeProvider } from '../providers/youtubeProvider';
import { Song } from '../types/music';

// Same mocks as providers.test.ts — keeps the barrel import side-effect-free.
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

function makeSong(overrides: Partial<Song>): Song {
  return {
    id: 's-1',
    title: 'Song',
    artist: 'Artist',
    album: 'Album',
    duration: 100,
    genre: 'Pop',
    coverArt: '',
    audioUrl: '',
    releaseYear: 2024,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Provider identity survives the Song layer (queue / persistence boundaries)
// ---------------------------------------------------------------------------

describe('provider identity across the Song layer', () => {
  it('toTrack honors an explicit provider instead of inferring library', () => {
    // Without the provider field this Song would be inferred as 'library'.
    const track = toTrack(makeSong({ id: 'jsn-x', provider: 'jiosaavn' }));
    expect(track.provider).toBe('jiosaavn');
  });

  it('inferProvider prefers an explicit provider over youtubeId inference', () => {
    expect(inferProvider({ provider: 'some-future-provider', youtubeId: 'dQw4w9WgXcQ' }))
      .toBe('some-future-provider');
    expect(inferProvider({ youtubeId: 'dQw4w9WgXcQ' })).toBe('youtube');
    expect(inferProvider({})).toBe('library');
  });

  it('round-trips provider identity through toSong (persistence shape)', () => {
    const track: Track = {
      id: 'jsn-abc',
      provider: 'jiosaavn',
      title: 'Kesariya',
      artist: 'Arijit Singh',
      album: 'Brahmastra',
      genre: 'Unknown',
      duration: 268,
      artwork: 'https://cdn.example.com/500x500.jpg',
      externalId: 'abc',
    };
    const song = toSong(track);
    expect(song.provider).toBe('jiosaavn');
    // Non-YouTube providers must never masquerade as YouTube ids.
    expect(song.youtubeId).toBeUndefined();
    // And the identity survives the trip back (e.g. after JSON persistence).
    expect(toTrack(JSON.parse(JSON.stringify(song))).provider).toBe('jiosaavn');
  });
});

// ---------------------------------------------------------------------------
// The playback engine consumes a brand-new provider's tracks unchanged
// ---------------------------------------------------------------------------

describe('engine params from a brand-new provider', () => {
  function registerNovaStreamProvider(id: string, streamUrl: string): void {
    const nova: TrackProvider = {
      id,
      name: 'Nova (test fixture)',
      capabilities: { ...NO_CAPS },
      search: async () => [],
      getTrack: async t => t,
      resolveStream: async track => ({
        kind: 'stream' as const,
        track,
        streamUrl,
        isLocalFile: streamUrl.startsWith('blob:'),
        expiresInMs: 120_000,
      }),
    };
    providerRegistry.register(nova);
  }

  it('resolves a direct stream from an unknown provider to html engine params', async () => {
    registerNovaStreamProvider('nova', 'https://nova.example.com/stream/1.mp3');
    try {
      const track: Track = {
        id: 'nv-1',
        provider: 'nova',
        title: 'Nova Track',
        artist: 'Nova Artist',
        album: '',
        genre: '',
        duration: 200,
        artwork: '',
        externalId: 'nv-ext-1',
      };
      const playable = await resolvePlayableSource(track);
      expect(playable?.kind).toBe('stream');
      // The engine receives exactly the normalized params — no provider id,
      // no endpoint knowledge.
      expect(playableToEngineParams(playable!)).toEqual({
        mode: 'html',
        src: 'https://nova.example.com/stream/1.mp3',
        isLocalFile: false,
        expiresInMs: 120_000,
      });
    } finally {
      providerRegistry.unregister('nova');
    }
  });

  it('marks blob streams from any provider as local, non-expiring files', async () => {
    const track = toTrack(
      makeSong({ id: 'dl-1', provider: 'library', audioUrl: 'blob:http://localhost/xyz' }),
    );
    const playable = await resolvePlayableSource(track);
    expect(playableToEngineParams(playable!)).toEqual({
      mode: 'html',
      src: 'blob:http://localhost/xyz',
      isLocalFile: true,
      expiresInMs: undefined,
    });
  });

  it('maps an unknown provider\'s embedded source to iframe engine params', async () => {
    const embedder: TrackProvider = {
      id: 'nova-embed',
      name: 'NovaEmbed (test fixture)',
      capabilities: { ...NO_CAPS },
      search: async () => [],
      getTrack: async t => t,
      resolveStream: async track => ({
        kind: 'iframe' as const,
        track,
        videoId: 'embed-id-42',
      }),
    };
    providerRegistry.register(embedder);
    try {
      const track: Track = {
        id: 'nve-1',
        provider: 'nova-embed',
        title: 'Embedded',
        artist: 'A',
        album: '',
        genre: '',
        duration: 1,
        artwork: '',
      };
      const playable = await resolvePlayableSource(track);
      expect(playableToEngineParams(playable!)).toEqual({
        mode: 'iframe',
        videoId: 'embed-id-42',
      });
    } finally {
      providerRegistry.unregister('nova-embed');
    }
  });

  it('routes downloads through the unknown provider\'s descriptor hook', async () => {
    const downloader: TrackProvider = {
      id: 'nova-dl',
      name: 'NovaDL (test fixture)',
      capabilities: { ...NO_CAPS, downloads: true },
      search: async () => [],
      getTrack: async t => t,
      resolveStream: async () => null,
      resolveDownload: async () => ({
        url: 'https://nova.example.com/download/1',
        fileName: 'nova-track.mp3',
        headers: { Authorization: 'Bearer fixture' },
      }),
    };
    providerRegistry.register(downloader);
    try {
      const track: Track = {
        id: 'nvd-1',
        provider: 'nova-dl',
        title: 'T',
        artist: 'A',
        album: '',
        genre: '',
        duration: 1,
        artwork: '',
      };
      const descriptor = await resolveDownloadDescriptor(track);
      expect(descriptor).toEqual({
        url: 'https://nova.example.com/download/1',
        fileName: 'nova-track.mp3',
        headers: { Authorization: 'Bearer fixture' },
      });
    } finally {
      providerRegistry.unregister('nova-dl');
    }
  });
});

// ---------------------------------------------------------------------------
// Search facade — aggregation + per-provider error isolation
// ---------------------------------------------------------------------------

describe('searchProviders facade', () => {
  function registerFixture(id: string, impl: TrackProvider['search']): void {
    providerRegistry.register({
      id,
      name: id.toUpperCase(),
      capabilities: { ...NO_CAPS, search: true },
      search: impl,
      getTrack: async t => t,
      resolveStream: async () => null,
    });
  }

  const track = (id: string, provider: string): Track => ({
    id,
    provider,
    title: 'T-' + id,
    artist: 'A',
    album: '',
    genre: '',
    duration: 1,
    artwork: '',
  });

  it('aggregates normalized results from every targeted provider', async () => {
    registerFixture('fan-a', async () => [track('a1', 'fan-a'), track('a2', 'fan-a')]);
    registerFixture('fan-b', async () => [track('b1', 'fan-b')]);
    try {
      const results = await searchProviders('query', { providers: ['fan-a', 'fan-b'] });
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ providerId: 'fan-a', providerName: 'FAN-A' });
      expect(results[0].tracks.map(t => t.id)).toEqual(['a1', 'a2']);
      expect(results[1]).toMatchObject({ providerId: 'fan-b' });
      expect(results[1].tracks.map(t => t.id)).toEqual(['b1']);
      expect(results.every(r => !r.error)).toBe(true);
    } finally {
      providerRegistry.unregister('fan-a');
      providerRegistry.unregister('fan-b');
    }
  });

  it('isolates one provider\'s failure without affecting the others', async () => {
    registerFixture('fan-ok', async () => [track('ok1', 'fan-ok')]);
    registerFixture('fan-broken', async () => {
      throw new Error('provider exploded');
    });
    try {
      const results = await searchProviders('query', { providers: ['fan-ok', 'fan-broken'] });
      const ok = results.find(r => r.providerId === 'fan-ok')!;
      const broken = results.find(r => r.providerId === 'fan-broken')!;
      expect(ok.tracks).toHaveLength(1);
      expect(ok.error).toBeUndefined();
      expect(broken.tracks).toEqual([]);
      expect(broken.error?.message).toBe('provider exploded');
    } finally {
      providerRegistry.unregister('fan-ok');
      providerRegistry.unregister('fan-broken');
    }
  });

  it('skips providers without the search capability', async () => {
    providerRegistry.register({
      id: 'fan-silent',
      name: 'Silent',
      capabilities: { ...NO_CAPS }, // search: false
      search: async () => [track('never', 'fan-silent')],
      getTrack: async t => t,
      resolveStream: async () => null,
    });
    try {
      const results = await searchProviders('query', { providers: ['fan-silent'] });
      expect(results).toEqual([]);
    } finally {
      providerRegistry.unregister('fan-silent');
    }
  });

  it('discovers the built-in searchable providers without naming them in app code', async () => {
    // Registration order: youtube, library, jiosaavn (see providers/index.ts).
    const searchable = providerRegistry.list().filter(p => p.capabilities.search);
    const ids = searchable.map(p => p.id);
    expect(ids).toContain('youtube');
    expect(ids).toContain('library');
  });
});

// ---------------------------------------------------------------------------
// Network warmup through the provider contract (no id branching)
// ---------------------------------------------------------------------------

describe('preconnect contract', () => {
  it('youtubeProvider.preconnect injects CDN preconnect + IFrame API prefetch', () => {
    const before = document.head.querySelectorAll('link').length;
    youtubeProvider.preconnect?.();
    youtubeProvider.preconnect?.(); // idempotent
    const links = Array.from(document.head.querySelectorAll('link')).slice(before);
    // Exactly one batch: 4 preconnects + 1 script preload (second call is a no-op).
    expect(links.filter(l => l.rel === 'preconnect')).toHaveLength(4);
    const scriptPreload = links.find(l => l.rel === 'preload' && l.as === 'script');
    expect(scriptPreload?.getAttribute('href')).toBe('https://www.youtube.com/iframe_api');
  });

  it('generic registry walk warms any provider without knowing its id', () => {
    const warm = vi.fn();
    providerRegistry.register({
      id: 'nova-warm',
      name: 'NovaWarm (test fixture)',
      capabilities: { ...NO_CAPS },
      search: async () => [],
      getTrack: async t => t,
      resolveStream: async () => null,
      preconnect: warm,
    });
    try {
      // The exact pattern used by the preload service: no provider-id branch.
      for (const provider of providerRegistry.list()) {
        provider.preconnect?.();
      }
      expect(warm).toHaveBeenCalledTimes(1);
    } finally {
      providerRegistry.unregister('nova-warm');
    }
  });

  it('preloadNextSongs warms a provider-tagged track with no direct stream', async () => {
    const warm = vi.fn();
    providerRegistry.register({
      id: 'nova-preload',
      name: 'NovaPreload (test fixture)',
      capabilities: { ...NO_CAPS },
      search: async () => [],
      getTrack: async t => t,
      resolveStream: async () => null,
      preconnect: warm,
    });
    try {
      const queue = [
        makeSong({ id: 'np-1', provider: 'nova-preload', audioUrl: '' }),
      ];
      await preloadNextSongs(queue, -1, { count: 1 });
      expect(warm).toHaveBeenCalledTimes(1);
    } finally {
      providerRegistry.unregister('nova-preload');
    }
  });
});
