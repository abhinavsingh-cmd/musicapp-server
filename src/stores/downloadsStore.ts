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
  getStorageBreakdown,
  clearThumbnailCache,
  pauseDownload,
  resumeDownload,
  DownloadedSong,
  DownloadProgress,
} from '../utils/downloadManager';
import { metricsCollector } from '../services/metricsCollector';

export type DownloadError = {
  song: Song;
  message: string;
  timestamp: number;
};

export type DownloadQueueItem = {
  song: Song;
  addedAt: number;
};

export interface DownloadsState {
  downloads: DownloadedSong[];
  downloadingIds: Set<string>;
  progressMap: Record<string, DownloadProgress>;
  pausedIds: Set<string>;
  loading: boolean;
  isOnline: boolean;
  cacheSize: number;
  blobUrlCache: Record<string, string>;
  failedDownloads: DownloadError[];
  downloadQueue: DownloadQueueItem[];
  maxParallel: number;
  storageBreakdown: { songs: number; thumbnails: number; total: number } | null;

  loadDownloads: () => Promise<void>;
  downloadSong: (song: Song) => Promise<void>;
  cancelDownload: (youtubeId: string) => void;
  pauseDownloadAction: (youtubeId: string) => void;
  resumeDownloadAction: (youtubeId: string) => void;
  retryDownload: (song: Song) => void;
  removeSong: (id: string) => Promise<void>;
  clearFailed: () => void;
  isDownloaded: (youtubeId: string) => boolean;
  isDownloading: (youtubeId: string) => boolean;
  isPaused: (youtubeId: string) => boolean;
  getProgress: (youtubeId: string) => DownloadProgress | null;
  getBlobUrl: (youtubeId: string) => string | null;
  resolveSongUrl: (song: Song) => Song;
  setOnline: (online: boolean) => void;
  refreshCacheSize: () => Promise<void>;
  clearDownloads: () => Promise<void>;
  refreshStorageBreakdown: () => Promise<void>;
  clearThumbnailCacheAction: () => Promise<void>;
}

// Active abort controllers keyed by youtubeId
const activeControllers = new Map<string, AbortController>();

// Track active download count
let activeDownloadCount = 0;

export const useDownloadsStore = create<DownloadsState>((set, get) => ({
  downloads: [],
  downloadingIds: new Set(),
  progressMap: {},
  pausedIds: new Set(),
  loading: false,
  isOnline: navigator.onLine,
  cacheSize: 0,
  blobUrlCache: {},
  failedDownloads: [],
  downloadQueue: [],
  maxParallel: 3,
  storageBreakdown: null,

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

    // If at max parallel downloads, add to queue
    if (activeDownloadCount >= state.maxParallel) {
      const inQueue = state.downloadQueue.some(q => (q.song.youtubeId || q.song.id) === key);
      if (!inQueue) {
        set((s) => ({
          downloadQueue: [...s.downloadQueue, { song, addedAt: Date.now() }],
        }));
        // Show notification
        sendDownloadNotification(`"${song.title}" added to download queue`);
      }
      return;
    }

    activeDownloadCount++;
    const controller = new AbortController();
    activeControllers.set(key, controller);

    set((s) => ({
      downloadingIds: new Set([...s.downloadingIds, key]),
    }));

    // Show notification
    sendDownloadNotification(`Downloading "${song.title}"`);

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
      activeDownloadCount--;

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

      // Show success notification
      sendDownloadNotification(`"${song.title}" downloaded successfully`);

      // Process queue
      processQueue();
    } catch (e) {
      activeControllers.delete(key);
      activeDownloadCount--;

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

      // Show error notification
      sendDownloadNotification(`Failed to download "${song.title}": ${msg}`);

      // Process queue
      processQueue();
    }
  },

  cancelDownload: (youtubeId) => {
    const controller = activeControllers.get(youtubeId);
    if (controller) {
      controller.abort();
      activeControllers.delete(youtubeId);
      activeDownloadCount--;
    }
    set((s) => {
      const newIds = new Set(s.downloadingIds);
      newIds.delete(youtubeId);
      const newProgress = { ...s.progressMap };
      delete newProgress[youtubeId];
      const newPaused = new Set(s.pausedIds);
      newPaused.delete(youtubeId);
      return { downloadingIds: newIds, progressMap: newProgress, pausedIds: newPaused };
    });
    // Process queue after cancel
    processQueue();
  },

  pauseDownloadAction: (youtubeId) => {
    pauseDownload(youtubeId);
    set((s) => {
      const newPaused = new Set(s.pausedIds);
      newPaused.add(youtubeId);
      return { pausedIds: newPaused };
    });
  },

  resumeDownloadAction: (youtubeId) => {
    resumeDownload(youtubeId);
    set((s) => {
      const newPaused = new Set(s.pausedIds);
      newPaused.delete(youtubeId);
      return { pausedIds: newPaused };
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
  isPaused: (youtubeId) => get().pausedIds.has(youtubeId),
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

  refreshStorageBreakdown: async () => {
    try {
      const breakdown = await getStorageBreakdown();
      set({ storageBreakdown: breakdown });
    } catch {
      console.error('[DownloadsStore] Failed to get storage breakdown');
    }
  },

  clearDownloads: async () => {
    try {
      // Cancel all active downloads
      for (const [, ctrl] of activeControllers) {
        ctrl.abort();
      }
      activeControllers.clear();
      activeDownloadCount = 0;

      await clearAllDownloads();

      // Clear memory cache and state
      set({
        downloads: [],
        downloadingIds: new Set(),
        progressMap: {},
        pausedIds: new Set(),
        blobUrlCache: {},
        failedDownloads: [],
        downloadQueue: [],
        cacheSize: 0,
        storageBreakdown: null,
        loading: false,
      });
    } catch (error) {
      console.error('[DownloadsStore] Failed to clear downloads:', error);
    }
  },

  clearThumbnailCacheAction: async () => {
    try {
      await clearThumbnailCache();
      await get().refreshCacheSize();
    } catch {
      console.error('[DownloadsStore] Failed to clear thumbnail cache');
    }
  },
}));

// ---------------------------------------------------------------------------
// Queue processing
// ---------------------------------------------------------------------------

function processQueue() {
  const state = useDownloadsStore.getState();
  if (state.downloadQueue.length === 0) return;
  if (activeDownloadCount >= state.maxParallel) return;

  const next = state.downloadQueue[0];
  if (!next) return;

  useDownloadsStore.setState((s) => ({
    downloadQueue: s.downloadQueue.slice(1),
  }));

  useDownloadsStore.getState().downloadSong(next.song);
}

// ---------------------------------------------------------------------------
// Background notifications
// ---------------------------------------------------------------------------

function sendDownloadNotification(message: string) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('MusicApp', { body: message, icon: '/logo-icon.svg', silent: true });
    }
  } catch {}
}

// ---------------------------------------------------------------------------
// Wire up online/offline event listeners (deferred)
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined') {
  const deferInit = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (cb: IdleRequestCallback) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 0);
  deferInit(() => {
    window.addEventListener('online', () => {
      useDownloadsStore.getState().setOnline(true);
      // Resume queued downloads when coming back online
      processQueue();
    });
    window.addEventListener('offline', () => {
      useDownloadsStore.getState().setOnline(false);
    });

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      // Don't request immediately — wait for user interaction
    }
  });
}
