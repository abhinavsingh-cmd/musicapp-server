import { create } from 'zustand';
import { Song } from '../types/music';
import { useQueueStore } from './queueStore';
import { useDownloadsStore } from './downloadsStore';
import { audioService } from '../services/audioServiceInstance';
import { mediaSessionService } from '../services/mediaSessionService';
import { playbackPersistenceService } from '../services/playbackPersistenceService';
import { backgroundPlaybackService } from '../services/backgroundPlaybackService';
import { backgroundAudio } from '../services/backgroundAudio';
import { useHistoryStore } from './historyStore';
import { preloadNextSongs, prewarmOnFirstInteraction } from '../services/preloadService';

const LOADING_TIMEOUT_MS = 30_000;
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
  retry: () => void;
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
    return (JSON.parse(localStorage.getItem('favorites') || '[]') as string[])
      .filter(Boolean)
      .map(id => id.startsWith('t-') ? id.slice(2) : id);
  } catch {
    return [];
  }
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
    originalQueue: queueState.originalQueue,
  });
}

let audioServiceUnsub: (() => void) | null = null;
let lastMediaUpdate = 0;
let lastProgressUpdate = 0;
let lastProgressPersist = 0;
const PROGRESS_THROTTLE_MS = 250;
const MAX_CONSECUTIVE_FAILURES = 5;
let consecutivePlayFailures = 0;
let nextSongRetryTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingResumePosition: number | null = null;
let lastHistorySongId: string | null = null;
let volumePersistTimer: ReturnType<typeof setTimeout> | null = null;
let advanceChain: Promise<void> = Promise.resolve();
let serviceRequestedPlay = false;

function scheduleVolumePersist(vol: number) {
  if (volumePersistTimer) clearTimeout(volumePersistTimer);
  volumePersistTimer = setTimeout(() => {
    saveVolume(vol);
    volumePersistTimer = null;
  }, 300);
}

function chainAdvance(fn: () => Promise<void>): Promise<void> {
  const next = advanceChain.then(fn, fn);
  advanceChain = next.then(() => {}, () => {});
  return next;
}

function syncMediaSessionEnded() {
  try { mediaSessionService.updatePlaybackState(false, 0, 0); } catch {}
  try { backgroundAudio.updatePlaybackState({ isPlaying: false, position: 0, duration: 0 }).catch(() => {}); } catch {}
}

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
          try { mediaSessionService.updateMetadata(data.song); } catch {}
          try { mediaSessionService.updatePlaybackState(true, audioService.getCurrentTime(), audioService.getDuration()); } catch {}
          try { backgroundAudio.updateMetadata({
            title: data.song.title,
            artist: data.song.artist,
            album: data.song.album || 'MusicApp',
            albumArt: data.song.coverArt,
          }).catch(() => {}); } catch {}
          try { backgroundAudio.updatePlaybackState({
            isPlaying: true,
            position: audioService.getCurrentTime(),
            duration: audioService.getDuration(),
          }).catch(() => {}); } catch {}
          if (data?.song) {
            const songId = data.song.id || '';
            if (songId !== lastHistorySongId) {
              lastHistorySongId = songId;
              useHistoryStore.getState().addSong(data.song);
            }
            const qs = useQueueStore.getState();
            preloadNextSongs(qs.queue, qs.currentIndex, { count: 3 }).catch(() => {});
          }
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
        try { mediaSessionService.updatePlaybackState(false, audioService.getCurrentTime(), audioService.getDuration()); } catch {}
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
        if (typeof data !== 'number') return;
        useAudioStore.setState({ progress: data });
        if (now - lastMediaUpdate > 1000) {
          lastMediaUpdate = now;
          try { mediaSessionService.updatePlaybackState(
            useAudioStore.getState().isPlaying,
            data,
            audioService.getDuration(),
          ); } catch {}
          try { backgroundAudio.updatePlaybackState({
            isPlaying: useAudioStore.getState().isPlaying,
            position: data,
            duration: audioService.getDuration(),
          }).catch(() => {}); } catch {}
        }
        // Persist position every 5s while playing (throttled)
        if (now - lastProgressPersist > 5_000) {
          lastProgressPersist = now;
          persistPlaybackState();
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
          try { mediaSessionService.updateMetadata(data.song); } catch {}
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
    try { prewarmOnFirstInteraction(); } catch {}

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
        onSeekTo: (time: number) => {
          useAudioStore.getState().seek(time);
        },
        onStop: () => useAudioStore.getState().pause(),
      });
    } catch {}

    try { backgroundPlaybackService.init(); } catch {}

    try {
      backgroundAudio.onMediaAction((event) => {
        const store = useAudioStore.getState();
        switch (event.action) {
          case 'play':
            if (!store.currentSong) {
              serviceRequestedPlay = true;
              return;
            }
            if (store.isPlaying || store.isLoading) return;
            store.play();
            break;
          case 'pause':
          case 'stop':
            serviceRequestedPlay = false;
            store.pause();
            break;
          case 'next':
            store.nextSong();
            break;
          case 'previous':
            store.previousSong();
            break;
          case 'seek':
            if (typeof event.position === 'number' && Number.isFinite(event.position)) {
              store.seek(event.position);
            }
            break;
        }
      }).catch(() => {});
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
          audioService.resume().catch(() => {});
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
      const persistIntervalId = setInterval(() => {
        try {
          const state = useAudioStore.getState();
          if (state.isPlaying && state.currentSong) {
            persistPlaybackState();
          }
        } catch {}
      }, 10_000); // Persist every 10s while playing (was 30s)
      // Store for HMR cleanup
      if ((globalThis as any).__audioPersistInterval) {
        clearInterval((globalThis as any).__audioPersistInterval);
      }
      (globalThis as any).__audioPersistInterval = persistIntervalId;
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
  volume: 0.7,
  isLoading: false,
  error: null,
  progress: 0,
  duration: 0,
  favorites: [],

  loadSong: (song: Song, playlist: Song[], index: number) => {
    clearNextSongRetry();
    const { currentSong, isPlaying } = get();

    // A different song was chosen — any restored resume position no longer applies.
    if (currentSong?.id !== song.id) pendingResumePosition = null;

    if (currentSong?.id === song.id) {
      if (isPlaying) {
        audioService.pause();
        set({ isPlaying: false });
        return;
      }
      if (audioService.isLoaded()) {
        audioService.resume();
        return;
      }
      // Song was restored from persistence after a process restart but no audio
      // is actually loaded — fall through to a full play() below.
    }

    // Ensure audio service handler is wired up (may not have run yet if deferred)
    if (!audioServiceUnsub) {
      try { initAudioServiceHandler(); } catch {}
    }

    const resumeAt = currentSong?.id === song.id ? pendingResumePosition : null;
    if (resumeAt !== null) pendingResumePosition = null;
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
    
    audioService.play(resolvedSong, resolvedQueue, index, resumeAt ?? undefined).catch(err => {
      const msg = err instanceof Error ? err.message : 'Playback failed';
      console.error('[AudioStore] loadSong play() failed:', msg);
      clearLoadingTimeout();
      set({ error: msg, isLoading: false, isPlaying: false });
      autoSkipNextSong();
    });
  },

  retry: () => {
    clearNextSongRetry();
    const { currentSong } = get();
    if (!currentSong) return;
    pendingResumePosition = null;
    const qs = useQueueStore.getState();
    const queue = qs.queue.length > 0 ? qs.queue : [currentSong];
    const index = Math.min(qs.currentIndex, queue.length - 1);
    const resolvedQueue = resolveQueueDownloads(queue);
    const song = resolvedQueue[index] || resolveDownloadUrl(currentSong);
    if (!song) return;
    set({ currentSong: song, isLoading: true, error: null, progress: 0 });
    startLoadingTimeout();
    audioService.pause();
    audioService.play(song, resolvedQueue, index).catch(err => {
      const msg = err instanceof Error ? err.message : 'Playback failed';
      console.error('[AudioStore] retry play() failed:', msg);
      clearLoadingTimeout();
      set({ error: msg, isLoading: false, isPlaying: false });
      autoSkipNextSong();
    });
  },

  play: () => {
    const { currentSong } = get();
    if (!currentSong) return;
    if (!audioService.isLoaded()) {
      // Restored session (e.g. after process recreation) — no audio loaded yet.
      // Rebuild playback from the persisted queue and resume the saved position.
      const qs = useQueueStore.getState();
      const queue = qs.queue.length > 0 ? qs.queue : [currentSong];
      const resolvedQueue = resolveQueueDownloads(queue);
      const resumeAt = pendingResumePosition;
      pendingResumePosition = null;
      set({ isLoading: true, error: null });
      startLoadingTimeout();
      audioService.play(resolvedQueue[qs.currentIndex] || currentSong, resolvedQueue, qs.currentIndex, resumeAt ?? undefined).catch(err => {
        const msg = err instanceof Error ? err.message : 'Playback failed';
        console.error('[AudioStore] play() restore failed:', msg);
        clearLoadingTimeout();
        set({ error: msg, isLoading: false, isPlaying: false });
        autoSkipNextSong();
      });
      return;
    }
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
    } else if (audioService.isLoaded()) {
      audioService.resume();
    } else {
      get().play();
    }
  },

  nextSong: () => {
    clearNextSongRetry();
    pendingResumePosition = null;
    return chainAdvance(async () => {
      const song = await useQueueStore.getState().nextSong();
      if (song) {
        const resolved = resolveDownloadUrl(song);
        // Read queue + index synchronously right after nextSong() set them
        const qs = useQueueStore.getState();
        const resolvedQueue = resolveQueueDownloads(qs.queue);
        set({
          currentSong: resolved,
          progress: 0,
          isLoading: true,
          duration: resolved.duration,
          error: null,
        });
        startLoadingTimeout();
        audioService.play(resolved, resolvedQueue, qs.currentIndex).catch(err => {
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
        syncMediaSessionEnded();
      }
    });
  },

  previousSong: () => {
    clearNextSongRetry();
    pendingResumePosition = null;
    return chainAdvance(async () => {
      const song = await useQueueStore.getState().previousSong();
      if (song) {
        const resolved = resolveDownloadUrl(song);
        const qs = useQueueStore.getState();
        const resolvedQueue = resolveQueueDownloads(qs.queue);
        set({
          currentSong: resolved,
          progress: 0,
          isLoading: true,
          duration: resolved.duration,
          error: null,
        });
        startLoadingTimeout();
        audioService.play(resolved, resolvedQueue, qs.currentIndex).catch(err => {
          const msg = err instanceof Error ? err.message : 'Playback failed';
          console.error('[AudioStore] previousSong play() failed:', msg);
          clearLoadingTimeout();
          set({ error: msg, isLoading: false, isPlaying: false });
          autoSkipNextSong();
        });
      } else {
        clearLoadingTimeout();
        set({ isLoading: false });
      }
    });
  },

  seek: (time: number) => {
    pendingResumePosition = null;
    audioService.seek(time);
    set({ progress: time });
  },

  setVolume: (volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume));
    audioService.setVolume(clamped);
    set({ volume: clamped });
    scheduleVolumePersist(clamped);
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
      qs.restoreQueue({
        queue: saved.queue,
        currentIndex: saved.currentIndex || 0,
        repeatMode: saved.repeatMode || 'off',
        isShuffled: !!saved.isShuffled,
        originalQueue: saved.originalQueue || [],
        autoplayEnabled: useQueueStore.getState().autoplayEnabled,
      });
    }

    // Restore the song + position so the player UI reflects reality after a
    // process restart. Audio is NOT loaded yet — the next play action re-loads
    // it and resumes from this position.
    const dur = saved.duration && saved.duration > 0
      ? saved.duration
      : (saved.currentSong.duration || 0);
    const resumeAt = saved.progress && saved.progress > 3 && saved.progress < (dur > 0 ? dur - 2 : 0)
      ? saved.progress
      : null;
    pendingResumePosition = resumeAt;

    const resolved = resolveDownloadUrl(saved.currentSong);
    set({
      volume: vol,
      currentSong: resolved,
      duration: dur,
      progress: resumeAt ?? 0,
      isPlaying: false,
      isLoading: false,
      error: null,
    });

    // If the foreground service requested playback before state was restored
    // (process recreation), auto-resume now that state is available.
    if (serviceRequestedPlay) {
      serviceRequestedPlay = false;
      const store = useAudioStore.getState();
      if (store.currentSong) {
        store.play();
      }
    }
  },
}));

if (typeof window !== 'undefined') {
  const deferInit = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (cb: IdleRequestCallback) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 0);
  deferInit(() => {
    try {
      const favorites = loadFavorites();
      const volume = loadVolume();
      useAudioStore.setState({ favorites, volume });
      audioService.setVolume(volume);
    } catch {}
  });
}
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
