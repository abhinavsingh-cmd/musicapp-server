import { create } from 'zustand';
import { Song } from '../types/music';
import { useQueueStore } from './queueStore';
import { useDownloadsStore } from './downloadsStore';
import { audioService } from '../services/audioServiceInstance';
import { mediaSessionService } from '../services/mediaSessionService';
import { playbackPersistenceService } from '../services/playbackPersistenceService';
import { backgroundPlaybackService } from '../services/backgroundPlaybackService';
import { useHistoryStore } from './historyStore';
import { preloadNextSongs, prewarmOnFirstInteraction } from '../services/preloadService';

const LOADING_TIMEOUT_MS = 10_000;
let loadingTimeoutId: ReturnType<typeof setTimeout> | null = null;

function startLoadingTimeout() {
  if (loadingTimeoutId) clearTimeout(loadingTimeoutId);
  loadingTimeoutId = setTimeout(() => {
    const { isLoading } = useAudioStore.getState();
    if (isLoading) {
      console.warn('[AudioStore] Loading timeout — forcing isLoading=false');
      useAudioStore.setState({ isLoading: false, isPlaying: false, error: 'Loading timed out' });
    }
    loadingTimeoutId = null;
  }, LOADING_TIMEOUT_MS);
}

function clearLoadingTimeout() {
  if (loadingTimeoutId) {
    clearTimeout(loadingTimeoutId);
    loadingTimeoutId = null;
  }
}

export interface AudioStore {
  currentSong: Song | null;
  isPlaying: boolean;
  volume: number;
  isLoading: boolean;
  error: string | null;
  progress: number;
  duration: number;
  favorites: string[];

  loadSong: (song: Song, playlist: Song[], index: number) => void;
  play: () => void;
  pause: () => void;
  togglePlayPause: () => void;
  nextSong: () => void;
  previousSong: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  toggleFavorite: (songId: string) => void;
  restoreFromPersistence: () => void;
}

function loadFavorites(): string[] {
  try {
    return JSON.parse(localStorage.getItem('favorites') || '[]');
  } catch { return []; }
}

function saveFavorites(favs: string[]) {
  localStorage.setItem('favorites', JSON.stringify(favs));
}

function loadVolume(): number {
  try {
    const v = localStorage.getItem('volume');
    if (v !== null) {
      const parsed = parseFloat(v);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) return parsed;
    }
  } catch { }
  return 0.7;
}

function saveVolume(vol: number) {
  try { localStorage.setItem('volume', String(vol)); } catch { }
}

/**
 * Resolve a song's audio URL from downloads if available.
 * If the song is downloaded, injects the blob URL so it plays offline.
 * Returns the song unchanged if no download exists.
 */
function resolveDownloadUrl(song: Song): Song {
  const blobUrl = useDownloadsStore.getState().getBlobUrl(song.youtubeId || song.id);
  if (blobUrl) return { ...song, audioUrl: blobUrl };
  return song;
}

/**
 * Resolve an entire queue array, injecting blob URLs for any downloaded songs.
 * Uses a Map for O(1) lookups instead of per-song find().
 */
function resolveQueueDownloads(queue: Song[]): Song[] {
  const downloadsState = useDownloadsStore.getState();
  const blobUrlMap = new Map<string, string>();
  for (const d of downloadsState.downloads) {
    const key = d.youtubeId || d.id;
    const url = downloadsState.blobUrlCache[d.id];
    if (url) blobUrlMap.set(key, url);
  }
  let resolved = false;
  const result = queue.map(song => {
    const blobUrl = blobUrlMap.get(song.youtubeId || song.id);
    if (blobUrl) {
      resolved = true;
      return { ...song, audioUrl: blobUrl };
    }
    return song;
  });
  return resolved ? result : queue;
}

function persistPlaybackState() {
  const audioState = useAudioStore.getState();
  const queueState = useQueueStore.getState();
  playbackPersistenceService.saveImmediate({
    currentSong: audioState.currentSong,
    queue: queueState.queue,
    currentIndex: queueState.currentIndex,
    progress: audioService.getCurrentTime(),
    duration: audioService.getDuration(),
    volume: audioState.volume,
    isShuffled: queueState.isShuffled,
    repeatMode: queueState.repeatMode,
  });
}

let audioServiceUnsub: (() => void) | null = null;
let lastMediaUpdate = 0;
let lastProgressUpdate = 0;
const PROGRESS_THROTTLE_MS = 250;
const MAX_CONSECUTIVE_FAILURES = 5;
let consecutivePlayFailures = 0;
let nextSongRetryTimeout: ReturnType<typeof setTimeout> | null = null;

function clearNextSongRetry() {
  if (nextSongRetryTimeout) {
    clearTimeout(nextSongRetryTimeout);
    nextSongRetryTimeout = null;
  }
}

function initAudioServiceHandler() {
  if (audioServiceUnsub) return;

  audioServiceUnsub = audioService.subscribe((event, data) => {
    const state = useAudioStore.getState();

    switch (event) {
      case 'play': {
        clearNextSongRetry();
        if (data?.song) {
          consecutivePlayFailures = 0;
        }
        const newSong = data?.song ?? state.currentSong;
        useAudioStore.setState({
          isPlaying: true,
          isLoading: false,
          currentSong: newSong,
          duration: audioService.getDuration(),
          error: null,
        });
        if (data?.song) {
          mediaSessionService.updateMetadata(data.song);
          mediaSessionService.updatePlaybackState(true, audioService.getCurrentTime(), audioService.getDuration());
          useHistoryStore.getState().addSong(data.song);
          // Preload next songs in background
          const qs = useQueueStore.getState();
          preloadNextSongs(qs.queue, qs.currentIndex, { count: 3 }).catch(() => {});
        }
        break;
      }
      case 'playing': {
        clearNextSongRetry();
        consecutivePlayFailures = 0;
        useAudioStore.setState({ isPlaying: true, isLoading: false });
        break;
      }
      case 'pause':
        useAudioStore.setState({ isPlaying: false });
        mediaSessionService.updatePlaybackState(false, audioService.getCurrentTime(), audioService.getDuration());
        break;
      case 'ended': {
        const repeatMode = useQueueStore.getState().repeatMode;
        if (repeatMode === 'one') {
          const currentSong = useAudioStore.getState().currentSong;
          if (currentSong) {
            const queue = useQueueStore.getState().queue;
            const idx = useQueueStore.getState().currentIndex;
            audioService.play(currentSong, queue, idx).catch((err) => {
              console.error('[AudioStore] repeat-one play() failed:', err);
              clearLoadingTimeout();
              useAudioStore.setState({ isLoading: false, isPlaying: false, error: 'Playback failed' });
              autoSkipNextSong();
            });
          }
        } else {
          useAudioStore.getState().nextSong();
        }
        break;
      }
      case 'progress': {
        const now = Date.now();
        if (now - lastProgressUpdate < PROGRESS_THROTTLE_MS) return;
        lastProgressUpdate = now;
        useAudioStore.setState({ progress: data });
        if (now - lastMediaUpdate > 1000) {
          lastMediaUpdate = now;
          mediaSessionService.updatePlaybackState(
            useAudioStore.getState().isPlaying,
            data,
            audioService.getDuration(),
          );
        }
        break;
      }
      case 'loaded': {
        const newSong = data?.song ?? state.currentSong;
        useAudioStore.setState({
          currentSong: newSong,
          duration: audioService.getDuration(),
          error: null,
        });
        if (data?.song) {
          mediaSessionService.updateMetadata(data.song);
        }
        break;
      }
      case 'error':
        console.error('[AudioStore] Playback error:', data);
        clearLoadingTimeout();
        useAudioStore.setState({
          error: typeof data === 'string' ? data : 'Playback error',
          isLoading: false,
        });
        break;
      case 'waiting':
        useAudioStore.setState({ isLoading: true });
        startLoadingTimeout();
        break;
      case 'canplay':
        clearLoadingTimeout();
        useAudioStore.setState({ isLoading: false });
        break;
    }
  });
}

// Guard against double-init on HMR — wrapped in try/catch so module-level failures
// don't crash the entire app in Capacitor WebView.
// DEFERRED: All service inits run after first paint via requestIdleCallback.
if (!(globalThis as any).__audioStoreInitialized) {
  (globalThis as any).__audioStoreInitialized = true;

  const deferInit = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (cb: IdleRequestCallback) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 0);

  deferInit(() => {
    try {
      prewarmOnFirstInteraction();
    } catch {}

    try {
      mediaSessionService.init({
        onPlay: () => useAudioStore.getState().play(),
        onPause: () => useAudioStore.getState().pause(),
        onNext: () => useAudioStore.getState().nextSong(),
        onPrevious: () => useAudioStore.getState().previousSong(),
        onSeekForward: () => {
          useAudioStore.getState().seek(Math.min(audioService.getCurrentTime() + 10, audioService.getDuration()));
        },
        onSeekBackward: () => {
          useAudioStore.getState().seek(Math.max(audioService.getCurrentTime() - 10, 0));
        },
        onStop: () => useAudioStore.getState().pause(),
      });
    } catch {}

    try {
      backgroundPlaybackService.init();
    } catch {}

    try {
      backgroundPlaybackService.onInterruption((type) => {
        if (type === 'headphone-unplug' || type === 'bluetooth-disconnect') {
          useAudioStore.getState().pause();
        }
      });

      backgroundPlaybackService.onReconnect(() => {
        const state = useAudioStore.getState();
        if (state.currentSong && !state.isPlaying) {
          audioService.resume().catch((err) => {
            console.error('[AudioStore] Background resume failed:', err);
          });
        }
      });

      backgroundPlaybackService.onBackgroundChange((isBackground) => {
        if (isBackground) {
          persistPlaybackState();
        }
      });
    } catch {}

    try {
      initAudioServiceHandler();
    } catch {}

    try {
      setInterval(() => {
        try {
          const state = useAudioStore.getState();
          if (state.isPlaying && state.currentSong) {
            persistPlaybackState();
          }
        } catch {}
      }, 30000);
    } catch {}

    try {
      useQueueStore.subscribe((state) => {
        try {
          mediaSessionService.updateActions(
            state.currentIndex < state.queue.length - 1,
            state.currentIndex > 0,
          );
        } catch {}
      });
    } catch {}
  });
}

function autoSkipNextSong() {
  clearNextSongRetry();
  const state = useAudioStore.getState();
  if (!state.currentSong) return;
  
  consecutivePlayFailures++;
  
  if (consecutivePlayFailures >= MAX_CONSECUTIVE_FAILURES) {
    console.error('[AudioStore] Too many consecutive failures, stopping auto-skip');
    useAudioStore.setState({
      error: 'Multiple songs failed to play. Check your connection.',
      isLoading: false,
      isPlaying: false,
    });
    return;
  }
  
  const backoff = Math.min(500 * Math.pow(2, consecutivePlayFailures - 1), 2000);
  nextSongRetryTimeout = setTimeout(() => {
    nextSongRetryTimeout = null;
    useAudioStore.getState().nextSong();
  }, backoff);
}

export const useAudioStore = create<AudioStore>((set, get) => ({
  currentSong: null,
  isPlaying: false,
  volume: loadVolume(),
  isLoading: false,
  error: null,
  progress: 0,
  duration: 0,
  favorites: loadFavorites(),

  loadSong: (song: Song, playlist: Song[], index: number) => {
    clearNextSongRetry();
    const { currentSong, isPlaying } = get();
    
    if (currentSong?.id === song.id) {
      if (isPlaying) {
        audioService.pause();
        set({ isPlaying: false });
      } else {
        audioService.resume();
      }
      return;
    }

    // Ensure audio service handler is wired up (may not have run yet if deferred)
    if (!audioServiceUnsub) {
      try { initAudioServiceHandler(); } catch {}
    }

    const resolvedSong = resolveDownloadUrl(song);
    const resolvedQueue = resolveQueueDownloads(playlist);

    const qs = useQueueStore.getState();
    qs.setQueue(resolvedQueue, index);

    set({
      currentSong: resolvedSong,
      isLoading: true,
      error: null,
      duration: resolvedSong.duration,
      progress: 0,
    });
    startLoadingTimeout();
    
    audioService.play(resolvedSong, resolvedQueue, index).catch(err => {
      const msg = err instanceof Error ? err.message : 'Playback failed';
      console.error('[AudioStore] loadSong play() failed:', msg);
      clearLoadingTimeout();
      set({ error: msg, isLoading: false, isPlaying: false });
      autoSkipNextSong();
    });
  },

  play: () => {
    const { currentSong } = get();
    if (!currentSong) return;
    audioService.resume();
  },

  pause: () => {
    audioService.pause();
  },

  togglePlayPause: () => {
    const { isPlaying, currentSong } = get();
    if (!currentSong) return;
    if (isPlaying) {
      audioService.pause();
    } else {
      audioService.resume();
    }
  },

  nextSong: async () => {
    clearNextSongRetry();
    const song = await useQueueStore.getState().nextSong();
    if (song) {
      const resolved = resolveDownloadUrl(song);
      const resolvedQueue = resolveQueueDownloads(useQueueStore.getState().queue);
      set({
        currentSong: resolved,
        progress: 0,
        isLoading: true,
        duration: resolved.duration,
        error: null,
      });
      startLoadingTimeout();
      audioService.play(resolved, resolvedQueue, useQueueStore.getState().currentIndex).catch(err => {
        const msg = err instanceof Error ? err.message : 'Playback failed';
        console.error('[AudioStore] nextSong play() failed:', msg);
        clearLoadingTimeout();
        set({ error: msg, isLoading: false, isPlaying: false });
        autoSkipNextSong();
      });
    } else {
      clearNextSongRetry();
      clearLoadingTimeout();
      set({ isPlaying: false, progress: 0, isLoading: false });
    }
  },

  previousSong: async () => {
    clearNextSongRetry();
    const song = await useQueueStore.getState().previousSong();
    if (song) {
      const resolved = resolveDownloadUrl(song);
      const resolvedQueue = resolveQueueDownloads(useQueueStore.getState().queue);
      set({
        currentSong: resolved,
        progress: 0,
        isLoading: true,
        duration: resolved.duration,
        error: null,
      });
      startLoadingTimeout();
      audioService.play(resolved, resolvedQueue, useQueueStore.getState().currentIndex).catch(err => {
        const msg = err instanceof Error ? err.message : 'Playback failed';
        console.error('[AudioStore] previousSong play() failed:', msg);
        clearLoadingTimeout();
        set({ error: msg, isLoading: false, isPlaying: false });
        autoSkipNextSong();
      });
    }
  },

  seek: (time: number) => {
    audioService.seek(time);
    set({ progress: time });
  },

  setVolume: (volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume));
    audioService.setVolume(clamped);
    set({ volume: clamped });
    saveVolume(clamped);
  },

  toggleShuffle: () => {
    useQueueStore.getState().toggleShuffle();
  },

  cycleRepeat: () => {
    useQueueStore.getState().cycleRepeat();
  },

  toggleFavorite: (songId: string) => {
    const { favorites } = get();
    const newFavs = favorites.includes(songId)
      ? favorites.filter(id => id !== songId)
      : [...favorites, songId];
    saveFavorites(newFavs);
    set({ favorites: newFavs });
  },

  restoreFromPersistence: () => {
    const saved = playbackPersistenceService.load();
    if (!saved || !saved.currentSong) return;

    const vol = saved.volume ?? 0.7;
    audioService.setVolume(vol);

    const qs = useQueueStore.getState();
    if (saved.queue.length > 0) {
      qs.setQueue(saved.queue, saved.currentIndex || 0);
      if (saved.isShuffled !== qs.isShuffled) qs.toggleShuffle();
      if (saved.repeatMode !== qs.repeatMode) {
        while (useQueueStore.getState().repeatMode !== saved.repeatMode) {
          qs.cycleRepeat();
        }
      }
    }

    // Only restore volume and queue — do NOT restore currentSong.
    // Audio isn't loaded, so showing the song in the player would be misleading.
    // User presses play → loadSong starts fresh playback.
    set({
      volume: vol,
    });
  },
}));

if (import.meta.env.DEV) {
  try {
    useAudioStore.subscribe((state, prev) => {
      const changes: string[] = [];
      if (state.isPlaying !== prev.isPlaying) changes.push(`isPlaying: ${prev.isPlaying} → ${state.isPlaying}`);
      if (state.isLoading !== prev.isLoading) changes.push(`isLoading: ${prev.isLoading} → ${state.isLoading}`);
      if (state.error !== prev.error) changes.push(`error: ${state.error || 'null'}`);
      if (state.currentSong?.id !== prev.currentSong?.id) changes.push(`song: ${prev.currentSong?.title || 'none'} → ${state.currentSong?.title || 'none'}`);
      if (changes.length > 0) {
        console.log('[AudioStore] State:', changes.join(', '));
      }
    });
  } catch {}
}
