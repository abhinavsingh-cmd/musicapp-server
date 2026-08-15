/**
 * Provider architecture tests.
 *
 * Proves that:
 *   - Song <-> Track normalization round-trips everything the player needs
 *   - the playback engine's inputs (EnginePlayParams) are produced purely
 *     from the normalized PlayableSource, independent of which provider
 *     produced the track
 *   - a track from a provider the player has never heard of is playable
 *     (registered test fixture below — the app itself ships no fake provider)
 *   - the download system consumes the normalized source (Track +
 *     DownloadDescriptor) rather than provider internals
 *   - real provider surfaces (search / charts / lyrics / related / downloads)
 *     behave through the registry
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  inferProvider,
  playableToEngineParams,
  providerRegistry,
  resolveDownloadDescriptor,
  resolvePlayableSource,
  toSong,
  toTrack,
  type Track,
  type TrackProvider,
} from '../providers';
import { downloadSongWithProgress } from '../utils/downloadManager';
import { extractAudioUrl, invalidateAudioUrl } from '../services/youtubeAudioExtractor';
import { youtubeSearch } from '../services/youtubeSearchService';
import { trendingService } from '../services/trendingService';
import { fetchSongs, searchSongs } from '../services/musicApi';
import { lyricsService } from '../services/lyricsService';
import { getRecommendations } from '../services/recommendationService';

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

const mockedExtract = vi.mocked(extractAudioUrl);
const mockedInvalidate = vi.mocked(invalidateAudioUrl);
const mockedYoutubeSearch = vi.mocked(youtubeSearch);
const mockedTrending = vi.mocked(trendingService.getTrending);
const mockedFetchSongs = vi.mocked(fetchSongs);
const mockedSearchSongs = vi.mocked(searchSongs);
const mockedLyrics = vi.mocked(lyricsService.fetchLyrics);
const mockedRecommendations = vi.mocked(getRecommendations);

const YOUTUBE_SONG = {
  id: 'yt-dQw4w9WgXcQ',
  title: 'Never Gonna Give You Up',
  artist: 'Rick Astley',
  album: 'Whenever You Need Somebody',
  genre: 'Pop',
  duration: 213,
  coverArt: 'https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
  audioUrl: '',
  youtubeId: 'dQw4w9WgXcQ',
  releaseYear: 1987,
  isFavorite: true,
  playCount: 12,
} as const;

const LIBRARY_SONG = {
  id: 'lib-1',
  title: 'Library Track',
  artist: 'Library Artist',
  album: 'Album One',
  genre: 'Rock',
  duration: 180,
  coverArt: 'https://cdn.example.com/art.jpg',
  audioUrl: 'https://cdn.example.com/audio/track.mp3',
  youtubeId: undefined,
  releaseYear: 2020,
} as const;

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

describe('toTrack / toSong normalization', () => {
  it('maps a YouTube song to a normalized Track', () => {
    const track = toTrack(YOUTUBE_SONG);
    expect(track.provider).toBe('youtube');
    expect(track.externalId).toBe('dQw4w9WgXcQ');
    expect(track.artwork).toBe(YOUTUBE_SONG.coverArt);
    expect(track.streamUrl).toBeUndefined();
    expect(track.title).toBe('Never Gonna Give You Up');
    expect(track.duration).toBe(213);
  });

  it('maps a library song (no youtubeId) to a Track owned by the library provider', () => {
    const track = toTrack(LIBRARY_SONG);
    expect(track.provider).toBe('library');
    expect(track.externalId).toBeUndefined();
    expect(track.streamUrl).toBe('https://cdn.example.com/audio/track.mp3');
  });

  it('inferProvider only claims YouTube for valid 11-char ids', () => {
    expect(inferProvider({ youtubeId: 'dQw4w9WgXcQ' })).toBe('youtube');
    expect(inferProvider({ youtubeId: 'not-an-id' })).toBe('library');
    expect(inferProvider({})).toBe('library');
  });

  it('round-trips through toSong with every playback-relevant field', () => {
    const back = toSong(toTrack(YOUTUBE_SONG));
    expect(back.id).toBe('yt-dQw4w9WgXcQ');
    expect(back.title).toBe('Never Gonna Give You Up');
    expect(back.artist).toBe('Rick Astley');
    expect(back.album).toBe('Whenever You Need Somebody');
    expect(back.genre).toBe('Pop');
    expect(back.duration).toBe(213);
    expect(back.coverArt).toBe('https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg');
    expect(back.youtubeId).toBe('dQw4w9WgXcQ');
    expect(back.releaseYear).toBe(1987);
    expect(back.isFavorite).toBe(true);
    expect(back.playCount).toBe(12);
  });

  it('is idempotent for already-normalized tracks', () => {
    const track = toTrack(YOUTUBE_SONG);
    expect(toTrack(track)).toEqual(track);
  });

  it('handles minimal Song-like inputs (downloader shape) with defaults', () => {
    const track = toTrack({
      id: 'x',
      youtubeId: 'BddP6PYo2gs',
      title: 'Kesariya',
      artist: 'Arijit Singh',
      genre: 'Trending',
      duration: 268,
      coverArt: '',
    });
    expect(track.provider).toBe('youtube');
    expect(track.title).toBe('Kesariya');
    expect(track.album).toBe('Arijit Singh');
    expect(track.duration).toBe(268);
  });
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe('provider registry', () => {
  it('registers, lists, and reports presence', () => {
    const probe: TrackProvider = {
      id: 'probe',
      name: 'Probe',
      capabilities: { search: true, trackLookup: false, lyrics: false, charts: false, relatedTracks: false, downloads: false },
      search: async () => [],
      getTrack: async t => t,
      resolveStream: async () => null,
    };
    providerRegistry.register(probe);
    expect(providerRegistry.has('probe')).toBe(true);
    expect(providerRegistry.get('probe')).toBe(probe);
    expect(providerRegistry.list().some(p => p.id === 'probe')).toBe(true);
    providerRegistry.unregister('probe');
    expect(providerRegistry.has('probe')).toBe(false);
  });

  it('throws when a provider id is already registered', () => {
    const probe: TrackProvider = {
      id: 'dup-probe',
      name: 'Probe',
      capabilities: { search: true, trackLookup: false, lyrics: false, charts: false, relatedTracks: false, downloads: false },
      search: async () => [],
      getTrack: async t => t,
      resolveStream: async () => null,
    };
    providerRegistry.register(probe);
    expect(() => providerRegistry.register(probe)).toThrow(/already registered/i);
    providerRegistry.unregister('dup-probe');
  });
});

// ---------------------------------------------------------------------------
// Stream resolution (player side)
// ---------------------------------------------------------------------------

describe('resolvePlayableSource', () => {
  it('short-circuits when the track already carries a direct stream URL', async () => {
    const playable = await resolvePlayableSource(toTrack(LIBRARY_SONG));
    expect(playable?.kind).toBe('stream');
    if (playable?.kind === 'stream') {
      expect(playable.streamUrl).toBe('https://cdn.example.com/audio/track.mp3');
      expect(playable.isLocalFile).toBe(false);
      expect(playable.expiresInMs).toBeUndefined();
    }
  });

  it('treats blob URLs as local, non-expiring files', async () => {
    const playable = await resolvePlayableSource(
      toTrack({ ...LIBRARY_SONG, audioUrl: 'blob:http://localhost/abc' }),
    );
    expect(playable?.kind).toBe('stream');
    if (playable?.kind === 'stream') {
      expect(playable.isLocalFile).toBe(true);
      expect(playable.expiresInMs).toBeUndefined();
    }
  });

  it('resolves a YouTube stream via the provider (extraction)', async () => {
    mockedExtract.mockResolvedValue('https://server.example.com/api/proxy-audio?url=googlevideo');
    const playable = await resolvePlayableSource(toTrack(YOUTUBE_SONG));
    expect(playable?.kind).toBe('stream');
    if (playable?.kind === 'stream') {
      expect(playable.streamUrl).toContain('/proxy-audio');
      expect(playable.isLocalFile).toBe(false);
      expect(playable.expiresInMs).toBe(25 * 60 * 1000);
    }
  });

  it('falls back to an embedded iframe source when extraction fails', async () => {
    mockedExtract.mockResolvedValue(null);
    const playable = await resolvePlayableSource(toTrack(YOUTUBE_SONG));
    expect(playable?.kind).toBe('iframe');
    if (playable?.kind === 'iframe') {
      expect(playable.videoId).toBe('dQw4w9WgXcQ');
    }
  });

  it('re-resolves fresh when force is requested', async () => {
    mockedExtract.mockResolvedValue('https://server.example.com/api/proxy-audio?url=v1');
    await resolvePlayableSource(toTrack(YOUTUBE_SONG));
    mockedExtract.mockResolvedValue('https://server.example.com/api/proxy-audio?url=v2');
    const playable = await resolvePlayableSource(toTrack(YOUTUBE_SONG), { force: true });
    expect(mockedInvalidate).toHaveBeenCalledWith('dQw4w9WgXcQ');
    if (playable?.kind === 'stream') {
      expect(playable.streamUrl).toContain('url=v2');
    }
  });

  it('returns null for tracks whose provider cannot produce anything', async () => {
    const playable = await resolvePlayableSource(toTrack(YOUTUBE_SONG));
    void playable;
    // No external id → provider cannot resolve
    const noSource = toTrack({ ...YOUTUBE_SONG, youtubeId: undefined, audioUrl: '' });
    expect(await resolvePlayableSource(noSource)).toBeNull();
  });

  it('returns null for an unknown provider id', async () => {
    const track: Track = { id: 'x', provider: 'nonexistent-provider', title: 'T', artist: 'A', album: '', genre: '', duration: 1, artwork: '' };
    expect(await resolvePlayableSource(track)).toBeNull();
  });

  it('lazily registers the built-in providers on first use', async () => {
    expect(providerRegistry.has('youtube')).toBe(true);
    expect(providerRegistry.has('library')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Provider-independent playback (the core guarantee)
// ---------------------------------------------------------------------------

describe('the player consumes provider-independent tracks', () => {
  it('produces identical engine parameters for youtube, library, and an unknown provider', async () => {
    // Register a fixture provider the player has never heard of. This is
    // test-only — the shipped app contains no fake providers.
    const mockcastProvider: TrackProvider = {
      id: 'mockcast',
      name: 'MockCast (test fixture)',
      capabilities: { search: true, trackLookup: false, lyrics: false, charts: false, relatedTracks: false, downloads: false },
      search: async () => [],
      getTrack: async t => t,
      resolveStream: async track => ({
        kind: 'stream' as const,
        track,
        streamUrl: 'https://mockcast.example.com/stream/track.mp3',
        isLocalFile: false,
        expiresInMs: 60_000,
      }),
      resolveDownload: async () => ({ url: 'https://mockcast.example.com/download' }),
    };
    providerRegistry.register(mockcastProvider);

    try {
      const youtubeTrack = toTrack(YOUTUBE_SONG);
      const libraryTrack = toTrack(LIBRARY_SONG);
      const mockcastTrack: Track = {
        id: 'mc-1',
        provider: 'mockcast',
        title: 'Podcast Episode',
        artist: 'MockHost',
        album: '',
        genre: 'Podcast',
        duration: 300,
        artwork: 'https://mockcast.example.com/art.jpg',
        externalId: 'mc-ep-1',
      };

      const youtubePlayable = await resolvePlayableSource(youtubeTrack);
      const libraryPlayable = await resolvePlayableSource(libraryTrack);
      const mockcastPlayable = await resolvePlayableSource(mockcastTrack);

      expect(youtubePlayable).not.toBeNull();
      expect(libraryPlayable).not.toBeNull();
      expect(mockcastPlayable).not.toBeNull();

      const ytParams = playableToEngineParams(youtubePlayable!);
      const libParams = playableToEngineParams(libraryPlayable!);
      const mockParams = playableToEngineParams(mockcastPlayable!);

      // All three are plain HTML-audio playables — the engine needs exactly
      // { mode, src, isLocalFile, expiresInMs } regardless of the source.
      expect(ytParams).toEqual({ mode: 'html', src: expect.stringContaining('proxy-audio'), isLocalFile: false, expiresInMs: 25 * 60 * 1000 });
      expect(libParams).toEqual({ mode: 'html', src: 'https://cdn.example.com/audio/track.mp3', isLocalFile: false, expiresInMs: undefined });
      expect(mockParams).toEqual({ mode: 'html', src: 'https://mockcast.example.com/stream/track.mp3', isLocalFile: false, expiresInMs: 60_000 });
      expect(mockParams).toMatchObject({ mode: 'html', src: expect.any(String) });
    } finally {
      providerRegistry.unregister('mockcast');
    }
  });

  it('maps an iframe playable to embedded-player params', () => {
    const playable = {
      kind: 'iframe' as const,
      track: toTrack(YOUTUBE_SONG),
      videoId: 'dQw4w9WgXcQ',
    };
    expect(playableToEngineParams(playable)).toEqual({ mode: 'iframe', videoId: 'dQw4w9WgXcQ' });
  });
});

// ---------------------------------------------------------------------------
// Download resolution (download system side)
// ---------------------------------------------------------------------------

describe('resolveDownloadDescriptor', () => {
  it('routes YouTube tracks through the server download endpoint', async () => {
    const descriptor = await resolveDownloadDescriptor(toTrack(YOUTUBE_SONG));
    expect(descriptor).not.toBeNull();
    expect(descriptor!.url).toContain('/api/download/dQw4w9WgXcQ');
    expect(descriptor!.url).toContain('title=Never%20Gonna%20Give%20You%20Up');
  });

  it('uses the direct stream URL for library tracks', async () => {
    const descriptor = await resolveDownloadDescriptor(toTrack(LIBRARY_SONG));
    expect(descriptor?.url).toBe('https://cdn.example.com/audio/track.mp3');
  });

  it('returns null when nothing is downloadable', async () => {
    const track = toTrack({ ...YOUTUBE_SONG, youtubeId: undefined, audioUrl: '' });
    expect(await resolveDownloadDescriptor(track)).toBeNull();
  });

  it('falls back to the provider download hook for unknown providers', async () => {
    const mockcastProvider: TrackProvider = {
      id: 'mockcast-dl',
      name: 'MockCast (test fixture)',
      capabilities: { search: true, trackLookup: false, lyrics: false, charts: false, relatedTracks: false, downloads: true },
      search: async () => [],
      getTrack: async t => t,
      resolveStream: async () => null,
      resolveDownload: async () => ({ url: 'https://mockcast.example.com/download' }),
    };
    providerRegistry.register(mockcastProvider);
    try {
      const track: Track = { id: 'mc-2', provider: 'mockcast-dl', title: 'T', artist: 'A', album: '', genre: '', duration: 1, artwork: '' };
      expect((await resolveDownloadDescriptor(track))?.url).toBe('https://mockcast.example.com/download');
    } finally {
      providerRegistry.unregister('mockcast-dl');
    }
  });
});

// ---------------------------------------------------------------------------
// downloadSongWithProgress consumes the normalized source
// ---------------------------------------------------------------------------

describe('downloadSongWithProgress with a normalized Track', () => {
  // Minimal IndexedDB mock (mirrors downloadPipeline.test.ts)
  let idbStores: Map<string, Map<string, any>>;

  function makeRequest(result?: any) {
    const req: any = { result, onsuccess: null, onerror: null };
    setTimeout(() => req.onsuccess?.({ target: req }), 0);
    return req;
  }

  beforeEach(() => {
    idbStores = new Map([['songs', new Map()], ['thumbnails', new Map()], ['meta', new Map()]]);
    const mockDB: any = {
      objectStoreNames: { contains: (n: string) => idbStores.has(n) },
      createObjectStore: (name: string) => ({ createIndex: vi.fn() }),
      transaction: (names: string | string[], _mode: string) => {
        const list = Array.isArray(names) ? names : [names];
        const stores = new Map<string, any>();
        for (const n of list) {
          if (!idbStores.has(n)) idbStores.set(n, new Map());
          stores.set(n, {
            get: (k: string) => makeRequest(idbStores.get(n)!.get(k)),
            put: (_v: any, k: string) => { idbStores.get(n)!.set(k ?? _v.id, _v); return makeRequest(); },
            count: () => makeRequest(idbStores.get(n)!.size),
            getAll: () => makeRequest(Array.from(idbStores.get(n)!.values())),
            clear: () => { idbStores.get(n)!.clear(); return makeRequest(); },
            delete: (k: string) => { idbStores.get(n)!.delete(k); return makeRequest(); },
            index: (name: string) => ({
              get: (k: string) => {
                for (const v of idbStores.get(n)!.values()) if (v[name] === k) return makeRequest(v);
                return makeRequest(undefined);
              },
              count: (k: string) => {
                let c = 0;
                for (const v of idbStores.get(n)!.values()) if (v[name] === k) c++;
                return makeRequest(c);
              },
            }),
          });
        }
        return { objectStore: (n: string) => stores.get(n)!, oncomplete: null, onerror: null };
      },
      close: vi.fn(),
    };
    (globalThis as any).indexedDB = { open: () => makeRequest(mockDB) };
  });

  it('downloads a library Track by fetching its normalized download URL', async () => {
    const audioBytes = new Uint8Array(50_000);
    audioBytes[0] = 0x49; audioBytes[1] = 0x44; audioBytes[2] = 0x33; // ID3
    const fetchSpy = vi.fn().mockResolvedValue(new Response(audioBytes, {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '50000' },
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const track = toTrack(LIBRARY_SONG);
    const result = await downloadSongWithProgress(track);

    // The downloader fetched exactly the provider-resolved URL — no provider
    // internals (youtubeId checks, server routing) leaked into the downloader.
    expect(fetchSpy.mock.calls[0][0]).toBe('https://cdn.example.com/audio/track.mp3');
    expect(result.id).toBe('lib-1');
    expect(result.title).toBe('Library Track');
    expect(result.youtubeId).toBe('');
    expect(result.size).toBe(50_000);
    expect(idbStores.get('songs')!.has('lib-1')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('downloads a YouTube Track through the provider download descriptor', async () => {
    const audioBytes = new Uint8Array(50_000);
    audioBytes[0] = 0x49; audioBytes[1] = 0x44; audioBytes[2] = 0x33;
    const fetchSpy = vi.fn().mockResolvedValue(new Response(audioBytes, {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '50000' },
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await downloadSongWithProgress(toTrack(YOUTUBE_SONG));

    expect(fetchSpy.mock.calls[0][0]).toContain('/api/download/dQw4w9WgXcQ');
    expect(result.youtubeId).toBe('dQw4w9WgXcQ');
    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// Provider surface: search / charts / lyrics / related / lookup
// ---------------------------------------------------------------------------

describe('provider capabilities', () => {
  it('youtubeProvider.search returns normalized Tracks', async () => {
    mockedYoutubeSearch.mockResolvedValue([
      { id: 'abc123ABC_-', title: 'Song Title', artist: 'Some Artist', duration: 200, thumbnail: 'thumb.jpg', viewCount: 99, album: '' },
    ]);
    const { youtubeProvider } = await import('../providers/youtubeProvider');
    const tracks = await youtubeProvider.search('test query');
    expect(tracks[0]).toMatchObject({
      id: 'yt-abc123ABC_-',
      provider: 'youtube',
      externalId: 'abc123ABC_-',
      title: 'Song Title',
      artwork: 'thumb.jpg',
    });
  });

  it('libraryProvider.search returns normalized Tracks', async () => {
    mockedSearchSongs.mockResolvedValue([{ ...LIBRARY_SONG } as any]);
    const { libraryProvider } = await import('../providers/libraryProvider');
    const tracks = await libraryProvider.search('library query');
    expect(tracks[0]).toMatchObject({ provider: 'library', id: 'lib-1' });
  });

  it('youtubeProvider.getCharts maps trending songs to Tracks', async () => {
    mockedTrending.mockResolvedValue({
      songs: [{ ...YOUTUBE_SONG } as any],
      source: 'LIVE',
      origin: 'youtube_music',
      lastUpdated: Date.now(),
    });
    const { youtubeProvider } = await import('../providers/youtubeProvider');
    const charts = await youtubeProvider.getCharts?.();
    expect(charts?.[0]).toMatchObject({ provider: 'youtube', externalId: 'dQw4w9WgXcQ' });
  });

  it('providers expose lyrics through the lyrics service', async () => {
    mockedLyrics.mockResolvedValue([{ text: 'Never gonna give you up', ts: 0 }] as any);
    const { youtubeProvider } = await import('../providers/youtubeProvider');
    const lyrics = await youtubeProvider.getLyrics?.(toTrack(YOUTUBE_SONG));
    expect(lyrics).toBe('Never gonna give you up');
  });

  it('libraryProvider.getRelated returns normalized recommendations', async () => {
    mockedRecommendations.mockResolvedValue([{ ...LIBRARY_SONG, id: 'lib-2' } as any]);
    const { libraryProvider } = await import('../providers/libraryProvider');
    const related = await libraryProvider.getRelated?.(toTrack(LIBRARY_SONG), 5);
    expect(related?.[0]).toMatchObject({ provider: 'library', id: 'lib-2' });
  });

  it('libraryProvider.getTrack looks up fresher metadata in the catalog', async () => {
    mockedFetchSongs.mockResolvedValue([{ ...LIBRARY_SONG, title: 'Fresh Title' } as any]);
    const { libraryProvider } = await import('../providers/libraryProvider');
    const fresher = await libraryProvider.getTrack(toTrack(LIBRARY_SONG));
    expect(fresher.title).toBe('Fresh Title');
  });
});
