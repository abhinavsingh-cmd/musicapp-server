import { create } from 'zustand';
import { Song } from '../types/music';
import { fetchSongs, invalidateSongsCache } from '../services/musicApi';
import { getAllCachedMetadata } from '../utils/downloadManager';
import { logger } from '../utils/logger';
import { deferIdle } from '../utils/idle';

interface SongsState {
  songs: Song[];
  loading: boolean;
  error: boolean;
  fetched: boolean;
  lastSuccessfulFetch: number;
  ensureLoaded: () => Promise<void>;
}

const SONGS_CACHE_KEY = 'songs_catalog_v1';

/**
 * The library catalog is refetched when the last successful fetch is older
 * than this — the cache is a performance optimization, never a permanent
 * freeze of the server's catalog. Existing songs stay visible during the
 * refresh; a failed/empty refresh keeps the catalog the user already has.
 */
export const LIBRARY_STALE_MS = 60 * 60 * 1000; // 1 hour

// ── Daily catalog rotation (client-side) ─────────────────────────────────
// The server catalog is a static file. To keep the library feeling alive
// without any server changes, the client applies a deterministic UTC-day
// seeded shuffle to whatever catalog it holds (fetched OR cached): same
// order all day (stable, cacheable), different every day. Works entirely
// inside the APK.
const DAY_MS = 24 * 60 * 60 * 1000;

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic per-UTC-day shuffle — exported for tests. */
export function dailyShuffleSongs(songs: Song[], now = Date.now()): Song[] {
  const dayIndex = Math.floor(now / DAY_MS);
  const rand = mulberry32(dayIndex);
  const shuffled = songs.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }
  return shuffled;
}

interface SongsCacheEntry {
  songs: Song[];
  cachedAt: number;
}

function loadCachedSongs(): SongsCacheEntry | null {
  try {
    const raw = localStorage.getItem(SONGS_CACHE_KEY);
    if (!raw) return null;
    if (raw.length > 100_000) {
      logger.debug(`[songsStore] Large cache (${(raw.length / 1024).toFixed(0)}KB), deferring parse`);
    }
    const entry: SongsCacheEntry = JSON.parse(raw);
    if (!Array.isArray(entry.songs)) return null;
    return entry;
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

    // The musicApi module cache pins the catalog for the whole session
    // (and is otherwise never invalidated). Every store-driven fetch must
    // see the server's CURRENT catalog — otherwise today's rotation would
    // never reach the UI. Callers who want the session cache (search,
    // track lookup) still benefit from it being repopulated by this fetch.
    invalidateSongsCache();

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
    }, 60_000);
  }).finally(() => {
    inflightFetch = null;
  });

  return inflightFetch;
}

async function initSongsStore(): Promise<void> {
  if (isInitialized) return;
  if (typeof window === 'undefined') return;

  const cached = loadCachedSongs();
  if (cached && cached.songs.length > 0) {
    // Freshness is judged by the cache's OWN timestamp, not the app-start
    // time: marking the cache as freshly-fetched at every launch meant the
    // library never re-fetched within the first hour of each session — the
    // exact "songs never change" experience. A next-day launch sees a stale
    // cachedAt and refreshes the catalog in the background.
    useSongsStore.setState({
      // Shuffle again with TODAY's seed — the cached list may be from a
      // previous day, and the library should rotate the moment it opens.
      songs: dailyShuffleSongs(cached.songs),
      lastSuccessfulFetch: cached.cachedAt || Date.now(),
      fetched: true,
      error: false,
    });
    logger.debug('[songsStore] Loaded', cached.songs.length, 'songs from localStorage cache');
  }

  try {
    const meta = await getAllCachedMetadata();
    if (meta.length > 0) {
      const current = useSongsStore.getState();
      if (current.songs.length === 0) {
        const songs = meta.map(cachedMetaToSong);
        if (songs.length > 0) {
          useSongsStore.setState({ songs: dailyShuffleSongs(songs), fetched: true, error: false });
          saveCachedSongs(songs);
          logger.debug('[songsStore] Loaded', songs.length, 'songs from IndexedDB metadata');
        }
      }
    }
  } catch {}

  isInitialized = true;
}

async function hydrateSongsStore(): Promise<void> {
  logger.debug('[songsStore] hydrateSongsStore started');

  await initSongsStore();

  const state = useSongsStore.getState();

  if (state.songs.length > 0) {
    const fresh = state.fetched && Date.now() - state.lastSuccessfulFetch < LIBRARY_STALE_MS;
    if (fresh) {
      logger.debug('[songsStore] Library is fresh — skipping fetch');
      return;
    }

    // Stale cache (or a lost fetched flag) — refresh in the background. The
    // visible catalog is kept until the fetch settles: a failed or empty
    // refresh must never wipe songs the user already has.
    logger.debug('[songsStore] Library cache is stale — refreshing in background');
    useSongsStore.setState({ loading: true, error: false });
    try {
      const songs = await fetchWithTimeout();
      if (songs.length > 0) {
        useSongsStore.setState({
          songs: dailyShuffleSongs(songs),
          loading: false,
          fetched: true,
          error: false,
          lastSuccessfulFetch: Date.now(),
        });
        saveCachedSongs(songs);
      } else {
        logger.debug('[songsStore] Stale refresh returned empty — keeping existing catalog');
        useSongsStore.setState({ loading: false, fetched: true, error: false });
      }
    } catch (error) {
      logger.error('[songsStore] Stale refresh failed — keeping existing catalog:', error);
      useSongsStore.setState({ loading: false, fetched: true, error: false });
    }
    return;
  }

  logger.debug('[songsStore] Starting library fetch');
  useSongsStore.setState({ loading: true, error: false });

  try {
    logger.debug('[songsStore] Fetching songs from API');
    const songs = await fetchWithTimeout();
    
    if (songs.length > 0) {
      logger.debug(`[songsStore] Fetched ${songs.length} songs successfully`);
      useSongsStore.setState({ 
        songs: dailyShuffleSongs(songs), 
        loading: false, 
        fetched: true, 
        error: false,
        lastSuccessfulFetch: Date.now(),
      });
      saveCachedSongs(songs);
    } else {
      const current = useSongsStore.getState();
      if (current.songs.length > 0) {
        logger.debug('[songsStore] API returned empty, keeping existing songs');
        useSongsStore.setState({ loading: false, fetched: true, error: false });
      } else {
        logger.debug('[songsStore] API returned empty and no existing songs, showing error state');
        useSongsStore.setState({ loading: false, fetched: true, error: true });
      }
    }
  } catch (error) {
    logger.error('[songsStore] Failed to fetch songs:', error);
    const current = useSongsStore.getState();
    if (current.songs.length > 0) {
      logger.debug('[songsStore] API failed but existing songs available, using them');
      useSongsStore.setState({ loading: false, fetched: true, error: false });
    } else {
      logger.debug('[songsStore] API failed and no existing songs available, showing error state');
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
}));

if (typeof window !== 'undefined') {
  deferIdle(() => { hydrateSongsStore().catch(() => {}); });
}