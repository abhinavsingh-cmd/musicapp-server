import { create } from 'zustand';
import { Song } from '../types/music';
import { preloadNextSongs as preload } from '../services/preloadService';

const QUEUE_KEY = 'playback-queue';
const MAX_RECENT = 50;
const MIN_QUEUE_SIZE = 10;

function loadQueue(): { queue: Song[]; currentIndex: number; repeatMode: RepeatMode; isShuffled: boolean; autoplayEnabled: boolean; originalQueue: Song[] } {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return { queue: [], currentIndex: 0, repeatMode: 'off', isShuffled: false, autoplayEnabled: true, originalQueue: [] };
    const parsed = JSON.parse(raw);
    return {
      queue: parsed.queue || [],
      currentIndex: parsed.currentIndex || 0,
      repeatMode: parsed.repeatMode || 'off',
      isShuffled: parsed.isShuffled || false,
      autoplayEnabled: parsed.autoplayEnabled !== false,
      originalQueue: parsed.originalQueue || [],
    };
  } catch {
    return { queue: [], currentIndex: 0, repeatMode: 'off', isShuffled: false, autoplayEnabled: true, originalQueue: [] };
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(state: QueueState): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify({
        queue: state.queue,
        currentIndex: state.currentIndex,
        repeatMode: state.repeatMode,
        isShuffled: state.isShuffled,
        autoplayEnabled: state.autoplayEnabled,
        originalQueue: state.originalQueue,
      }));
    } catch { }
    persistTimer = null;
  }, 500);
}

function loadRecent(): Song[] {
  try {
    return JSON.parse(localStorage.getItem('recently-played') || '[]');
  } catch { return []; }
}

let recentPersistTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRecentPersist(songs: Song[]): void {
  if (recentPersistTimer) clearTimeout(recentPersistTimer);
  recentPersistTimer = setTimeout(() => {
    try {
      localStorage.setItem('recently-played', JSON.stringify(songs.slice(0, MAX_RECENT)));
    } catch { }
    recentPersistTimer = null;
  }, 500);
}

export type RepeatMode = 'off' | 'all' | 'one';

export interface QueueState {
  queue: Song[];
  currentIndex: number;
  recentlyPlayed: Song[];
  repeatMode: RepeatMode;
  isShuffled: boolean;
  originalQueue: Song[];
  autoplayEnabled: boolean;
  isFetchingRecommendations: boolean;

  setQueue: (songs: Song[], startIndex?: number) => void;
  restoreQueue: (saved: { queue: Song[]; currentIndex: number; repeatMode: RepeatMode; isShuffled: boolean; originalQueue: Song[]; autoplayEnabled: boolean }) => void;
  playAtIndex: (index: number) => void;
  nextSong: () => Promise<Song | null>;
  previousSong: () => Promise<Song | null>;

  addToQueue: (song: Song) => void;
  addNext: (song: Song) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  clearQueue: () => void;
  shuffleQueue: () => void;
  unshuffleQueue: () => void;

  toggleShuffle: () => void;
  cycleRepeat: () => void;
  toggleAutoplay: () => void;

  addRecent: (song: Song) => void;
  clearRecent: () => void;

  ensureQueueSize: () => Promise<void>;
  preloadNextSongs: () => Promise<void>;
  appendRecommendations: (songs: Song[]) => Promise<void>;
  init: () => Promise<void>;
}

let initPromise: Promise<void> | null = null;

function initQueueStore() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (typeof window === 'undefined') return;
    const saved = loadQueue();
    const recent = loadRecent();
    useQueueStore.setState({
      queue: saved.queue,
      currentIndex: saved.currentIndex,
      recentlyPlayed: recent,
      repeatMode: saved.repeatMode,
      isShuffled: saved.isShuffled,
      originalQueue: saved.originalQueue,
      autoplayEnabled: saved.autoplayEnabled,
    });
  })();
  return initPromise;
}

export const useQueueStore = create<QueueState>((set, get) => ({
  queue: [],
  currentIndex: 0,
  recentlyPlayed: [],
  repeatMode: 'off',
  isShuffled: false,
  originalQueue: [],
  autoplayEnabled: true,
  isFetchingRecommendations: false,

  init: async () => {
    await initQueueStore();
  },

  setQueue: (songs, startIndex = 0) => {
    if (songs.length === 0) return;
    const safeIndex = Math.max(0, Math.min(startIndex, songs.length - 1));
    const song = songs[safeIndex];
    set({
      queue: songs,
      currentIndex: safeIndex,
      isShuffled: false,
      originalQueue: [],
    });
    schedulePersist(get());
    if (song) get().addRecent(song);
  },

  restoreQueue: (saved) => {
    set({
      queue: saved.queue,
      currentIndex: Math.max(0, Math.min(saved.currentIndex, Math.max(0, saved.queue.length - 1))),
      repeatMode: saved.repeatMode,
      isShuffled: saved.isShuffled,
      originalQueue: saved.originalQueue,
      autoplayEnabled: saved.autoplayEnabled,
    });
    schedulePersist(get());
  },

  playAtIndex: async (index) => {
    const { queue } = get();
    if (index < 0 || index >= queue.length) return;
    const song = queue[index];
    const { useAudioStore } = await import('./audioStore');
    useAudioStore.getState().loadSong(song, queue, index);
  },

  nextSong: async () => {
    const { queue, currentIndex, repeatMode, isShuffled, autoplayEnabled } = get();
    if (queue.length === 0) return null;

    if (repeatMode === 'one') {
      const song = queue[currentIndex];
      return song;
    }

    let nextIndex: number;
    if (isShuffled) {
      if (queue.length === 1) {
        if (repeatMode === 'all') {
          nextIndex = 0;
        } else {
          return null;
        }
      } else {
        nextIndex = Math.floor(Math.random() * queue.length);
        while (nextIndex === currentIndex && queue.length > 1) {
          nextIndex = Math.floor(Math.random() * queue.length);
        }
      }
    } else {
      nextIndex = currentIndex + 1;
      if (nextIndex >= queue.length) {
        if (repeatMode === 'all') {
          nextIndex = 0;
        } else if (autoplayEnabled && currentIndex === queue.length - 1) {
          await get().ensureQueueSize();
          const newQueue = get().queue;
          if (newQueue.length > queue.length) {
            return get().nextSong();
          }
          return null;
        } else {
          return null;
        }
      }
    }

    const song = queue[nextIndex];
    set({ currentIndex: nextIndex });
    schedulePersist(get());
    get().addRecent(song);
    
    if (autoplayEnabled && nextIndex >= queue.length - 3) {
      get().ensureQueueSize();
    }
    
    get().preloadNextSongs();
    return song;
  },

  previousSong: async () => {
    const { queue, currentIndex, isShuffled, repeatMode } = get();
    if (queue.length === 0) return null;

    if (repeatMode === 'one') {
      const song = queue[currentIndex];
      return song;
    }

    let prevIndex: number;
    if (isShuffled) {
      prevIndex = (currentIndex - 1 + queue.length) % queue.length;
    } else {
      prevIndex = (currentIndex - 1 + queue.length) % queue.length;
    }

    const song = queue[prevIndex];
    set({ currentIndex: prevIndex });
    schedulePersist(get());
    get().addRecent(song);
    return song;
  },

  addToQueue: (song) => {
    set((s) => ({ queue: [...s.queue, song] }));
    schedulePersist(get());
  },

  addNext: (song) => {
    set((s) => {
      const insertAt = s.currentIndex + 1;
      const newQueue = [...s.queue];
      newQueue.splice(insertAt, 0, song);
      return { queue: newQueue };
    });
    schedulePersist(get());
  },

  removeFromQueue: (index) => {
    const { queue, currentIndex } = get();
    if (index < 0 || index >= queue.length) return;
    const removedSong = queue[index];
    const newQueue = queue.filter((_, i) => i !== index);
    let newIndex = currentIndex;
    if (index < currentIndex) {
      newIndex = currentIndex - 1;
    } else if (index === currentIndex) {
      newIndex = Math.min(currentIndex, newQueue.length - 1);
    }
    set({ queue: newQueue, currentIndex: Math.max(0, newIndex) });
    schedulePersist(get());

    // Keep playback in sync: if the removed song is the currently loaded one,
    // re-load the new current song so the audible track and queue agree.
    if (index === currentIndex && removedSong) {
      const newCurrent = newQueue[Math.max(0, newIndex)];
      if (newCurrent) {
        void (async () => {
          const { useAudioStore } = await import('./audioStore');
          const audioStore = useAudioStore.getState();
          if (audioStore.currentSong?.id === removedSong.id && audioStore.isPlaying) {
            audioStore.loadSong(newCurrent, newQueue, Math.max(0, newIndex));
          }
        })();
      }
    }
  },

  reorderQueue: (fromIndex, toIndex) => {
    set((s) => {
      const q = [...s.queue];
      const [moved] = q.splice(fromIndex, 1);
      q.splice(toIndex, 0, moved);
      let newCurrent = s.currentIndex;
      if (s.currentIndex === fromIndex) {
        newCurrent = toIndex;
      } else if (fromIndex < s.currentIndex && toIndex >= s.currentIndex) {
        newCurrent = s.currentIndex - 1;
      } else if (fromIndex > s.currentIndex && toIndex <= s.currentIndex) {
        newCurrent = s.currentIndex + 1;
      }
      return { queue: q, currentIndex: newCurrent };
    });
    schedulePersist(get());
  },

  clearQueue: () => {
    set({ queue: [], currentIndex: 0, isShuffled: false, originalQueue: [] });
    schedulePersist(get());
  },

  shuffleQueue: () => {
    const { queue, currentIndex } = get();
    if (queue.length <= 1) return;
    const current = queue[currentIndex];
    const others = queue.filter((_, i) => i !== currentIndex);
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [others[i], others[j]] = [others[j], others[i]];
    }
    set({
      originalQueue: queue,
      queue: [current, ...others],
      currentIndex: 0,
      isShuffled: true,
    });
    schedulePersist(get());
  },

  unshuffleQueue: () => {
    const { originalQueue, currentIndex } = get();
    if (originalQueue.length === 0) return;
    const currentSong = get().queue[currentIndex];
    const idx = originalQueue.findIndex((s) => s.id === currentSong?.id);
    set({
      queue: originalQueue,
      currentIndex: idx >= 0 ? idx : 0,
      isShuffled: false,
      originalQueue: [],
    });
    schedulePersist(get());
  },

  toggleShuffle: () => {
    const { isShuffled } = get();
    if (isShuffled) {
      get().unshuffleQueue();
    } else {
      get().shuffleQueue();
    }
  },

  cycleRepeat: () => {
    set((s) => {
      const modes: RepeatMode[] = ['off', 'all', 'one'];
      const next = modes[(modes.indexOf(s.repeatMode) + 1) % modes.length];
      return { repeatMode: next };
    });
    schedulePersist(get());
  },

  toggleAutoplay: () => {
    set((s) => ({ autoplayEnabled: !s.autoplayEnabled }));
    schedulePersist(get());
  },

  addRecent: (song) => {
    if (!song || !song.id) return;
    set((s) => {
      const filtered = s.recentlyPlayed.filter((r) => r.id !== song.id);
      const updated = [song, ...filtered].slice(0, MAX_RECENT);
      scheduleRecentPersist(updated);
      return { recentlyPlayed: updated };
    });
  },

  clearRecent: () => {
    set({ recentlyPlayed: [] });
    try { localStorage.removeItem('recently-played'); } catch {}
  },

  ensureQueueSize: async () => {
    const { queue, currentIndex, autoplayEnabled, isFetchingRecommendations } = get();
    if (!autoplayEnabled || isFetchingRecommendations || queue.length >= MIN_QUEUE_SIZE) return;
    
    set({ isFetchingRecommendations: true });
    
    try {
      const { getRecommendations } = await import('../services/recommendationService');
      const currentSong = queue[currentIndex];
      const excludeIds = new Set(queue.map(s => s.id));
      
      const recommendations = await getRecommendations({
        seedSong: currentSong,
        limit: MIN_QUEUE_SIZE - queue.length + 5,
        excludeIds,
      });
      
      if (recommendations.length > 0) {
        get().appendRecommendations(recommendations);
      }
    } catch (error) {
      console.error('Failed to fetch recommendations:', error);
      try {
        const { getRecommendations } = await import('../services/recommendationService');
        const fallback = await getRecommendations({ limit: MIN_QUEUE_SIZE, excludeIds: new Set(queue.map(s => s.id)) });
        if (fallback.length > 0) {
          get().appendRecommendations(fallback);
        }
      } catch (fallbackError) {
        console.error('Fallback recommendations also failed:', fallbackError);
      }
    } finally {
      set({ isFetchingRecommendations: false });
    }
  },

  preloadNextSongs: async () => {
    const { queue, currentIndex } = get();
    preload(queue, currentIndex, { count: 3 });
  },

  appendRecommendations: async (songs: Song[]) => {
    const { queue } = get();
    const existingIds = new Set(queue.map(s => s.id));
    const newSongs = songs.filter(s => !existingIds.has(s.id));
    
    if (newSongs.length > 0) {
      set((s) => ({ queue: [...s.queue, ...newSongs] }));
      schedulePersist(get());
      const newIdx = get().currentIndex;
      preload(get().queue, newIdx, { count: 3 });
    }
  },
}));

if (typeof window !== 'undefined') {
  const deferInit = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (cb: IdleRequestCallback) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 0);
  deferInit(() => { initQueueStore().catch(() => {}); });
}