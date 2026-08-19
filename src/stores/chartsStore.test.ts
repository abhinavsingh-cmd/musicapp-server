import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useChartsStore } from './chartsStore';
import { TrendingResult } from '../services/trendingService';
import { Song } from '../types/music';

// ---------------------------------------------------------------------------
// Charts reliability: source labeling, loading/error/empty states, cache,
// refresh, duplicate + invalid-song protection, and per-item isolation.
// A failed chart item must never crash (or discard) the entire chart.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getTrending: vi.fn(),
  getState: vi.fn(),
}));

vi.mock('../services/trendingService', () => ({
  trendingService: {
    getTrending: mocks.getTrending,
    getState: mocks.getState,
  },
}));

const makeSong = (over: Partial<Song> = {}): Song => ({
  id: 'trending-abc',
  youtubeId: 'abc',
  title: 'Song A',
  artist: 'Artist A',
  album: '',
  duration: 200,
  genre: 'Trending',
  coverArt: 'https://img/a.jpg',
  audioUrl: '',
  releaseYear: 0,
  isFavorite: false,
  playCount: 0,
  ...over,
});

const makeResult = (over: Partial<TrendingResult> = {}): TrendingResult => ({
  songs: [
    makeSong(),
    makeSong({ id: 'trending-def', youtubeId: 'def', title: 'Song B', artist: 'Artist B' }),
    makeSong({ id: 'trending-hin', youtubeId: 'hin', title: 'Song C', artist: 'Arijit Singh' }),
  ],
  source: 'LIVE',
  origin: 'youtube_music',
  lastUpdated: Date.now(),
  ...over,
});

function resetStore(): void {
  useChartsStore.setState({
    topCharts: [],
    globalCharts: [],
    bollywoodCharts: [],
    loading: false,
    refreshing: false,
    error: null,
    lastUpdated: null,
    source: 'none',
    origin: null,
  });
}

beforeEach(() => {
  resetStore();
  mocks.getTrending.mockReset();
  mocks.getState.mockReset();
  mocks.getState.mockReturnValue({ songs: [], source: 'BUILT_IN', lastUpdated: Date.now() });
});

describe('chartsStore — source identification', () => {
  it('labels a live result as LIVE with its upstream origin', async () => {
    mocks.getTrending.mockResolvedValue(makeResult());

    await useChartsStore.getState().fetchCharts();

    const s = useChartsStore.getState();
    expect(s.source).toBe('LIVE');
    expect(s.origin).toBe('youtube_music');
    expect(s.lastUpdated).not.toBeNull();
  });

  it('never relabels fallback data as LIVE', async () => {
    mocks.getTrending.mockResolvedValue(makeResult({ source: 'BUILT_IN', origin: undefined }));

    await useChartsStore.getState().fetchCharts();

    const s = useChartsStore.getState();
    expect(s.source).toBe('BUILT_IN');
    expect(s.origin).toBeNull();
  });

  it('hydrates from the trending cache with its honest source label', () => {
    mocks.getState.mockReturnValue(makeResult({ source: 'CACHED', origin: 'charts' }));

    useChartsStore.getState().hydrateFromCache();

    const s = useChartsStore.getState();
    expect(s.topCharts.length).toBe(3);
    expect(s.source).toBe('CACHED');
    expect(s.origin).toBe('charts');
    expect(mocks.getTrending).not.toHaveBeenCalled();
  });

  it('hydrate ignores an empty cache', () => {
    mocks.getState.mockReturnValue({ songs: [], source: 'BUILT_IN', lastUpdated: Date.now() });

    useChartsStore.getState().hydrateFromCache();

    expect(useChartsStore.getState().topCharts).toEqual([]);
  });
});

describe('chartsStore — loading / error / empty states', () => {
  it('sets loading on initial fetch and clears it on success', async () => {
    let resolveFn!: (v: TrendingResult) => void;
    mocks.getTrending.mockReturnValue(new Promise<TrendingResult>((r) => { resolveFn = r; }));

    const pending = useChartsStore.getState().fetchCharts();
    expect(useChartsStore.getState().loading).toBe(true);

    resolveFn(makeResult());
    await pending;

    const s = useChartsStore.getState();
    expect(s.loading).toBe(false);
    expect(s.refreshing).toBe(false);
    expect(s.error).toBeNull();
  });

  it('uses refreshing (not loading) when data is already visible', async () => {
    mocks.getTrending.mockResolvedValue(makeResult());
    await useChartsStore.getState().fetchCharts();

    let resolveFn!: (v: TrendingResult) => void;
    mocks.getTrending.mockReturnValue(new Promise<TrendingResult>((r) => { resolveFn = r; }));

    const pending = useChartsStore.getState().fetchCharts({ force: true });
    const s = useChartsStore.getState();
    expect(s.loading).toBe(false);
    expect(s.refreshing).toBe(true);

    resolveFn(makeResult());
    await pending;
    expect(useChartsStore.getState().refreshing).toBe(false);
  });

  it('keeps previous data visible and sets error when the fetch throws', async () => {
    mocks.getTrending.mockResolvedValueOnce(makeResult());
    await useChartsStore.getState().fetchCharts();
    const before = useChartsStore.getState().topCharts;
    expect(before.length).toBeGreaterThan(0);

    mocks.getTrending.mockRejectedValueOnce(new Error('Network down'));
    await useChartsStore.getState().fetchCharts({ force: true });

    const s = useChartsStore.getState();
    expect(s.error).toBe('Network down');
    expect(s.topCharts).toEqual(before);
    expect(s.loading).toBe(false);
    expect(s.refreshing).toBe(false);
  });

  it('empty responses never wipe visible charts', async () => {
    mocks.getTrending.mockResolvedValueOnce(makeResult());
    await useChartsStore.getState().fetchCharts();
    const before = useChartsStore.getState().topCharts;

    mocks.getTrending.mockResolvedValueOnce({ songs: [], source: 'LIVE', lastUpdated: Date.now() });
    await useChartsStore.getState().fetchCharts({ force: true });

    const s = useChartsStore.getState();
    expect(s.topCharts).toEqual(before);
    expect(s.error).toMatch(/previous data/i);
  });

  it('reports an empty state when there is no data at all', async () => {
    mocks.getTrending.mockResolvedValue({ songs: [], source: 'LIVE', lastUpdated: Date.now() });

    await useChartsStore.getState().fetchCharts();

    const s = useChartsStore.getState();
    expect(s.topCharts).toEqual([]);
    expect(s.loading).toBe(false);
    expect(s.error).toMatch(/no chart data/i);
  });
});

describe('chartsStore — cache and refresh', () => {
  it('skips auto-refetch inside the fresh window for live-sourced data', async () => {
    mocks.getTrending.mockResolvedValue(makeResult());
    await useChartsStore.getState().fetchCharts();
    expect(mocks.getTrending).toHaveBeenCalledTimes(1);

    await useChartsStore.getState().fetchCharts();
    expect(mocks.getTrending).toHaveBeenCalledTimes(1); // cache hit, no refetch
  });

  it('force:true always refetches (manual refresh works inside the fresh window)', async () => {
    mocks.getTrending.mockResolvedValue(makeResult());
    await useChartsStore.getState().fetchCharts();

    await useChartsStore.getState().fetchCharts({ force: true });
    expect(mocks.getTrending).toHaveBeenCalledTimes(2);
  });

  it('fallback-sourced data never blocks recovery back to live', async () => {
    mocks.getTrending.mockResolvedValue(makeResult({ source: 'BUILT_IN', origin: undefined }));
    await useChartsStore.getState().fetchCharts();
    expect(useChartsStore.getState().source).toBe('BUILT_IN');

    // Within the fresh window, but fallback-sourced → must refetch.
    await useChartsStore.getState().fetchCharts();
    expect(mocks.getTrending).toHaveBeenCalledTimes(2);
  });
});

describe('chartsStore — duplicate protection', () => {
  it('concurrent fetchCharts calls share a single in-flight request', async () => {
    let resolveFn!: (v: TrendingResult) => void;
    mocks.getTrending.mockReturnValue(new Promise<TrendingResult>((r) => { resolveFn = r; }));

    const p1 = useChartsStore.getState().fetchCharts();
    const p2 = useChartsStore.getState().fetchCharts();
    expect(mocks.getTrending).toHaveBeenCalledTimes(1); // second caller joined p1

    resolveFn(makeResult());
    await Promise.all([p1, p2]);

    expect(mocks.getTrending).toHaveBeenCalledTimes(1);
    expect(useChartsStore.getState().topCharts.length).toBe(3);
  });

  it('duplicate songs are deduplicated with contiguous ranks', async () => {
    mocks.getTrending.mockResolvedValue(makeResult({
      songs: [
        makeSong({ id: 'trending-abc', youtubeId: 'abc' }),
        makeSong({ id: 'trending-abc-2', youtubeId: 'abc', title: 'Song A (dupe)' }),
        makeSong({ id: 'trending-def', youtubeId: 'def', title: 'Song B', artist: 'Artist B' }),
      ],
    }));

    await useChartsStore.getState().fetchCharts();

    const top = useChartsStore.getState().topCharts;
    expect(top.map(c => c.youtubeId)).toEqual(['abc', 'def']);
    expect(top.map(c => c.rank)).toEqual([1, 2]);
  });
});

describe('chartsStore — invalid-song protection and per-item isolation', () => {
  it('filters out songs with missing id or title, keeping the rest', async () => {
    mocks.getTrending.mockResolvedValue(makeResult({
      songs: [
        makeSong({ id: 'trending-abc', youtubeId: 'abc', title: 'Good Song' }),
        makeSong({ id: '', title: 'No Id' }),
        makeSong({ id: 'trending-notitle', youtubeId: 'x', title: '' }),
        makeSong({ id: 'trending-def', youtubeId: 'def', title: 'Also Good', artist: 'Artist B' }),
      ],
    }));

    await useChartsStore.getState().fetchCharts();

    const top = useChartsStore.getState().topCharts;
    expect(top.map(c => c.title)).toEqual(['Good Song', 'Also Good']);
    expect(top.map(c => c.rank)).toEqual([1, 2]);
  });

  it('a single failed/malformed item never crashes or discards the chart', async () => {
    const throwing = {} as Song;
    Object.defineProperty(throwing, 'id', { get() { throw new Error('boom'); } });

    mocks.getTrending.mockResolvedValue(makeResult({
      songs: [
        makeSong({ id: 'trending-abc', youtubeId: 'abc' }),
        null as unknown as Song,
        throwing,
        makeSong({ id: 'trending-def', youtubeId: 'def', title: 'Song B', artist: 'Artist B' }),
      ],
    }));

    await useChartsStore.getState().fetchCharts();

    const s = useChartsStore.getState();
    expect(s.error).toBeNull();
    expect(s.topCharts.map(c => c.youtubeId)).toEqual(['abc', 'def']);
  });

  it('splits bollywood/global tabs without dropping items', async () => {
    mocks.getTrending.mockResolvedValue(makeResult());

    await useChartsStore.getState().fetchCharts();

    const s = useChartsStore.getState();
    expect(s.bollywoodCharts.map(c => c.artist)).toEqual(['Arijit Singh']);
    expect(s.globalCharts.map(c => c.artist)).toEqual(['Artist A', 'Artist B']);
  });
});
