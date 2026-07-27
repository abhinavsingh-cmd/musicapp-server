import { create } from 'zustand';
import { Song } from '../types/music';
import { fetchSongs } from '../services/musicApi';
import { getAllCachedMetadata } from '../utils/downloadManager';

interface SongsState {
  songs: Song[];
  loading: boolean;
  error: boolean;
  fetched: boolean;
  ensureLoaded: () => Promise<void>;
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
    if (!Array.isArray(entry.songs) || entry.songs.length === 0) return null;
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

let inflight: Promise<Song[]> | null = null;

async function fetchWithTimeout(): Promise<Song[]> {
  if (inflight) return inflight;

  inflight = new Promise<Song[]>((resolve, reject) => {
    let settled = false;

    fetchSongs()
      .then(songs => {
        if (!settled) {
          settled = true;
          resolve(songs);
        } else {
          try { useSongsStore.setState({ songs, fetched: true, error: false }); } catch {}
        }
      })
      .catch(err => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve([]);
      }
    }, 5_000);
  }).finally(() => {
    inflight = null;
  });

  return inflight;
}

let initPromise: Promise<void> | null = null;

function initSongsStore() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (typeof window === 'undefined') return;
    const cached = loadCachedSongs();
    if (cached && cached.length > 0) {
      useSongsStore.setState({ songs: cached });
    }
    try {
      const meta = await getAllCachedMetadata();
      if (meta.length > 0) {
        const current = useSongsStore.getState();
        if (!current.fetched) {
          const songs = meta.map(cachedMetaToSong);
          if (songs.length > 0) {
            useSongsStore.setState({ songs });
            saveCachedSongs(songs);
          }
        }
      }
    } catch {}
  })();
  return initPromise;
}

export const useSongsStore = create<SongsState>((set, get) => ({
  songs: [],
  loading: false,
  error: false,
  fetched: false,

  ensureLoaded: async () => {
    if (get().fetched) return;
    await initSongsStore();
    set({ loading: true, error: false });

    try {
      const songs = await fetchWithTimeout();
      if (songs.length > 0) {
        set({ songs, loading: false, fetched: true });
        saveCachedSongs(songs);
      } else {
        set({ loading: false, fetched: true });
      }
    } catch {
      try {
        const cachedMeta = await getAllCachedMetadata();
        if (cachedMeta.length > 0) {
          const offlineSongs = cachedMeta.map(cachedMetaToSong);
          set({ songs: offlineSongs, loading: false, fetched: true, error: false });
          return;
        }
      } catch {}
      set({ loading: false, error: true, fetched: true });
    }
  },
}));

if (typeof window !== 'undefined') {
  const deferInit = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (cb: IdleRequestCallback) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 0);
  deferInit(() => { initSongsStore().catch(() => {}); });
}