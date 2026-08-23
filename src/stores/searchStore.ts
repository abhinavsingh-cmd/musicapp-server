import { create } from 'zustand';
import { Song } from '../types/music';
import { OfflineError, NetworkError, TimeoutError, RateLimitError } from '../config/api';
import { searchProviders } from '../providers/search';
import type { Track } from '../providers/types';
import { metricsCollector } from '../services/metricsCollector';
import { librarySearchIndex, initLibrarySearchIndex, type IndexedSearchHit } from '../services/librarySearchIndex';

// ---- Types ----

export type FilterType = 'all' | 'songs' | 'artists' | 'albums' | 'playlists' | 'genres';
export type SortMode = 'relevance' | 'newest' | 'popular' | 'alpha';
export type DurationFilter = 'any' | 'short' | 'medium' | 'long';

/**
 * Explicit search lifecycle. Every terminal outcome is distinct so the UI
 * can never conflate "no results" with a failure, and loading states are
 * always followed by one of: success / empty / error / timeout / network /
 * offline / rateLimited / cancelled.
 */
export type SearchStatus =
  | 'idle'
  | 'loading'
  /** A re-request fired after a previous failure — spinner with "Retrying". */
  | 'retrying'
  | 'success'
  | 'empty'
  /** Server answered, but with an error (5xx etc.). */
  | 'error'
  /** OfflineError / navigator offline. */
  | 'offline'
  /** NetworkError — could not reach the backend at all. */
  | 'network'
  /** TimeoutError — the backend did not answer in time. */
  | 'timeout'
  /** RateLimitError — 429/503, retry with backoff. */
  | 'rateLimited'
  | 'cancelled';

/** States that represent a completed FAILURE (retryable, never a result). */
const FAILURE_STATUSES: ReadonlySet<SearchStatus> = new Set(['error', 'offline', 'network', 'timeout', 'rateLimited']);

export function isFailureStatus(status: SearchStatus): boolean {
  return FAILURE_STATUSES.has(status);
}

interface SearchState {
  query: string;
  debouncedQuery: string;
  filter: FilterType;
  sort: SortMode;
  durationFilter: DurationFilter;
  genreFilter: string;

  libraryResults: Song[];
  ytResults: YTSong[];
  /** The query the current ytResults belong to (stale-result protection). */
  ytQuery: string;

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
  /** Load a specific page of YouTube results for a query (shared paging core). */
  loadYtPage: (query: string, page: number) => Promise<void>;
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
  if (err instanceof RateLimitError) {
    const retrySec = err.retryAfterMs ? Math.ceil(err.retryAfterMs / 1000) : 0;
    return retrySec > 0
      ? `Server is busy (rate limited). Try again in ~${retrySec}s.`
      : 'Server is busy (rate limited). Please try again shortly.';
  }
  if (err instanceof Error && err.message) return err.message;
  return 'Search failed. Please try again.';
}

/**
 * Map an error to its explicit search state. Server errors (ApiError) stay
 * 'error'; transport-level failures get their own distinct states so the UI
 * can render a specific banner for each.
 */
function classifyError(err: unknown): SearchStatus {
  if (err instanceof OfflineError) return 'offline';
  if (err instanceof TimeoutError) return 'timeout';
  if (err instanceof NetworkError) return 'network';
  if (err instanceof RateLimitError) return 'rateLimited';
  return 'error';
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
  ytQuery: '',

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
    ytGeneration++;
    if (searchAbortController) searchAbortController.abort();
    // A paging request (loadMore) can be in flight too — cancel it as well
    // or its fetch would keep burning a connection (and deadlines) after
    // the search UI is gone.
    if (ytAbortController) ytAbortController.abort();
    // A cancel without a follow-up search must end the loading state —
    // otherwise the in-flight search's catch is generation-guarded and the
    // spinner would spin forever.
    set({ ytStatus: 'cancelled', isCancelled: true });
  },

  search: async (query: string) => {
    if (!query || !query.trim()) {
      // A blank query supersedes whatever is in flight: bump the generation
      // and abort so a late response from a previous search can never land
      // after the UI already reset to idle.
      searchGeneration++;
      if (searchAbortController) searchAbortController.abort();
      set({
        libraryResults: [],
        ytResults: [],
        ytQuery: '',
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

    // Duplicate-request protection: an identical search that is already in
    // flight must not be re-fired (the suggestions UI re-triggers search()
    // for the same debounced query; re-running would duplicate network
    // requests and briefly flash the spinner).
    const current = get();
    if (current.debouncedQuery === trimmed &&
        (current.ytStatus === 'loading' || current.ytStatus === 'retrying')) {
      return;
    }

    const gen = ++searchGeneration;

    // Cancel previous search — including an in-flight PAGING request (a
    // loadMore from the previous query). Without this, the stale page fetch
    // keeps running (and re-applying its deadlines) until it settles, even
    // though its response is generation-guarded away. Bump ytGeneration so
    // the paging path's own guard discards it deterministically.
    if (searchAbortController) searchAbortController.abort();
    if (ytAbortController) ytAbortController.abort();
    ytGeneration++;
    searchAbortController = new AbortController();
    const { signal } = searchAbortController;

    const shouldCancel = () => gen !== searchGeneration;

    // A NEW query must never show the previous query's results: clear them
    // the moment the new search starts.
    if (current.ytQuery !== trimmed) {
      set({ ytResults: [], ytQuery: trimmed });
    }

    // Start both searches in parallel — library is instant (in-memory index),
    // YouTube is a network fetch.
    const libraryPromise = librarySearchIndex.search(trimmed, { limit: 15, shouldCancel });
    const suggestionsPromise = librarySearchIndex.suggest(trimmed, { limit: 5, shouldCancel });

    // Show library results the instant they're ready (usually < 1ms). The
    // library index is in-memory, but an unexpected failure must still be
    // surfaced as a real error state — never swallowed into a stuck spinner
    // or an unhandled promise rejection.
    let libraryHits!: IndexedSearchHit[];
    let instantSuggestions!: IndexedSearchHit[];
    try {
      [libraryHits, instantSuggestions] = await Promise.all([
        libraryPromise,
        suggestionsPromise,
      ]);
    } catch (err) {
      if (shouldCancel()) return;
      const status = classifyError(err);
      set({
        debouncedQuery: trimmed,
        libraryResults: [],
        ytResults: [],
        ytQuery: trimmed,
        suggestions: [],
        status,
        ytStatus: status,
        page: 1,
        hasMore: true,
        error: getErrorMessage(err),
        isCancelled: false,
      });
      return;
    }
    if (shouldCancel()) return;

    set({
      debouncedQuery: trimmed,
      libraryResults: libraryHits.map((h) => h.song),
      suggestions: instantSuggestions.map((h) => h.song),
      status: libraryHits.length > 0 ? 'success' : 'loading',
      // A re-request after a failure is a RETRY, not a first load.
      ytStatus: isFailureStatus(get().ytStatus) ? 'retrying' : 'loading',
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
        ytQuery: trimmed,
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
      const status = classifyError(err);
      const msg = getErrorMessage(err);
      // CRITICAL: Only clear ytResults, NOT libraryResults.
      // Library results were already successfully fetched and should be preserved.
      // Keep YouTube rows only when they belong to THIS query (a refresh of
      // the same query stays visible under the error banner); results from a
      // previous query must never survive under a new one.
      const keep = get().ytQuery === trimmed;
      set({
        status: libraryHits.length > 0 ? 'success' : status,
        ytStatus: status,
        error: msg,
        ytResults: keep ? get().ytResults : [],
      });
    }
  },

  /**
   * Load a page of YouTube results for `query`. Shared by searchYouTube
   * (explicit page) and loadMore (next page of the debounced query).
   * Stale-response protection: a response that arrives after a NEWER
   * top-level search started (or after a newer paging request superseded
   * this one) is discarded — it can never overwrite newer results.
   */
  loadYtPage: async (query: string, page: number) => {
    // Duplicate-request protection: overlapping paging requests for the
    // same query (observer re-fires before state settles) must not each hit
    // the network — the in-flight one owns the state.
    const prev = get();
    if ((prev.ytStatus === 'loading' || prev.ytStatus === 'retrying') && prev.debouncedQuery === query) {
      return;
    }

    if (ytAbortController) ytAbortController.abort();
    ytAbortController = new AbortController();
    const { signal } = ytAbortController;
    const gen = ++ytGeneration;
    const owningSearchGen = searchGeneration;

    set({ ytStatus: isFailureStatus(get().ytStatus) ? 'retrying' : 'loading', error: null });
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
        ytQuery: query,
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
      set({ ytStatus: classifyError(err), error: getErrorMessage(err) });
    }
  },

  searchYouTube: async (query: string, page = 1) => {
    await get().loadYtPage(query, page);
  },

  loadMore: async () => {
    const { debouncedQuery, page, hasMore } = get();
    if (!hasMore || !debouncedQuery) return;
    await get().loadYtPage(debouncedQuery, page + 1);
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
      ytQuery: '',
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
