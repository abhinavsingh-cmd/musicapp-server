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

// --- localStorage cache for instant startup ---
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

/**
 * On cold start, immediately try to load songs from IndexedDB in background.
 * This fills the store quickly on first visit (before API responds).
 * IndexedDB is async so it never blocks the first render.
 */
const initialSongs = loadCachedSongs();
if (!initialSongs || initialSongs.length === 0) {
  getAllCachedMetadata()
    .then(meta => {
      if (meta.length === 0) return;
      const current = useSongsStore.getState();
      if (current.fetched) return; // API already responded, don't overwrite
      const songs = meta.map(cachedMetaToSong);
      if (songs.length > 0) {
        useSongsStore.setState({ songs });
        saveCachedSongs(songs);
      }
    })
    .catch(() => {});
}

export const useSongsStore = create<SongsState>((set, get) => ({
  songs: initialSongs || [],
  loading: false,
  error: false,
  fetched: false,

  ensureLoaded: async () => {
    if (get().fetched) return;
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
      // Network failed — try IndexedDB as fallback
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
