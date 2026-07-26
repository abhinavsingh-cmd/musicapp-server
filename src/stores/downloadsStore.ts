import { create } from 'zustand';
import { Song } from '../types/music';
import {
  getAllDownloads,
  removeDownload,
  isDownloaded,
  downloadSongWithProgress,
  evictOldCache,
  getCacheSize,
  DownloadedSong,
  DownloadProgress,
} from '../utils/downloadManager';

export type DownloadError = {
  song: Song;
  message: string;
  timestamp: number;
};

export interface DownloadsState {
  downloads: DownloadedSong[];
  downloadingIds: Set<string>;
  progressMap: Record<string, DownloadProgress>;
  loading: boolean;
  isOnline: boolean;
  cacheSize: number;
  blobUrlCache: Record<string, string>;
  failedDownloads: DownloadError[];

  loadDownloads: () => Promise<void>;
  downloadSong: (song: Song) => Promise<void>;
  cancelDownload: (youtubeId: string) => void;
  retryDownload: (song: Song) => void;
  removeSong: (id: string) => Promise<void>;
  clearFailed: () => void;
  isDownloaded: (youtubeId: string) => boolean;
  isDownloading: (youtubeId: string) => boolean;
  getProgress: (youtubeId: string) => DownloadProgress | null;
  getBlobUrl: (youtubeId: string) => string | null;
  resolveSongUrl: (song: Song) => Song;
  setOnline: (online: boolean) => void;
  refreshCacheSize: () => Promise<void>;
}

// Active abort controllers keyed by youtubeId
const activeControllers = new Map<string, AbortController>();

export const useDownloadsStore = create<DownloadsState>((set, get) => ({
  downloads: [],
  downloadingIds: new Set(),
  progressMap: {},
  loading: false,
  isOnline: navigator.onLine,
  cacheSize: 0,
  blobUrlCache: {},
  failedDownloads: [],

  loadDownloads: async () => {
    const state = get();
    if (state.downloads.length > 0 && !state.loading) return;
    set({ loading: true });
    try {
      const all = await getAllDownloads();
      all.sort((a, b) => b.downloadedAt - a.downloadedAt);
      const cacheSize = await getCacheSize();
      set({ downloads: all, loading: false, cacheSize });
    } catch {
      set({ loading: false });
    }
  },

  downloadSong: async (song: Song) => {
    if (!song.youtubeId && !song.audioUrl) return;
    const state = get();
    const key = song.youtubeId || song.id;
    if (state.downloadingIds.has(key)) return;
    let already = false;
    try {
      already = await isDownloaded(key);
    } catch {
      console.error('[DownloadsStore] isDownloaded check failed, proceeding anyway');
    }
    if (already) return;

    const controller = new AbortController();
    activeControllers.set(key, controller);

    set({ downloadingIds: new Set([...state.downloadingIds, key]) });

    try {
      const entry = await downloadSongWithProgress(
        {
          id: song.id,
          youtubeId: song.youtubeId || song.id,
          title: song.title,
          artist: song.artist,
          genre: song.genre,
          duration: song.duration,
          coverArt: song.coverArt,
          audioUrl: song.audioUrl,
        },
        (progress) => {
          if (controller.signal.aborted) return;
          set((s) => ({
            progressMap: { ...s.progressMap, [key]: progress },
          }));
        },
        controller.signal,
      );

      activeControllers.delete(key);

      if (controller.signal.aborted) return;

      evictOldCache().catch(() => {});

      set((s) => {
        const newIds = new Set(s.downloadingIds);
        newIds.delete(key);
        const newProgress = { ...s.progressMap };
        delete newProgress[key];
        return {
          downloads: [entry, ...s.downloads],
          downloadingIds: newIds,
          progressMap: newProgress,
        };
      });
    } catch (e) {
      activeControllers.delete(key);
      if (controller.signal.aborted) return;

      console.error('Download failed:', e);
      const msg = e instanceof Error ? e.message : 'Download failed';
      set((s) => {
        const newIds = new Set(s.downloadingIds);
        newIds.delete(key);
        const newProgress = { ...s.progressMap };
        delete newProgress[key];
        return {
          downloadingIds: newIds,
          progressMap: newProgress,
          failedDownloads: [...s.failedDownloads, { song, message: msg, timestamp: Date.now() }],
        };
      });
    }
  },

  cancelDownload: (youtubeId: string) => {
    const controller = activeControllers.get(youtubeId);
    if (controller) {
      controller.abort();
      activeControllers.delete(youtubeId);
    }
    set((s) => {
      const newIds = new Set(s.downloadingIds);
      newIds.delete(youtubeId);
      const newProgress = { ...s.progressMap };
      delete newProgress[youtubeId];
      return { downloadingIds: newIds, progressMap: newProgress };
    });
  },

  retryDownload: (song: Song) => {
    const key = song.youtubeId || song.id;
    set((s) => ({
      failedDownloads: s.failedDownloads.filter(f =>
        (f.song.youtubeId || f.song.id) !== key
      ),
    }));
    get().downloadSong(song);
  },

  removeSong: async (id: string) => {
    await removeDownload(id);
    set((s) => {
      const blobUrl = s.blobUrlCache[id];
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      const { [id]: _, ...rest } = s.blobUrlCache;
      return { downloads: s.downloads.filter((d) => d.id !== id), blobUrlCache: rest };
    });
  },

  clearFailed: () => set({ failedDownloads: [] }),

  isDownloaded: (youtubeId: string) => get().downloads.some((d) => d.youtubeId === youtubeId || d.id === youtubeId),
  isDownloading: (youtubeId: string) => get().downloadingIds.has(youtubeId),
  getProgress: (youtubeId: string) => get().progressMap[youtubeId] || null,

  getBlobUrl: (youtubeId: string) => {
    const state = get();
    const download = state.downloads.find((d) => d.youtubeId === youtubeId || d.id === youtubeId);
    if (!download?.audioBlob) return null;
    const cached = state.blobUrlCache[download.id];
    if (cached) return cached;
    const url = URL.createObjectURL(download.audioBlob);
    set((s) => ({ blobUrlCache: { ...s.blobUrlCache, [download.id]: url } }));
    return url;
  },

  resolveSongUrl: (song: Song) => {
    const blobUrl = get().getBlobUrl(song.youtubeId || song.id);
    if (blobUrl) return { ...song, audioUrl: blobUrl };
    return song;
  },

  setOnline: (online: boolean) => set({ isOnline: online }),

  refreshCacheSize: async () => {
    try {
      const cacheSize = await getCacheSize();
      set({ cacheSize });
    } catch {
      console.error('[DownloadsStore] Failed to refresh cache size');
    }
  },
}));

// Wire up online/offline event listeners (runs once at import)
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    useDownloadsStore.getState().setOnline(true);
  });
  window.addEventListener('offline', () => {
    useDownloadsStore.getState().setOnline(false);
  });
}
