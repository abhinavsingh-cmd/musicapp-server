import { create } from 'zustand';
import { Song } from '../types/music';
import { preloadNextSongs as preload } from '../services/preloadService';
import { isDownloadedSong } from '../services/musicSource';
import { logger } from '../utils/logger';
import { deferIdle } from '../utils/idle';

const QUEUE_KEY = 'playback-queue';
const MAX_RECENT = 50;
const MIN_QUEUE_SIZE = 10;

function loadQueue(): { queue: Song[]; currentIndex: number; repeatMode: RepeatMode; isShuffled: boolean; autoplayEnabled: boolean; originalQueue: Song[]; crossfadeEnabled: boolean; crossfadeDurationSec: number } {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return { queue: [], currentIndex: 0, repeatMode: 'off', isShuffled: false, autoplayEnabled: true, originalQueue: [], crossfadeEnabled: false, crossfadeDurationSec: 6 };
    const parsed = JSON.parse(raw);
    return {
      queue: parsed.queue || [],
      currentIndex: parsed.currentIndex || 0,
      repeatMode: parsed.repeatMode || 'off',
      isShuffled: parsed.isShuffled || false,
      autoplayEnabled: parsed.autoplayEnabled !== false,
      originalQueue: parsed.originalQueue || [],
      crossfadeEnabled: parsed.crossfadeEnabled === true,
      crossfadeDurationSec: Math.max(2, Math.min(12, parsed.crossfadeDurationSec || 6)),
    };
  } catch {
    return { queue: [], currentIndex: 0, repeatMode: 'off', isShuffled: false, autoplayEnabled: true, originalQueue: [], crossfadeEnabled: false, crossfadeDurationSec: 6 };
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function persistNow(state: QueueState): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify({
      queue: state.queue,
      currentIndex: state.currentIndex,
      repeatMode: state.repeatMode,
      isShuffled: state.isShuffled,
      autoplayEnabled: state.autoplayEnabled,
      originalQueue: state.originalQueue,
      crossfadeEnabled: state.crossfadeEnabled,
      crossfadeDurationSec: state.crossfadeDurationSec,
    }));
  } catch { }
}

function schedulePersist(state: QueueState): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistNow(state);
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
  /** Crossfade into the next track near end-of-song (HTML engine only). */
  crossfadeEnabled: boolean;
  /** Fade window in seconds, clamped to [2, 12]. */
  crossfadeDurationSec: number;

  /**
   * Replace the queue. `preserveShuffle` keeps the current shuffle mode and
   * original order — used when jumping to a row INSIDE the existing queue
   * (queue panel), where the displayed order is already the shuffled order
   * and the mode must not silently turn off.
   */
  setQueue: (songs: Song[], startIndex?: number, preserveShuffle?: boolean) => void;
  restoreQueue: (saved: { queue: Song[]; currentIndex: number; repeatMode: RepeatMode; isShuffled: boolean; originalQueue: Song[]; autoplayEnabled: boolean }) => void;
  playAtIndex: (index: number) => void;
  /**
   * THE authoritative next-transition. `target` is the crossfade preselect:
   * under shuffle it locks the commit to the track that was already prepared
   * in the incoming element, so the queue commit can never race the prepared
   * stream. Ignored when it no longer matches the queue's rules.
   */
  nextSong: (target?: Song) => Promise<Song | null>;
  previousSong: () => Promise<Song | null>;
  /**
   * PURE lookahead — the track nextSong() would return under the current
   * modes, with NO mutation. Drives crossfade preloading. Returns null when
   * there is no valid next track (repeat-one, empty queue, repeat-off at the
   * end, one-track queues where the only option is the current track).
   */
  peekNextSong: () => Song | null;

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
  setCrossfadeEnabled: (enabled: boolean) => void;
  setCrossfadeDuration: (seconds: number) => void;

  addRecent: (song: Song) => void;
  clearRecent: () => void;

  ensureQueueSize: () => Promise<void>;
  preloadNextSongs: () => Promise<void>;
  appendRecommendations: (songs: Song[]) => Promise<void>;
  /**
   * Write any pending queue persistence IMMEDIATELY (bypasses the debounce).
   * Called when the app moves to the background — the WebView may be
   * suspended before the debounced write fires, so the queue must be safe
   * across every foreground/background transition.
   */
  flushPersist: () => void;
  init: () => Promise<void>;
}

let initPromise: Promise<void> | null = null;

/**
 * A queue entry is valid only if it has a non-empty playable id. Anything
 * else can never be played and would corrupt the queue and its persistence
 * — such entries are dropped at every queue boundary.
 */
export function isValidSong(song: unknown): song is Song {
  return (
    !!song &&
    typeof (song as Song).id === 'string' &&
    (song as Song).id.trim().length > 0
  );
}

function initQueueStore() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (typeof window === 'undefined') return;
    const saved = loadQueue();
    const recent = loadRecent();
    // Persisted data can predate validation (or be corrupted) — sanitize on
    // load so a broken entry can never re-enter the live queue.
    const queue = (saved.queue || []).filter(isValidSong);
    useQueueStore.setState({
      queue,
      currentIndex: Math.max(0, Math.min(saved.currentIndex, Math.max(0, queue.length - 1))),
      recentlyPlayed: (recent || []).filter(isValidSong),
      repeatMode: saved.repeatMode,
      isShuffled: saved.isShuffled,
      originalQueue: (saved.originalQueue || []).filter(isValidSong),
      autoplayEnabled: saved.autoplayEnabled,
      crossfadeEnabled: saved.crossfadeEnabled,
      crossfadeDurationSec: saved.crossfadeDurationSec,
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
  crossfadeEnabled: false,
  crossfadeDurationSec: 6,

  init: async () => {
    await initQueueStore();
  },

  setQueue: (songs, startIndex = 0, preserveShuffle = false) => {
    // Sanitize at the boundary: malformed entries (missing/blank id) must
    // never become queue items or reach persistence.
    const raw = Array.isArray(songs) ? songs : [];
    const valid = raw.filter(isValidSong);
    if (valid.length === 0) return;
    // The caller's index refers to the raw array; keep the same target song
    // by relocating it into the sanitized array when possible.
    const target = raw[startIndex];
    const relocated = isValidSong(target) ? valid.indexOf(target) : -1;
    const safeIndex = relocated >= 0 ? relocated : 0;
    const song = valid[safeIndex];
    set({
      queue: valid,
      currentIndex: safeIndex,
      // A fresh list (song click from a page) starts unshuffled; a jump
      // within the existing queue keeps the mode the user is in.
      isShuffled: preserveShuffle ? get().isShuffled : false,
      originalQueue: preserveShuffle ? get().originalQueue : [],
    });
    schedulePersist(get());
    if (song) get().addRecent(song);
  },

  restoreQueue: (saved) => {
    const queue = (saved.queue || []).filter(isValidSong);
    set({
      queue,
      currentIndex: Math.max(0, Math.min(saved.currentIndex, Math.max(0, queue.length - 1))),
      repeatMode: saved.repeatMode,
      isShuffled: saved.isShuffled,
      originalQueue: (saved.originalQueue || []).filter(isValidSong),
      autoplayEnabled: saved.autoplayEnabled,
    });
    schedulePersist(get());
  },

  playAtIndex: async (index) => {
    const { queue } = get();
    if (index < 0 || index >= queue.length) return;
    const song = queue[index];
    const { useAudioStore } = await import('./audioStore');
    // Jumping to a row INSIDE the existing queue must keep the shuffle mode
    // the user is in — the displayed order already IS the shuffled order.
    useAudioStore.getState().loadSong(song, queue, index, true);
  },

  nextSong: async (target?) => {
    const { queue, currentIndex, repeatMode, isShuffled, autoplayEnabled } = get();
    if (queue.length === 0) return null;

    // REPEAT-ONE governs NATURAL completion only — the engine 'ended'
    // consumer replays the track there. Manual next and failure auto-skip
    // ALWAYS advance, so a broken track can never be replayed into a
    // skip loop while repeat-one is on.

    let nextIndex: number;
    if (isShuffled) {
      if (queue.length === 1) {
        if (repeatMode === 'all') {
          nextIndex = 0;
        } else {
          return null;
        }
      } else if (target) {
        // Crossfade preselect: the incoming element already holds this
        // track's stream — lock the commit to it so the queue commit can
        // never race the prepared audio. Only honored when it still fits
        // the shuffle rules (present in queue, not the current track).
        const idx = queue.findIndex(s => s.id === target.id);
        if (idx >= 0 && idx !== currentIndex) {
          nextIndex = idx;
        } else {
          nextIndex = Math.floor(Math.random() * queue.length);
          while (nextIndex === currentIndex && queue.length > 1) {
            nextIndex = Math.floor(Math.random() * queue.length);
          }
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
          const prevLength = queue.length;
          const entrySongId = queue[currentIndex]?.id ?? null;
          await get().ensureQueueSize();
          // A newer command (song click / queue replacement) may have
          // completed while we awaited recommendations — abort instead of
          // overwriting the user's newer choice with a stale transition.
          if ((get().queue[get().currentIndex]?.id ?? null) !== entrySongId) return null;
          const newQueue = get().queue;
          if (newQueue.length > prevLength) {
            // Re-read after ensureQueueSize to get the new next index
            const updatedQueue = get().queue;
            const updatedIndex = get().currentIndex;
            if (updatedIndex < updatedQueue.length - 1) {
              const nextIdx = updatedIndex + 1;
              const nextSong = updatedQueue[nextIdx];
              if (nextSong) {
                set({ currentIndex: nextIdx });
                schedulePersist(get());
                get().addRecent(nextSong);
                return nextSong;
              }
            }
          }
          return null;
        } else {
          return null;
        }
      }
    }

    const song = queue[nextIndex];
    if (!song) return null;
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

    // Repeat-one never traps manual PREVIOUS — like next, it only governs
    // natural completion (the 'ended' consumer).
    if (currentIndex === 0 && repeatMode === 'off' && !isShuffled) {
      // Hard boundary, symmetric with next() stopping at the last track in
      // this mode: restart the current song instead of wrapping to the end.
      return queue[0] ?? null;
    }

    const prevIndex = (currentIndex - 1 + queue.length) % queue.length;

    const song = queue[prevIndex];
    if (!song) return null;
    set({ currentIndex: prevIndex });
    schedulePersist(get());
    get().addRecent(song);
    return song;
  },

  peekNextSong: () => {
    // PURE lookahead for crossfade preloading — mirrors nextSong()'s rules
    // with NO mutation and NO async autoplay extension (recommendations
    // that do not exist yet can never be peeked or preloaded).
    const { queue, currentIndex, repeatMode, isShuffled } = get();
    if (queue.length === 0) return null;
    // Repeat-one replays the CURRENT track on natural completion — there is
    // no crossfade candidate.
    if (repeatMode === 'one') return null;

    let nextIndex: number;
    if (isShuffled) {
      if (queue.length === 1) return null; // only candidate is the current track
      nextIndex = Math.floor(Math.random() * queue.length);
      while (nextIndex === currentIndex) {
        nextIndex = Math.floor(Math.random() * queue.length);
      }
    } else {
      nextIndex = currentIndex + 1;
      if (nextIndex >= queue.length) {
        if (repeatMode !== 'all') return null; // repeat-off end / autoplay extension
        nextIndex = 0;
      }
    }
    const song = queue[nextIndex];
    // Never crossfade into the track that is already playing.
    if (!song || song.id === queue[currentIndex]?.id) return null;
    return song;
  },

  addToQueue: (song) => {
    if (!isValidSong(song)) return;
    // Duplicate insertion is never allowed — a track id may appear in the
    // queue at most once. Silently ignore the second insertion.
    if (get().queue.some(s => s.id === song.id)) return;
    set((s) => ({ queue: [...s.queue, song] }));
    schedulePersist(get());
  },

  addNext: (song) => {
    if (!isValidSong(song)) return;
    if (get().queue.some(s => s.id === song.id)) return; // no duplicates
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
          if (audioStore.currentSong?.id === removedSong.id) {
            if (audioStore.isPlaying) {
              audioStore.loadSong(newCurrent, newQueue, Math.max(0, newIndex));
            } else {
              // Paused (or still loading): the removed track must not linger
              // as the "current" song. Stop its engine session so a later
              // play cannot resume the REMOVED track, then point the player
              // at the new current WITHOUT starting playback.
              const { audioService } = await import('../services/audioServiceInstance');
              audioService.stop();
              useAudioStore.setState({
                currentSong: newCurrent,
                progress: 0,
                duration: Number.isFinite(newCurrent.duration) ? newCurrent.duration : 0,
                error: null,
                isPlaying: false,
                isLoading: false,
              });
            }
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
    if (!current) return;
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
    if (!currentSong) return;
    const idx = originalQueue.findIndex((s) => s.id === currentSong.id);
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

  setCrossfadeEnabled: (enabled) => {
    set({ crossfadeEnabled: enabled === true });
    schedulePersist(get());
  },

  setCrossfadeDuration: (seconds) => {
    const clamped = Math.max(2, Math.min(12, Number.isFinite(seconds) ? seconds : 6));
    set({ crossfadeDurationSec: clamped });
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

    const currentSong = queue[currentIndex];
    const excludeIds = new Set(queue.map(s => s.id));
    const limit = MIN_QUEUE_SIZE - queue.length + 5;

    try {
      // Provider-aware autoplay: first ask the owning provider of the
      // current track for related tracks (library similarity engine today;
      // any future provider that declares `relatedTracks`). When the
      // provider has none (e.g. YouTube), fall back to the library
      // recommendation service — same behavior as before.
      let recommendations: Song[] = [];
      if (currentSong) {
        try {
          const { toTrack, toSong } = await import('../providers/adapters');
          const { providerRegistry } = await import('../providers/registry');
          await import('../providers'); // ensure built-ins registered (idempotent)
          const track = toTrack(currentSong);
          const provider = providerRegistry.get(track.provider);
          if (provider?.capabilities.relatedTracks && provider.getRelated) {
            const related = await provider.getRelated(track, limit);
            recommendations = related
              .map(t => toSong(t))
              .filter(s => !excludeIds.has(s.id));
          }
        } catch (err) {
          logger.error('Provider related tracks failed:', err);
        }
      }

      if (recommendations.length === 0) {
        const { getRecommendations } = await import('../services/recommendationService');
        recommendations = await getRecommendations({
          seedSong: currentSong,
          limit,
          excludeIds,
        });
      }

      if (recommendations.length > 0) {
        get().appendRecommendations(recommendations);
      }
    } catch (error) {
      logger.error('Failed to fetch recommendations:', error);
      try {
        const { getRecommendations } = await import('../services/recommendationService');
        const fallback = await getRecommendations({ limit: MIN_QUEUE_SIZE, excludeIds: new Set(queue.map(s => s.id)) });
        if (fallback.length > 0) {
          get().appendRecommendations(fallback);
        }
      } catch (fallbackError) {
        logger.error('Fallback recommendations also failed:', fallbackError);
      }
    } finally {
      set({ isFetchingRecommendations: false });
    }
  },

  preloadNextSongs: async () => {
    const { queue, currentIndex } = get();
    // Downloaded tracks play locally — never warm remote URLs for them.
    preload(queue, currentIndex, { count: 3, isDownloaded: isDownloadedSong });
  },

  appendRecommendations: async (songs: Song[]) => {
    const { queue } = get();
    const existingIds = new Set(queue.map(s => s.id));
    const newSongs = songs.filter(s => isValidSong(s) && !existingIds.has(s.id));
    
    if (newSongs.length > 0) {
      set((s) => ({ queue: [...s.queue, ...newSongs] }));
      schedulePersist(get());
      const newIdx = get().currentIndex;
      preload(get().queue, newIdx, { count: 3, isDownloaded: isDownloadedSong });
    }
  },

  flushPersist: () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    persistNow(get());
  },
}));

if (typeof window !== 'undefined') {
  deferIdle(() => { initQueueStore().catch(() => {}); });
}