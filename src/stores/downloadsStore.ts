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

export interface DownloadsState {
  downloads: DownloadedSong[];
  downloadingIds: Set<string>;
  /** Map of youtubeId → current progress (0-100) */
  progressMap: Record<string, DownloadProgress>;
  loading: boolean;
  isOnline: boolean;
  cacheSize: number;
  /** Cache of blob URLs keyed by download id */
  blobUrlCache: Record<string, string>;

  loadDownloads: () => Promise<void>;
  downloadSong: (song: Song) => Promise<void>;
  removeSong: (id: string) => Promise<void>;
  isDownloaded: (youtubeId: string) => boolean;
  isDownloading: (youtubeId: string) => boolean;
  getProgress: (youtubeId: string) => DownloadProgress | null;
  getBlobUrl: (youtubeId: string) => string | null;
  setOnline: (online: boolean) => void;
  refreshCacheSize: () => Promise<void>;
}

export const useDownloadsStore = create<DownloadsState>((set, get) => ({
  downloads: [],
  downloadingIds: new Set(),
  progressMap: {},
  loading: false,
  isOnline: navigator.onLine,
  cacheSize: 0,
  blobUrlCache: {},

  loadDownloads: async () => {
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
    const already = await isDownloaded(key);
    if (already) return;

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
          set((s) => ({
            progressMap: { ...s.progressMap, [key]: progress },
          }));
        },
      );

      // Auto-evict if cache exceeds limit
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
      console.error('Download failed:', e);
      set((s) => {
        const newIds = new Set(s.downloadingIds);
        newIds.delete(key);
        const newProgress = { ...s.progressMap };
        delete newProgress[key];
        return { downloadingIds: newIds, progressMap: newProgress };
      });
    }
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

  setOnline: (online: boolean) => set({ isOnline: online }),

  refreshCacheSize: async () => {
    const cacheSize = await getCacheSize();
    set({ cacheSize });
  },
}));
