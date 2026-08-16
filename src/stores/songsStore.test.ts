import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../services/musicApi', () => ({
  fetchSongs: vi.fn(),
  invalidateSongsCache: vi.fn(),
}));

vi.mock('../utils/downloadManager', () => ({
  getAllCachedMetadata: vi.fn(),
}));

// The store self-hydrates at import via deferIdle — make that a no-op so the
// tests drive ensureLoaded() deterministically.
vi.mock('../utils/idle', () => ({
  deferIdle: vi.fn(),
}));

import { useSongsStore, LIBRARY_STALE_MS, dailyShuffleSongs } from './songsStore';
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
    // The catalog is daily-shuffled — compare as a set, not an exact order.
    expect(s.songs.map((x) => x.id).sort()).toEqual(['a', 'b']);
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

  it('a fresh catalog is served in the daily-shuffled order', async () => {
    const a = makeSong('a');
    const b = makeSong('b');
    mockedFetchSongs.mockResolvedValue([a, b]);

    await useSongsStore.getState().ensureLoaded();

    const s = useSongsStore.getState();
    expect(s.songs.map((x) => x.id).sort()).toEqual(['a', 'b']);
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

// ---------------------------------------------------------------------------
// Daily rotation: deterministic per UTC day, different every day, all songs
// retained. This is what makes the library change day to day entirely from
// the APK — no server deploy required.
// ---------------------------------------------------------------------------
describe('dailyShuffleSongs', () => {
  const songs = Array.from({ length: 20 }, (_, i) => makeSong(String(i)));
  const day1 = new Date(2026, 7, 16, 10, 0, 0).getTime();
  const laterSameDay = new Date(2026, 7, 16, 23, 59, 0).getTime();
  const day2 = new Date(2026, 7, 17, 10, 0, 0).getTime();

  it('is deterministic within the same UTC day', () => {
    const a = dailyShuffleSongs(songs, day1);
    const b = dailyShuffleSongs(songs, laterSameDay);
    expect(a.map((s) => s.id)).toEqual(b.map((s) => s.id));
  });

  it('produces a different order the next day', () => {
    const a = dailyShuffleSongs(songs, day1);
    const c = dailyShuffleSongs(songs, day2);
    expect(a.map((s) => s.id)).not.toEqual(c.map((s) => s.id));
  });

  it('retains every song (no additions, no losses)', () => {
    const a = dailyShuffleSongs(songs, day1);
    expect(a.length).toBe(songs.length);
    expect(new Set(a.map((s) => s.id)).size).toBe(songs.length);
  });

  it('does not mutate the input array', () => {
    const original = songs.map((s) => s.id);
    dailyShuffleSongs(songs, day1);
    expect(songs.map((s) => s.id)).toEqual(original);
  });
});
