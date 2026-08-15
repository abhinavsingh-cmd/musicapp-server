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
  repairDownloads,
  isValidBlob,
  isTransientDownloadError,
  DownloadedSong,
  DownloadProgress,
} from '../utils/downloadManager';
import { metricsCollector } from '../services/metricsCollector';
import { logger } from '../utils/logger';

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

// Cancel requests that arrived before the download's controller was
// registered (the download is still resolving its stream URL).
const cancelledKeys = new Set<string>();

// Track active download count
let activeDownloadCount = 0;

// ---------------------------------------------------------------------------
// Automatic retry for transient failures
//
// Network blips, dropped connections and truncated transfers should not
// require a manual retry tap. Transient failures (see
// isTransientDownloadError) are retried automatically with backoff; the
// original error reason is preserved and only surfaced after the final
// attempt fails. Deterministic failures (expired link, 404, non-audio
// payload) are never auto-retried.
// ---------------------------------------------------------------------------
const MAX_AUTO_RETRIES = 2;
const RETRY_DELAYS_MS = [1000, 3000];
const retryAttempts = new Map<string, number>();
const pendingRetries = new Map<string, ReturnType<typeof setTimeout>>();

function clearPendingRetry(key: string): void {
  const timer = pendingRetries.get(key);
  if (timer) {
    clearTimeout(timer);
    pendingRetries.delete(key);
  }
  retryAttempts.delete(key);
}

/** Cancel only the scheduled timer — the attempt budget stays intact. */
function cancelRetryTimer(key: string): void {
  const timer = pendingRetries.get(key);
  if (timer) {
    clearTimeout(timer);
    pendingRetries.delete(key);
  }
}

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
      // Remove entries with corrupted/missing blobs before loading
      await repairDownloads();
      const all = await getAllDownloads();
      // Belt-and-suspenders: filter out any entries with invalid blobs
      // that repairDownloads might have missed
      const valid = all.filter(d => isValidBlob(d.audioBlob));
      valid.sort((a, b) => b.downloadedAt - a.downloadedAt);
      const cacheSize = await getCacheSize();
      set({ downloads: valid, loading: false, cacheSize });
    } catch {
      set({ loading: false });
    }
  },

  downloadSong: async (song) => {
    if (!song.youtubeId && !song.audioUrl) return;
    const key = song.youtubeId || song.id;

    // Claim the key synchronously so two taps in the same tick cannot start
    // two downloads for the same song.
    if (get().downloadingIds.has(key)) return;
    set((s) => ({
      downloadingIds: new Set([...s.downloadingIds, key]),
    }));

    let already = false;
    try {
      already = await isDownloaded(key);
    } catch {
      logger.error('[DownloadsStore] isDownloaded check failed, proceeding anyway');
    }
    if (already) {
      set((s) => {
        const newIds = new Set(s.downloadingIds);
        newIds.delete(key);
        return { downloadingIds: newIds };
      });
      return;
    }

    // If at max parallel downloads, add to queue
    const current = get();
    if (activeDownloadCount >= current.maxParallel) {
      const inQueue = current.downloadQueue.some(q => (q.song.youtubeId || q.song.id) === key);
      if (!inQueue) {
        set((s) => ({
          downloadQueue: [...s.downloadQueue, { song, addedAt: Date.now() }],
        }));
        // Show notification
        sendDownloadNotification(`"${song.title}" added to download queue`);
      }
      // Release the in-flight claim — the queued item will re-claim when the
      // queue is processed.
      set((s) => {
        const newIds = new Set(s.downloadingIds);
        newIds.delete(key);
        return { downloadingIds: newIds };
      });
      return;
    }

    activeDownloadCount++;
    const controller = new AbortController();
    activeControllers.set(key, controller);

    // A cancel arrived while the stream URL was being resolved — abort now.
    if (cancelledKeys.has(key)) {
      cancelledKeys.delete(key);
      controller.abort();
      activeControllers.delete(key);
      if (activeDownloadCount > 0) activeDownloadCount--;
      set((s) => {
        const newIds = new Set(s.downloadingIds);
        newIds.delete(key);
        return { downloadingIds: newIds };
      });
      return;
    }

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
      if (activeDownloadCount > 0) activeDownloadCount--;

      if (controller.signal.aborted) return;

      evictOldCache().catch(() => {});
      retryAttempts.delete(key);

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
      if (activeDownloadCount > 0) activeDownloadCount--;

      if (controller.signal.aborted) return;

      logger.error('Download failed:', e);
      const msg = e instanceof Error ? e.message : 'Download failed';

      // Transient failure with retries left: schedule an automatic retry
      // instead of surfacing the error. The failed-download entry is only
      // created once every attempt has been exhausted, so the preserved
      // reason always comes from the final attempt.
      const attempts = retryAttempts.get(key) || 0;
      if (isTransientDownloadError(e) && attempts < MAX_AUTO_RETRIES && !cancelledKeys.has(key) && navigator.onLine) {
        retryAttempts.set(key, attempts + 1);
        const delay = RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length - 1)];
        logger.warn(`[DownloadsStore] Transient failure for "${song.title}" (${msg}) — auto-retry ${attempts + 1}/${MAX_AUTO_RETRIES} in ${delay}ms`);
        cancelRetryTimer(key);
        pendingRetries.set(key, setTimeout(() => {
          pendingRetries.delete(key);
          if (cancelledKeys.has(key)) { retryAttempts.delete(key); return; }
          if (get().downloadingIds.has(key)) return;
          void get().downloadSong(song);
        }, delay));
        set((s) => {
          const newIds = new Set(s.downloadingIds);
          newIds.delete(key);
          const newProgress = { ...s.progressMap };
          delete newProgress[key];
          return { downloadingIds: newIds, progressMap: newProgress };
        });
        return;
      }
      retryAttempts.delete(key);

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
    // A pending auto-retry must die with the cancel — otherwise the song
    // would start downloading again seconds after the user cancelled it.
    clearPendingRetry(youtubeId);
    const controller = activeControllers.get(youtubeId);
    if (controller) {
      controller.abort();
      activeControllers.delete(youtubeId);
      // Note: activeDownloadCount is NOT decremented here — the settling
      // downloadSong promise always decrements exactly once (success or
      // catch path). Decrementing here too would double-decrement and
      // eventually allow more parallel downloads than maxParallel.
    } else if (get().downloadingIds.has(youtubeId)) {
      // The download is still being set up — flag it so downloadSong aborts
      // as soon as its controller is registered. Only flag keys that are
      // actually in flight: a stale flag would silently self-abort the NEXT
      // download attempt for this song.
      cancelledKeys.add(youtubeId);
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
    // Manual retry resets the auto-retry budget — the user explicitly asked
    // for another attempt.
    clearPendingRetry(key);
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

  isDownloaded: (youtubeId) => {
    const state = get();
    const download = state.downloads.find((d) => d.youtubeId === youtubeId || d.id === youtubeId);
    // Must verify the blob is actually valid — a corrupted/evicted blob means
    // the song is NOT truly downloaded for offline playback.
    return !!download && isValidBlob(download.audioBlob);
  },
  isDownloading: (youtubeId) => get().downloadingIds.has(youtubeId),
  isPaused: (youtubeId) => get().pausedIds.has(youtubeId),
  getProgress: (youtubeId) => get().progressMap[youtubeId] || null,

  getBlobUrl: (youtubeId) => {
    const state = get();
    const download = state.downloads.find((d) => d.youtubeId === youtubeId || d.id === youtubeId);
    // Verify the blob is valid before creating an ObjectURL — a corrupted or
    // evicted blob would create a URL that silently fails to play.
    if (!download || !isValidBlob(download.audioBlob)) return null;
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
      logger.error('[DownloadsStore] Failed to refresh cache size');
    }
  },

  refreshStorageBreakdown: async () => {
    try {
      const breakdown = await getStorageBreakdown();
      set({ storageBreakdown: breakdown });
    } catch {
      logger.error('[DownloadsStore] Failed to get storage breakdown');
    }
  },

  clearDownloads: async () => {
    try {
      // Cancel all active downloads
      for (const [, ctrl] of activeControllers) {
        ctrl.abort();
      }
      activeControllers.clear();
      cancelledKeys.clear();
      for (const timer of pendingRetries.values()) clearTimeout(timer);
      pendingRetries.clear();
      retryAttempts.clear();
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
      logger.error('[DownloadsStore] Failed to clear downloads:', error);
    }
  },

  clearThumbnailCacheAction: async () => {
    try {
      await clearThumbnailCache();
      await get().refreshCacheSize();
    } catch {
      logger.error('[DownloadsStore] Failed to clear thumbnail cache');
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
