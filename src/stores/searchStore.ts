import { create } from 'zustand';
import { Song } from '../types/music';
import { sampleSongs } from '../data/sampleSongs';
import { api, apiFetch } from '../config/api';

// ---- Types ----

export type FilterType = 'all' | 'songs' | 'artists' | 'albums' | 'playlists' | 'genres';
export type SortMode = 'relevance' | 'newest' | 'popular' | 'alpha';
export type DurationFilter = 'any' | 'short' | 'medium' | 'long';

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
  loading: boolean;
  ytLoading: boolean;
  page: number;
  hasMore: boolean;
  error: string | null;

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
}

// ---- Helpers ----

const SKIP_WORDS = [
  'lyrics video', 'karaoke', 'instrumental', 'cover by', 'live performance',
  'reaction', 'interview', 'behind the scenes', 'making of', 'tutorial',
  'how to', 'unboxing', 'vlog', 'compilation', 'top 10', 'best of',
  'album mix', 'jukebox', 'full album', 'slowed + reverb', 'sped up',
  'nightcore', 'mashup', 'remix by',
];

function isMusicResult(r: YTSong): boolean {
  if (!r || !r.id || !r.title) return false;
  const lower = (r.title + ' ' + (r.artist || '')).toLowerCase();
  if (r.duration > 0 && (r.duration < 30 || r.duration > 900)) return false;
  for (const w of SKIP_WORDS) { if (lower.includes(w)) return false; }
  return true;
}

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

// ---- API ----

async function fetchLibrarySearch(query: string): Promise<Song[]> {
  const q = query.toLowerCase();
  try {
    const res = await apiFetch(api(`/search?q=${encodeURIComponent(query)}`));
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(`Expected JSON, got ${contentType.slice(0, 40) || 'unknown'}`);
    }
    const data = await res.json();
    const serverSongs = (data.songs || []).map((s: any) => ({
      id: String(s.id || ''),
      title: String(s.title || 'Unknown'),
      artist: String(s.artist || 'Unknown'),
      album: String(s.album || s.artist || ''),
      duration: Number(s.duration) || 0,
      genre: String(s.genre || 'Pop'),
      coverArt: String(s.coverArt || ''),
      audioUrl: s.youtubeId ? '' : String(s.audioUrl || ''),
      youtubeId: String(s.youtubeId || ''),
      releaseYear: Number(s.releaseYear) || 2024,
      isFavorite: false,
      playCount: Math.floor(Math.random() * 50000),
    }));
    const localSongs = sampleSongs.filter(
      (s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q) || s.genre.toLowerCase().includes(q)
    );
    const seen = new Set<string>();
    const merged: Song[] = [];
    for (const s of [...localSongs, ...serverSongs]) {
      if (!s || !s.title) continue;
      const key = `${s.title.toLowerCase()}|${s.artist.toLowerCase()}`;
      if (!seen.has(key)) { seen.add(key); merged.push(s); }
    }
    return merged;
  } catch {
    return sampleSongs.filter(
      (s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q) || s.genre.toLowerCase().includes(q)
    );
  }
}

async function fetchYouTubeSearch(query: string, maxRetries = 2): Promise<YTSong[]> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await apiFetch(api(`/youtube/search?q=${encodeURIComponent(query)}`), { timeout: 20_000 });
      if (!res.ok) return [];
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`Expected JSON, got ${contentType.slice(0, 40) || 'unknown'}`);
      }
      const data = await res.json();
      const results = Array.isArray(data.results) ? data.results : [];
      return results
        .filter((r: any) => r && r.id)
        .map((r: any) => ({
          id: String(r.id),
          title: String(r.title || 'Unknown'),
          artist: String(r.artist || r.channel || 'Unknown'),
          duration: Number(r.duration) || 0,
          thumbnail: String(r.thumbnail || ''),
          viewCount: Number(r.viewCount || r.view_count) || 0,
        }))
        .filter(isMusicResult);
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 800 * Math.pow(2, attempt)));
      }
    }
  }
  console.warn('[SearchStore] YouTube search failed after retries:', lastError?.message);
  return [];
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
  loading: false,
  ytLoading: false,
  page: 1,
  hasMore: true,
  error: null,

  setQuery: (q) => set({ query: q }),
  setFilter: (f) => set({ filter: f }),
  setSort: (s) => set({ sort: s }),
  setDurationFilter: (d) => set({ durationFilter: d }),
  setGenreFilter: (g) => set({ genreFilter: g }),
  setSuggestions: (s) => set({ suggestions: s }),

  search: async (query: string) => {
    if (!query || !query.trim()) {
      set({ libraryResults: [], ytResults: [], suggestions: [], loading: false, ytLoading: false, debouncedQuery: '', error: null });
      return;
    }

    const trimmed = query.trim();
    set({ debouncedQuery: trimmed, loading: true, ytLoading: true, page: 1, hasMore: true, error: null });

    try {
      const [libResults, ytResults] = await Promise.all([
        fetchLibrarySearch(trimmed),
        fetchYouTubeSearch(trimmed),
      ]);

      set({
        libraryResults: libResults || [],
        ytResults: (ytResults || []).slice(0, 15),
        suggestions: (libResults || []).slice(0, 5),
        loading: false,
        ytLoading: false,
      });
    } catch (err) {
      console.error('[SearchStore] search failed:', err);
      set({ loading: false, ytLoading: false, error: 'Search failed. Please try again.' });
    }
  },

  searchYouTube: async (query: string, page = 1) => {
    set({ ytLoading: true, error: null });
    try {
      const results = await fetchYouTubeSearch(query);
      const sliced = (results || []).slice(0, page * 15);
      set({
        ytResults: sliced,
        ytLoading: false,
        page,
        hasMore: (results || []).length > page * 15,
      });
    } catch (err) {
      console.error('[SearchStore] searchYouTube failed:', err);
      set({ ytLoading: false });
    }
  },

  loadMore: async () => {
    const { debouncedQuery, page, hasMore } = get();
    if (!hasMore || !debouncedQuery) return;
    set({ ytLoading: true, error: null });
    try {
      const results = await fetchYouTubeSearch(debouncedQuery);
      const nextPage = page + 1;
      const sliced = (results || []).slice(0, nextPage * 15);
      set({
        ytResults: sliced,
        ytLoading: false,
        page: nextPage,
        hasMore: (results || []).length > nextPage * 15,
      });
    } catch (err) {
      console.error('[SearchStore] loadMore failed:', err);
      set({ ytLoading: false });
    }
  },

  clear: () => set({
    query: '',
    debouncedQuery: '',
    libraryResults: [],
    ytResults: [],
    suggestions: [],
    loading: false,
    ytLoading: false,
    page: 1,
    hasMore: true,
    filter: 'all',
    sort: 'relevance',
    durationFilter: 'any',
    genreFilter: '',
    error: null,
  }),
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
