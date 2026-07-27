import { create } from 'zustand';
import { Song } from '../types/music';
import { OfflineError, NetworkError, TimeoutError } from '../config/api';
import { youtubeSearch } from '../services/youtubeSearchService';
import { useSongsStore } from './songsStore';
import { metricsCollector } from '../services/metricsCollector';

// ---- Types ----

export type FilterType = 'all' | 'songs' | 'artists' | 'albums' | 'playlists' | 'genres';
export type SortMode = 'relevance' | 'newest' | 'popular' | 'alpha';
export type DurationFilter = 'any' | 'short' | 'medium' | 'long';

export type SearchStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error' | 'offline' | 'cancelled';

interface SearchState {
  query: string;
  debouncedQuery: string;
  filter: FilterType;
  sort: SortMode;
  durationFilter: DurationFilter;
  genreFilter: string;

  libraryResults: Song[];
  ytResults: YTSong[];

  suggestions: Song[];
  status: SearchStatus;
  ytStatus: SearchStatus;
  page: number;
  hasMore: boolean;
  error: string | null;
  isCancelled: boolean;
  cancelSearch: () => void;

  setQuery: (q: string) => void;
  setFilter: (f: FilterType) => void;
  setSort: (s: SortMode) => void;
  setDurationFilter: (d: DurationFilter) => void;
  setGenreFilter: (g: string) => void;
  search: (query: string) => Promise<void>;
  searchYouTube: (query: string, page?: number) => Promise<void>;
  loadMore: () => Promise<void>;
  setSuggestions: (s: Song[]) => void;
  clear: () => void;
}

export interface YTSong {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
  viewCount: number;
  album: string;
}

// ---- Helpers ----

function filterDuration(songs: Song[], filter: DurationFilter): Song[] {
  if (filter === 'any') return songs;
  return songs.filter((s) => {
    if (filter === 'short') return s.duration < 180;
    if (filter === 'medium') return s.duration >= 180 && s.duration <= 360;
    return s.duration > 360;
  });
}

function sortSongs(songs: Song[], sort: SortMode): Song[] {
  const arr = [...songs];
  switch (sort) {
    case 'newest':
      return arr.sort((a, b) => (b.releaseYear || 0) - (a.releaseYear || 0));
    case 'popular':
      return arr.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
    case 'alpha':
      return arr.sort((a, b) => a.title.localeCompare(b.title));
    default:
      return arr;
  }
}

function extractUnique(songs: Song[], key: keyof Song): string[] {
  const set = new Set<string>();
  for (const s of songs) {
    const val = s[key];
    if (typeof val === 'string' && val) set.add(val);
  }
  return Array.from(set).sort();
}

function getErrorMessage(err: unknown): string {
  if (err instanceof OfflineError) return 'You are offline. Check your connection.';
  if (err instanceof TimeoutError) return 'Search timed out. Try again.';
  if (err instanceof NetworkError) return 'Network error. Check your connection.';
  if (err instanceof Error && err.message) return err.message;
  return 'Search failed. Please try again.';
}

// ---- API ----

let searchGeneration = 0;
let searchAbortController: AbortController | null = null;
let ytGeneration = 0;
let ytAbortController: AbortController | null = null;

async function fetchYouTubeSearch(query: string, signal?: AbortSignal): Promise<YTSong[]> {
  // Client-side search via Invidious (bypasses broken server yt-dlp)
  return youtubeSearch(query, signal);
}

// ---- Store ----

export const useSearchStore = create<SearchState>((set, get) => ({
  query: '',
  debouncedQuery: '',
  filter: 'all',
  sort: 'relevance',
  durationFilter: 'any',
  genreFilter: '',

  libraryResults: [],
  ytResults: [],

  suggestions: [],
  status: 'idle',
  ytStatus: 'idle',
  page: 1,
  hasMore: true,
  error: null,
  isCancelled: false,

  setQuery: (q) => set({ query: q }),
  setFilter: (f) => set({ filter: f }),
  setSort: (s) => set({ sort: s }),
  setDurationFilter: (d) => set({ durationFilter: d }),
  setGenreFilter: (g) => set({ genreFilter: g }),
  setSuggestions: (s) => set({ suggestions: s }),

  cancelSearch: () => {
    searchGeneration++;
    if (searchAbortController) searchAbortController.abort();
  },

  search: async (query: string) => {
    if (!query || !query.trim()) {
      set({
        libraryResults: [],
        ytResults: [],
        suggestions: [],
        status: 'idle',
        ytStatus: 'idle',
        debouncedQuery: '',
        error: null,
        isCancelled: true,
      });
      return;
    }

    const trimmed = query.trim();
    const gen = ++searchGeneration;

    // Cancel previous search
    if (searchAbortController) searchAbortController.abort();
    searchAbortController = new AbortController();
    const { signal } = searchAbortController;

    // Instant client-side search from in-memory library (zero network)
    const librarySongs = useSongsStore.getState().songs;
    const lowerQuery = trimmed.toLowerCase();
    const instantSuggestions = librarySongs
      .filter(s => s.title.toLowerCase().includes(lowerQuery) || s.artist.toLowerCase().includes(lowerQuery))
      .slice(0, 5);

    // Search library immediately for library hits
    const libraryHits = librarySongs
      .filter(song => {
        const title = song.title.toLowerCase();
        const artist = song.artist.toLowerCase();
        const album = song.album?.toLowerCase() || '';

        if (lowerQuery.includes('official')) {
          if (title.includes('official') || album.includes('official')) {
            return true;
          }
        }

        return title.includes(lowerQuery) ||
               artist.includes(lowerQuery) ||
               album.includes(lowerQuery) ||
               artist.includes(lowerQuery.split(' ')[0]) ||
               title === lowerQuery;
      })
      .sort((a, b) => {
        const scoreA = (a.title.toLowerCase() === lowerQuery ? 100 : 0) + (a.artist.toLowerCase() === lowerQuery ? 50 : 0) + (a.album?.toLowerCase() === lowerQuery ? 30 : 0);
        const scoreB = (b.title.toLowerCase() === lowerQuery ? 100 : 0) + (b.artist.toLowerCase() === lowerQuery ? 50 : 0) + (b.album?.toLowerCase() === lowerQuery ? 30 : 0);
        return scoreB - scoreA;
      })
      .slice(0, 15);

    set({
      debouncedQuery: trimmed,
      libraryResults: libraryHits,
      suggestions: instantSuggestions,
      status: libraryHits.length > 0 ? 'success' : 'loading',
      ytStatus: 'loading',
      page: 1,
      hasMore: true,
      error: null,
      isCancelled: false,
    });

    if (!navigator.onLine) {
      set({ status: 'offline', ytStatus: 'offline', error: 'You are offline.' });
      return;
    }

    try {
      const searchStart = performance.now();
      const ytResult = await fetchYouTubeSearch(trimmed, signal);

      if (gen !== searchGeneration) return;

      const yt = ytResult ? ytResult.slice(0, 15) : [];

      metricsCollector.pushSearchLatency({
        query: trimmed,
        duration: performance.now() - searchStart,
        resultCount: yt.length + libraryHits.length,
        timestamp: Date.now(),
      });

      set({
        ytResults: yt,
        status: yt.length > 0 ? (libraryHits.length > 0 ? 'success' : 'success') : libraryHits.length > 0 ? 'success' : 'empty',
        ytStatus: yt.length > 0 ? 'success' : 'empty',
      });
    } catch (err) {
      if (gen !== searchGeneration) return;
      const msg = getErrorMessage(err);
      const isOffline = err instanceof OfflineError;
      set({
        status: isOffline ? 'offline' : 'error',
        ytStatus: 'idle',
        error: isOffline ? msg : null,
        libraryResults: [],
        ytResults: [],
      });
    }
  },

  searchYouTube: async (query: string, page = 1) => {
    if (ytAbortController) ytAbortController.abort();
    ytAbortController = new AbortController();
    const { signal } = ytAbortController;
    const gen = ++ytGeneration;

    set({ ytStatus: 'loading', error: null });
    try {
      const results = await fetchYouTubeSearch(query, signal);
      if (gen !== ytGeneration) return;
      const sliced = (results || []).slice(0, page * 15);
      set({
        ytResults: sliced,
        ytStatus: sliced.length > 0 ? 'success' : 'empty',
        page,
        hasMore: (results || []).length > page * 15,
      });
    } catch (err) {
      if (gen !== ytGeneration) return;
      set({ ytStatus: 'error', error: getErrorMessage(err) });
    }
  },

  loadMore: async () => {
    const { debouncedQuery, page, hasMore } = get();
    if (!hasMore || !debouncedQuery) return;

    if (ytAbortController) ytAbortController.abort();
    ytAbortController = new AbortController();
    const { signal } = ytAbortController;
    const gen = ++ytGeneration;

    set({ ytStatus: 'loading', error: null });
    try {
      const results = await fetchYouTubeSearch(debouncedQuery, signal);
      if (gen !== ytGeneration) return;
      const nextPage = page + 1;
      const sliced = (results || []).slice(0, nextPage * 15);
      set({
        ytResults: sliced,
        ytStatus: sliced.length > 0 ? 'success' : 'empty',
        page: nextPage,
        hasMore: (results || []).length > nextPage * 15,
      });
    } catch (err) {
      if (gen !== ytGeneration) return;
      set({ ytStatus: 'error', error: getErrorMessage(err) });
    }
  },

    clear: () => {
    searchGeneration++;
    ytGeneration++;
    if (searchAbortController) searchAbortController.abort();
    if (ytAbortController) ytAbortController.abort();
    set({
      query: '',
      debouncedQuery: '',
      libraryResults: [],
      ytResults: [],
      suggestions: [],
      status: 'idle',
      ytStatus: 'idle',
      page: 1,
      hasMore: true,
      filter: 'all',
      sort: 'relevance',
      durationFilter: 'any',
      genreFilter: '',
      error: null,
      isCancelled: true,
    });
  },
}));

// ---- Derived selectors ----

export function selectFilteredLibrary(state: SearchState): Song[] {
  let songs = state.libraryResults || [];
  const { filter, sort, durationFilter, genreFilter } = state;

  if (filter === 'genres' && genreFilter) {
    songs = songs.filter((s) => s.genre === genreFilter);
  }

  songs = filterDuration(songs, durationFilter);
  songs = sortSongs(songs, sort);

  return songs;
}

export function selectUniqueArtists(state: SearchState): string[] {
  return extractUnique(state.libraryResults || [], 'artist');
}

export function selectUniqueAlbums(state: SearchState): string[] {
  return extractUnique(state.libraryResults || [], 'album');
}

export function selectUniqueGenres(state: SearchState): string[] {
  return extractUnique(state.libraryResults || [], 'genre');
}
