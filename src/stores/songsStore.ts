import { create } from 'zustand';
import { Song } from '../types/music';
import { fetchSongs } from '../services/musicApi';
import { getAllCachedMetadata } from '../utils/downloadManager';

interface SongsState {
  songs: Song[];
  loading: boolean;
  error: boolean;
  fetched: boolean;
  lastSuccessfulFetch: number;
  ensureLoaded: () => Promise<void>;
  hydrate: () => Promise<void>;
}

const SONGS_CACHE_KEY = 'songs_catalog_v1';

interface SongsCacheEntry {
  songs: Song[];
  cachedAt: number;
}

function loadCachedSongs(): Song[] | null {
  try {
    const raw = localStorage.getItem(SONGS_CACHE_KEY);
    if (!raw) return null;
    const entry: SongsCacheEntry = JSON.parse(raw);
    if (!Array.isArray(entry.songs)) return null;
    return entry.songs;
  } catch {
    return null;
  }
}

function saveCachedSongs(songs: Song[]): void {
  try {
    localStorage.setItem(SONGS_CACHE_KEY, JSON.stringify({
      songs,
      cachedAt: Date.now(),
    } satisfies SongsCacheEntry));
  } catch {}
}

function cachedMetaToSong(meta: Awaited<ReturnType<typeof getAllCachedMetadata>>[0]): Song {
  return {
    id: meta.id,
    title: meta.title || 'Unknown',
    artist: meta.artist || 'Unknown',
    album: meta.album || meta.artist || 'Unknown',
    duration: meta.duration || 0,
    genre: meta.genre || 'Pop',
    coverArt: meta.coverArt || '',
    audioUrl: '',
    youtubeId: meta.youtubeId || '',
    releaseYear: meta.releaseYear || 2024,
    isFavorite: false,
    playCount: 0,
  };
}

let inflightFetch: Promise<Song[]> | null = null;
let isInitialized = false;

function fetchWithTimeout(): Promise<Song[]> {
  if (inflightFetch) return inflightFetch;

  inflightFetch = new Promise<Song[]>((resolve) => {
    let settled = false;

    fetchSongs()
      .then(songs => {
        if (!settled) {
          settled = true;
          resolve(songs);
        }
      })
      .catch(() => {
        if (!settled) {
          settled = true;
          resolve([]);
        }
      });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve([]);
      }
    }, 5_000);
  }).finally(() => {
    inflightFetch = null;
  });

  return inflightFetch;
}

async function initSongsStore(): Promise<void> {
  if (isInitialized) return;
  if (typeof window === 'undefined') return;

  const cached = loadCachedSongs();
  if (cached && cached.length > 0) {
    useSongsStore.setState({ 
      songs: cached, 
      lastSuccessfulFetch: Date.now(),
      fetched: true,
      error: false,
    });
    console.log('[songsStore] Loaded', cached.length, 'songs from localStorage cache');
  }

  try {
    const meta = await getAllCachedMetadata();
    if (meta.length > 0) {
      const current = useSongsStore.getState();
      if (current.songs.length === 0) {
        const songs = meta.map(cachedMetaToSong);
        if (songs.length > 0) {
          useSongsStore.setState({ songs, fetched: true, error: false });
          saveCachedSongs(songs);
          console.log('[songsStore] Loaded', songs.length, 'songs from IndexedDB metadata');
        }
      }
    }
  } catch {}

  isInitialized = true;
}

async function hydrateSongsStore(): Promise<void> {
  console.log('[songsStore] hydrateSongsStore started');

  await initSongsStore();

  const state = useSongsStore.getState();
  if (state.fetched && state.songs.length > 0) {
    console.log('[songsStore] Library already hydrated with', state.songs.length, 'songs, skipping fetch');
    return;
  }

  // If we have songs but fetched is false (shouldn't happen now), don't overwrite
  if (state.songs.length > 0) {
    console.log('[songsStore] Has', state.songs.length, 'songs but fetched=false, marking as fetched');
    useSongsStore.setState({ fetched: true, error: false });
    return;
  }

  console.log('[songsStore] Starting library fetch');
  useSongsStore.setState({ loading: true, error: false });

  try {
    console.log('[songsStore] Fetching songs from API');
    const songs = await fetchWithTimeout();
    
    if (songs.length > 0) {
      console.log(`[songsStore] Fetched ${songs.length} songs successfully`);
      useSongsStore.setState({ 
        songs, 
        loading: false, 
        fetched: true, 
        error: false,
        lastSuccessfulFetch: Date.now(),
      });
      saveCachedSongs(songs);
    } else {
      const current = useSongsStore.getState();
      if (current.songs.length > 0) {
        console.log('[songsStore] API returned empty, keeping existing songs');
        useSongsStore.setState({ loading: false, fetched: true, error: false });
      } else {
        console.log('[songsStore] API returned empty and no existing songs, showing error state');
        useSongsStore.setState({ loading: false, fetched: true, error: true });
      }
    }
  } catch (error) {
    console.error('[songsStore] Failed to fetch songs:', error);
    const current = useSongsStore.getState();
    if (current.songs.length > 0) {
      console.log('[songsStore] API failed but existing songs available, using them');
      useSongsStore.setState({ loading: false, fetched: true, error: false });
    } else {
      console.log('[songsStore] API failed and no existing songs available, showing error state');
      useSongsStore.setState({ loading: false, error: true, fetched: true });
    }
  }
}

export const useSongsStore = create<SongsState>(() => ({
  songs: [],
  loading: false,
  error: false,
  fetched: false,
  lastSuccessfulFetch: 0,

  ensureLoaded: async () => {
    await hydrateSongsStore();
  },

  hydrate: async () => {
    await hydrateSongsStore();
  },
}));

if (typeof window !== 'undefined') {
  const deferInit = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (cb: IdleRequestCallback) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 0);
  deferInit(() => { hydrateSongsStore().catch(() => {}); });
}