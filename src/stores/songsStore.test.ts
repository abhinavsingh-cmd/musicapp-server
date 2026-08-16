import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../services/musicApi', () => ({
  fetchSongs: vi.fn(),
}));

vi.mock('../utils/downloadManager', () => ({
  getAllCachedMetadata: vi.fn(),
}));

// The store self-hydrates at import via deferIdle — make that a no-op so the
// tests drive ensureLoaded() deterministically.
vi.mock('../utils/idle', () => ({
  deferIdle: vi.fn(),
}));

import { useSongsStore, LIBRARY_STALE_MS } from './songsStore';
import { fetchSongs } from '../services/musicApi';
import { getAllCachedMetadata } from '../utils/downloadManager';
import type { Song } from '../types/music';

const mockedFetchSongs = fetchSongs as unknown as ReturnType<typeof vi.fn>;
const mockedGetAllCachedMetadata = getAllCachedMetadata as unknown as ReturnType<typeof vi.fn>;

function makeSong(id: string): Song {
  return {
    id,
    title: `Song ${id}`,
    artist: 'Artist',
    album: 'Album',
    duration: 200,
    genre: 'Pop',
    coverArt: '',
    audioUrl: '',
    youtubeId: id,
    releaseYear: 2020,
  };
}

beforeEach(() => {
  localStorage.clear();
  useSongsStore.setState({
    songs: [],
    loading: false,
    error: false,
    fetched: false,
    lastSuccessfulFetch: 0,
  });
  mockedFetchSongs.mockReset();
  mockedGetAllCachedMetadata.mockReset().mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Catalog freshness: the localStorage cache is a performance optimization,
// never a permanent freeze of the server catalog. A stale cache must refetch
// (keeping existing songs visible), and a failed/empty refresh must never
// wipe the songs the user already has.
// ---------------------------------------------------------------------------
describe('songsStore catalog freshness', () => {
  it('keeps a FRESH cache without refetching', async () => {
    const a = makeSong('a');
    useSongsStore.setState({
      songs: [a],
      fetched: true,
      lastSuccessfulFetch: Date.now(),
      loading: false,
      error: false,
    });
    mockedFetchSongs.mockResolvedValue([a, makeSong('b')]);

    await useSongsStore.getState().ensureLoaded();

    expect(mockedFetchSongs).not.toHaveBeenCalled();
    expect(useSongsStore.getState().songs.map((s) => s.id)).toEqual(['a']);
  });

  it('refetches a STALE cache and replaces the catalog', async () => {
    const a = makeSong('a');
    useSongsStore.setState({
      songs: [a],
      fetched: true,
      lastSuccessfulFetch: Date.now() - LIBRARY_STALE_MS - 1000,
      loading: false,
      error: false,
    });
    mockedFetchSongs.mockResolvedValue([a, makeSong('b')]);

    await useSongsStore.getState().ensureLoaded();

    expect(mockedFetchSongs).toHaveBeenCalledTimes(1);
    const s = useSongsStore.getState();
    expect(s.songs.map((x) => x.id)).toEqual(['a', 'b']);
    expect(s.loading).toBe(false);
    expect(s.error).toBe(false);
    expect(s.lastSuccessfulFetch).toBeGreaterThan(Date.now() - 1000);
  });

  it('a stale refresh that returns EMPTY keeps the existing catalog', async () => {
    const a = makeSong('a');
    useSongsStore.setState({
      songs: [a],
      fetched: true,
      lastSuccessfulFetch: Date.now() - LIBRARY_STALE_MS - 1000,
      loading: false,
      error: false,
    });
    mockedFetchSongs.mockResolvedValue([]);

    await useSongsStore.getState().ensureLoaded();

    const s = useSongsStore.getState();
    expect(s.songs.map((x) => x.id)).toEqual(['a']);
    expect(s.loading).toBe(false);
    expect(s.error).toBe(false);
  });

  it('a stale refresh that FAILS keeps the existing catalog and stops loading', async () => {
    const a = makeSong('a');
    useSongsStore.setState({
      songs: [a],
      fetched: true,
      lastSuccessfulFetch: Date.now() - LIBRARY_STALE_MS - 1000,
      loading: false,
      error: false,
    });
    mockedFetchSongs.mockRejectedValue(new Error('server down'));

    await useSongsStore.getState().ensureLoaded();

    const s = useSongsStore.getState();
    expect(s.songs.map((x) => x.id)).toEqual(['a']);
    expect(s.loading).toBe(false);
    expect(s.error).toBe(false);
  });

  it('the first fetch (no cache at all) still populates and clears loading', async () => {
    const a = makeSong('a');
    mockedFetchSongs.mockResolvedValue([a]);

    await useSongsStore.getState().ensureLoaded();

    const s = useSongsStore.getState();
    expect(s.songs.map((x) => x.id)).toEqual(['a']);
    expect(s.loading).toBe(false);
    expect(s.error).toBe(false);
    expect(s.fetched).toBe(true);
  });
});
