import { create } from 'zustand';
import { Song } from '../types/music';
import { sampleSongs } from '../data/sampleSongs';
import { api } from '../config/api';

// ---- Types ----

export type FilterType = 'all' | 'songs' | 'artists' | 'albums' | 'playlists' | 'genres';
export type SortMode = 'relevance' | 'newest' | 'popular' | 'alpha';
export type DurationFilter = 'any' | 'short' | 'medium' | 'long'; // <3m, 3-6m, >6m

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
  page: number;          // for infinite scroll (YouTube pages)
  hasMore: boolean;

  // actions
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
  const lower = (r.title + ' ' + r.artist).toLowerCase();
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
    const res = await fetch(api(`/search?q=${encodeURIComponent(query)}`));
    if (!res.ok) throw new Error('Server unavailable');
    const data = await res.json();
    const serverSongs = (data.songs || []).map((s: any) => ({
      id: String(s.id),
      title: s.title,
      artist: s.artist,
      album: s.album || s.artist,
      duration: s.duration,
      genre: s.genre || 'Pop',
      coverArt: s.coverArt,
      audioUrl: s.youtubeId ? '' : (s.audioUrl || ''),
      youtubeId: s.youtubeId,
      releaseYear: s.releaseYear || 2024,
      isFavorite: false,
      playCount: Math.floor(Math.random() * 50000),
    }));
    const localSongs = sampleSongs.filter(
      (s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q) || s.genre.toLowerCase().includes(q)
    );
    const seen = new Set<string>();
    const merged: Song[] = [];
    for (const s of [...localSongs, ...serverSongs]) {
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

async function fetchYouTubeSearch(query: string): Promise<YTSong[]> {
  try {
    const res = await fetch(api(`/youtube/search?q=${encodeURIComponent(query)}`));
    const data = await res.json();
    return (data.results || []).filter(isMusicResult);
  } catch {
    return [];
  }
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

  setQuery: (q) => set({ query: q }),
  setFilter: (f) => set({ filter: f }),
  setSort: (s) => set({ sort: s }),
  setDurationFilter: (d) => set({ durationFilter: d }),
  setGenreFilter: (g) => set({ genreFilter: g }),
  setSuggestions: (s) => set({ suggestions: s }),

  search: async (query: string) => {
    if (!query.trim()) {
      set({ libraryResults: [], ytResults: [], suggestions: [], loading: false, ytLoading: false, debouncedQuery: '' });
      return;
    }

    set({ debouncedQuery: query, loading: true, ytLoading: true, page: 1, hasMore: true });

    // Parallel: library + YouTube
    const [libResults, ytResults] = await Promise.all([
      fetchLibrarySearch(query),
      fetchYouTubeSearch(query),
    ]);

    set({
      libraryResults: libResults,
      ytResults: ytResults.slice(0, 15),
      suggestions: libResults.slice(0, 5),
      loading: false,
      ytLoading: false,
    });
  },

  searchYouTube: async (query: string, page = 1) => {
    set({ ytLoading: true });
    const results = await fetchYouTubeSearch(query);
    const sliced = results.slice(0, page * 15);
    set({
      ytResults: sliced,
      ytLoading: false,
      page,
      hasMore: results.length > page * 15,
    });
  },

  loadMore: async () => {
    const { debouncedQuery, page, hasMore } = get();
    if (!hasMore || !debouncedQuery) return;
    set({ ytLoading: true });
    const results = await fetchYouTubeSearch(debouncedQuery);
    const nextPage = page + 1;
    const sliced = results.slice(0, nextPage * 15);
    set({
      ytResults: sliced,
      ytLoading: false,
      page: nextPage,
      hasMore: results.length > nextPage * 15,
    });
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
  }),
}));

// ---- Derived selectors ----

export function selectFilteredLibrary(state: SearchState): Song[] {
  let songs = state.libraryResults;
  const { filter, sort, durationFilter, genreFilter } = state;

  // Filter by type
  if (filter === 'songs') {
    // all songs (no extra filter)
  } else if (filter === 'artists') {
    // handled at UI level (show artist grid)
  } else if (filter === 'albums') {
    // handled at UI level
  } else if (filter === 'genres' && genreFilter) {
    songs = songs.filter((s) => s.genre === genreFilter);
  }

  // Duration filter
  songs = filterDuration(songs, durationFilter);

  // Sort
  songs = sortSongs(songs, sort);

  return songs;
}

export function selectUniqueArtists(state: SearchState): string[] {
  return extractUnique(state.libraryResults, 'artist');
}

export function selectUniqueAlbums(state: SearchState): string[] {
  return extractUnique(state.libraryResults, 'album');
}

export function selectUniqueGenres(state: SearchState): string[] {
  return extractUnique(state.libraryResults, 'genre');
}
