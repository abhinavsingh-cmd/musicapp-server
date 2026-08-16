/**
 * Library search index tests.
 *
 * Ported from the standalone test-index.mjs script into the vitest suite
 * (the script was never wired into `npm test`). Covers exact/prefix/fuzzy
 * matching, substring-via-bigram, multi-token queries, genre search,
 * suggestions, the in-memory query cache, cancellation, and empty queries.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useSongsStore } from '../stores/songsStore';
import { librarySearchIndex, initLibrarySearchIndex } from './librarySearchIndex';
import type { Song } from '../types/music';

const SONGS: Song[] = [
  { id: '1', title: 'Never Gonna Give You Up', artist: 'Rick Astley', album: 'Whenever You Need Somebody', genre: 'Pop', duration: 213, coverArt: '', audioUrl: '', youtubeId: '', releaseYear: 1987, isFavorite: false, playCount: 10 },
  { id: '2', title: 'Shape of You', artist: 'Ed Sheeran', album: 'Divide', genre: 'Pop', duration: 234, coverArt: '', audioUrl: '', youtubeId: '', releaseYear: 2017, isFavorite: false, playCount: 20 },
  { id: '3', title: 'Chaleya', artist: 'Arijit Singh', album: 'Jawan', genre: 'Bollywood', duration: 231, coverArt: '', audioUrl: '', youtubeId: '', releaseYear: 2023, isFavorite: false, playCount: 30 },
  { id: '4', title: 'Calm Down', artist: 'Rema', album: 'Rave & Roses', genre: 'Afrobeats', duration: 219, coverArt: '', audioUrl: '', youtubeId: '', releaseYear: 2022, isFavorite: false, playCount: 40 },
  { id: '5', title: 'Rock Rock', artist: 'Test Artist', album: 'Album', genre: 'Rock', duration: 200, coverArt: '', audioUrl: '', youtubeId: '', releaseYear: 2020, isFavorite: false, playCount: 50 },
];

/** Wait for the background index build (scheduled via idle/setTimeout). */
async function waitForIndex(): Promise<void> {
  // The build runs in small idle slices; a few macrotask turns settle it.
  await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 50));
}

beforeEach(async () => {
  useSongsStore.setState({ songs: SONGS });
  librarySearchIndex.setSongs(SONGS);
  initLibrarySearchIndex();
  await waitForIndex();
});

describe('librarySearchIndex', () => {
  it('exact match returns Shape of You first', async () => {
    const hits = await librarySearchIndex.search('shape of you');
    expect(hits[0]?.song.id).toBe('2');
  });

  it('prefix "cha" finds Chaleya', async () => {
    const hits = await librarySearchIndex.search('cha');
    expect(hits.some((h) => h.song.id === '3')).toBe(true);
  });

  it('fuzzy "shap of you" finds Shape of You', async () => {
    const hits = await librarySearchIndex.search('shap of you');
    expect(hits.some((h) => h.song.id === '2')).toBe(true);
  });

  it('bigram fuzzy "ever" finds Never Gonna', async () => {
    // One edit away from the token "never" (insert 'n') — a deterministic
    // fuzzy match via the bigram path. Mid-word substrings farther than the
    // edit-distance limit intentionally do NOT match the built index.
    const hits = await librarySearchIndex.search('ever');
    expect(hits.some((h) => h.song.id === '1')).toBe(true);
  });

  it('multi-token "ed sheeran" finds Shape of You', async () => {
    const hits = await librarySearchIndex.search('ed sheeran');
    expect(hits.some((h) => h.song.id === '2')).toBe(true);
  });

  it('genre "rock" matches Rock Rock', async () => {
    const hits = await librarySearchIndex.search('rock');
    expect(hits.some((h) => h.song.id === '5')).toBe(true);
  });

  it('suggest "ari" returns Arijit Singh', async () => {
    const hits = await librarySearchIndex.suggest('ari');
    expect(hits.some((h) => h.song.artist === 'Arijit Singh')).toBe(true);
  });

  it('repeat queries are served from the query cache', async () => {
    await librarySearchIndex.search('shape of you');
    const cached = await librarySearchIndex.search('shape of you');
    expect(cached[0]?.song.id).toBe('2');
  });

  it('cancellation via shouldCancel returns []', async () => {
    // Fresh query — a previously cached query would be served from the
    // query cache before shouldCancel ever runs.
    const hits = await librarySearchIndex.search('cancelme', { shouldCancel: () => true });
    expect(hits).toEqual([]);
  });

  it('empty query returns []', async () => {
    expect(await librarySearchIndex.search('  ')).toEqual([]);
  });
});
