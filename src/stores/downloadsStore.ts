import { create } from 'zustand';
import { Song } from '../types/music';
import {
  getAllDownloads,
  removeDownload,
  isDownloaded,
  downloadSongWithProgress,
  evictOldCache,
  getCacheSize,
  clearAllDownloads,
  DownloadedSong,
  DownloadProgress,
} from '../utils/downloadManager';
import { metricsCollector } from '../services/metricsCollector';

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
  clearDownloads: () => Promise<void>;
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

  downloadSong: async (song) => {
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

    const dlStartTime = Date.now();

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

          // Track download speed
          if (progress.loaded > 0 && progress.total > 0) {
            const elapsed = (Date.now() - (dlStartTime || Date.now())) / 1000;
            if (elapsed > 0.5) {
              metricsCollector.pushDownloadSpeed({
                bytesPerSecond: progress.loaded / elapsed,
                timestamp: Date.now(),
              });
            }
          }
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

  cancelDownload: (youtubeId) => {
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

  retryDownload: (song) => {
    const key = song.youtubeId || song.id;
    set((s) => ({
      failedDownloads: s.failedDownloads.filter(f =>
        (f.song.youtubeId || f.song.id) !== key
      ),
    }));
    get().downloadSong(song);
  },

  removeSong: async (id) => {
    await removeDownload(id);
    set((s) => {
      const blobUrl = s.blobUrlCache[id];
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      const { [id]: _, ...rest } = s.blobUrlCache;
      return { downloads: s.downloads.filter((d) => d.id !== id), blobUrlCache: rest };
    });
  },

  clearFailed: () => set({ failedDownloads: [] }),

  isDownloaded: (youtubeId) => get().downloads.some((d) => d.youtubeId === youtubeId || d.id === youtubeId),
  isDownloading: (youtubeId) => get().downloadingIds.has(youtubeId),
  getProgress: (youtubeId) => get().progressMap[youtubeId] || null,

  getBlobUrl: (youtubeId) => {
    const state = get();
    const download = state.downloads.find((d) => d.youtubeId === youtubeId || d.id === youtubeId);
    if (!download?.audioBlob) return null;
    const cached = state.blobUrlCache[download.id];
    if (cached) return cached;
    const url = URL.createObjectURL(download.audioBlob);
    set((s) => ({ blobUrlCache: { ...s.blobUrlCache, [download.id]: url } }));
    return url;
  },

  resolveSongUrl: (song) => {
    const blobUrl = get().getBlobUrl(song.youtubeId || song.id);
    if (blobUrl) return { ...song, audioUrl: blobUrl };
    return song;
  },

  setOnline: (online) => set({ isOnline: online }),

  refreshCacheSize: async () => {
    try {
      const cacheSize = await getCacheSize();
      set({ cacheSize });
    } catch {
      console.error('[DownloadsStore] Failed to refresh cache size');
    }
  },

  clearDownloads: async () => {
    try {
      await clearAllDownloads();
      
      // Clear memory cache and state
      set({
        downloads: [],
        downloadingIds: new Set(),
        progressMap: {},
        blobUrlCache: {},
        failedDownloads: [],
        cacheSize: 0,
        loading: false,
      });
    } catch (error) {
      console.error('[DownloadsStore] Failed to clear downloads:', error);
    }
  },
}));

// Wire up online/offline event listeners (deferred)
if (typeof window !== 'undefined') {
  const deferInit = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (cb: IdleRequestCallback) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 0);
  deferInit(() => {
    window.addEventListener('online', () => {
      useDownloadsStore.getState().setOnline(true);
    });
    window.addEventListener('offline', () => {
      useDownloadsStore.getState().setOnline(false);
    });
  });
}
