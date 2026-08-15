import { create } from 'zustand';
import { Song } from '../types/music';
import { OfflineError, NetworkError, TimeoutError } from '../config/api';
import { searchProviders } from '../providers/search';
import type { Track } from '../providers/types';
import { metricsCollector } from '../services/metricsCollector';
import { librarySearchIndex, initLibrarySearchIndex } from '../services/librarySearchIndex';

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

/** True when the error is a request cancellation, not a real failure. */
function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

// ---- API ----

let searchGeneration = 0;
let searchAbortController: AbortController | null = null;
let ytGeneration = 0;
let ytAbortController: AbortController | null = null;

/** Map a normalized provider Track back to the UI's YouTube result row. */
function trackToYTSong(track: Track): YTSong {
  return {
    id: track.externalId || track.id,
    title: track.title,
    artist: track.artist,
    duration: track.duration,
    thumbnail: track.artwork,
    viewCount: track.playCount || 0,
    album: track.album || '',
  };
}

async function fetchYouTubeSearch(query: string, signal?: AbortSignal): Promise<YTSong[]> {
  // Routed through the provider facade — the store consumes normalized
  // tracks; the YouTube provider owns the actual search (server yt-dlp,
  // then Invidious fallback). Provider errors are re-thrown so the store's
  // offline/timeout handling keeps working unchanged.
  const [result] = await searchProviders(query, { signal, providers: ['youtube'] });
  if (!result) return [];
  if (result.error) throw result.error;
  // Defense in depth: a result without a playable id can never be clicked —
  // drop it here instead of letting it reach the UI, the queue, or playback.
  // Duplicate ids are dropped too: they break React keys and double-play.
  const seen = new Set<string>();
  return result.tracks
    .map(trackToYTSong)
    .filter((r) => {
      const id = r.id && r.id.trim();
      if (!id) return false;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

// ---- In-memory YouTube result cache (repeat queries / paging are instant) ----

const YT_CACHE_TTL_MS = 60_000;
const YT_CACHE_MAX = 30;
const ytResultCache = new Map<string, { results: YTSong[]; cachedAt: number }>();

function getYtCache(query: string): YTSong[] | null {
  const entry = ytResultCache.get(query);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > YT_CACHE_TTL_MS) {
    ytResultCache.delete(query);
    return null;
  }
  ytResultCache.delete(query);
  ytResultCache.set(query, entry);
  return entry.results;
}

function setYtCache(query: string, results: YTSong[]): void {
  ytResultCache.delete(query);
  ytResultCache.set(query, { results, cachedAt: Date.now() });
  while (ytResultCache.size > YT_CACHE_MAX) {
    const oldest = ytResultCache.keys().next().value;
    if (oldest === undefined) break;
    ytResultCache.delete(oldest);
  }
}

// ---- Store ----

initLibrarySearchIndex();

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
    // A cancel without a follow-up search must end the loading state —
    // otherwise the in-flight search's catch is generation-guarded and the
    // spinner would spin forever.
    set({ ytStatus: 'cancelled', isCancelled: true });
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

    const shouldCancel = () => gen !== searchGeneration;

    // Start both searches in parallel — library is instant (in-memory index),
    // YouTube is a network fetch.
    const libraryPromise = librarySearchIndex.search(trimmed, { limit: 15, shouldCancel });
    const suggestionsPromise = librarySearchIndex.suggest(trimmed, { limit: 5, shouldCancel });

    // Show library results the instant they're ready (usually < 1ms)
    const [libraryHits, instantSuggestions] = await Promise.all([
      libraryPromise,
      suggestionsPromise,
    ]);
    if (shouldCancel()) return;

    set({
      debouncedQuery: trimmed,
      libraryResults: libraryHits.map((h) => h.song),
      suggestions: instantSuggestions.map((h) => h.song),
      status: libraryHits.length > 0 ? 'success' : 'loading',
      ytStatus: 'loading',
      page: 1,
      hasMore: true,
      error: null,
      isCancelled: false,
    });

    // YouTube search runs in parallel — results stream in when ready
    if (!navigator.onLine) {
      set({ status: 'offline', ytStatus: 'offline', error: 'You are offline.' });
      return;
    }

    try {
      const cachedYt = getYtCache(trimmed);
      let yt: YTSong[] = [];
      if (cachedYt) {
        yt = cachedYt.slice(0, 15);
      } else {
        const searchStart = performance.now();
        const ytResult = await fetchYouTubeSearch(trimmed, signal);

        if (gen !== searchGeneration) return;

        const fullYt = ytResult || [];
        setYtCache(trimmed, fullYt);
        yt = fullYt.slice(0, 15);

        metricsCollector.pushSearchLatency({
          query: trimmed,
          duration: performance.now() - searchStart,
          resultCount: yt.length + libraryHits.length,
          timestamp: Date.now(),
        });
      }

      set({
        ytResults: yt,
        status: yt.length > 0 || libraryHits.length > 0 ? 'success' : 'empty',
        ytStatus: yt.length > 0 ? 'success' : 'empty',
      });
    } catch (err) {
      if (gen !== searchGeneration) return;
      // Aborted = superseded or user-cancelled — never report as an error.
      if (isAbortError(err)) {
        set({ ytStatus: 'cancelled', isCancelled: true });
        return;
      }
      const msg = getErrorMessage(err);
      const isOffline = err instanceof OfflineError;
      // CRITICAL: Only clear ytResults, NOT libraryResults.
      // Library results were already successfully fetched and should be preserved.
      // CRITICAL: surface the failure (ytStatus 'error' + message) instead of
      // silently resetting to idle — swallowing it made a dead YouTube backend
      // look identical to "no results found".
      set({
        status: libraryHits.length > 0 ? 'success' : (isOffline ? 'offline' : 'error'),
        ytStatus: isOffline ? 'offline' : 'error',
        error: msg,
        ytResults: [],
      });
    }
  },

  searchYouTube: async (query: string, page = 1) => {
    if (ytAbortController) ytAbortController.abort();
    ytAbortController = new AbortController();
    const { signal } = ytAbortController;
    const gen = ++ytGeneration;
    // Stale-response protection: if a NEW top-level search starts while this
    // paging request is in flight, its response must never overwrite the new
    // search's results.
    const owningSearchGen = searchGeneration;

    set({ ytStatus: 'loading', error: null });
    try {
      let full = getYtCache(query);
      if (!full) {
        const results = await fetchYouTubeSearch(query, signal);
        if (gen !== ytGeneration || owningSearchGen !== searchGeneration) return;
        full = results || [];
        setYtCache(query, full);
      }
      if (gen !== ytGeneration || owningSearchGen !== searchGeneration) return;
      const sliced = full.slice(0, page * 15);
      set({
        ytResults: sliced,
        ytStatus: sliced.length > 0 ? 'success' : 'empty',
        page,
        hasMore: full.length > page * 15,
      });
    } catch (err) {
      if (gen !== ytGeneration || owningSearchGen !== searchGeneration) return;
      if (isAbortError(err)) {
        set({ ytStatus: 'cancelled' });
        return;
      }
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
    // Stale-response protection: same as searchYouTube — a paging response
    // that arrives after the user started a new search is discarded.
    const owningSearchGen = searchGeneration;

    set({ ytStatus: 'loading', error: null });
    try {
      let full = getYtCache(debouncedQuery);
      if (!full) {
        const results = await fetchYouTubeSearch(debouncedQuery, signal);
        if (gen !== ytGeneration || owningSearchGen !== searchGeneration) return;
        full = results || [];
        setYtCache(debouncedQuery, full);
      }
      if (gen !== ytGeneration || owningSearchGen !== searchGeneration) return;
      const nextPage = page + 1;
      const sliced = full.slice(0, nextPage * 15);
      set({
        ytResults: sliced,
        ytStatus: sliced.length > 0 ? 'success' : 'empty',
        page: nextPage,
        hasMore: full.length > nextPage * 15,
      });
    } catch (err) {
      if (gen !== ytGeneration || owningSearchGen !== searchGeneration) return;
      if (isAbortError(err)) {
        set({ ytStatus: 'cancelled' });
        return;
      }
      set({ ytStatus: 'error', error: getErrorMessage(err) });
    }
  },

    clear: () => {
    searchGeneration++;
    ytGeneration++;
    ytResultCache.clear();
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
