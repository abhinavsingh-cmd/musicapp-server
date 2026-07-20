import { create } from 'zustand';
import { Song } from '../types/music';
import { useQueueStore } from './queueStore';
import { audioService } from '../services/audioServiceInstance';
import { mediaSessionService } from '../services/mediaSessionService';
import { playbackPersistenceService } from '../services/playbackPersistenceService';
import { backgroundPlaybackService } from '../services/backgroundPlaybackService';
import { useHistoryStore } from './historyStore';

export interface AudioStore {
  currentSong: Song | null;
  isPlaying: boolean;
  volume: number;
  isShuffled: boolean;
  repeatMode: 'off' | 'all' | 'one';
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
        const current = state.currentSong;
        if (data?.song && current && current.id !== data.song.id) return;
        useAudioStore.setState({
          isPlaying: true,
          isLoading: false,
          currentSong: data.song ?? current,
          duration: audioService.getDuration(),
          error: null,
        });
        if (data?.song) {
          mediaSessionService.updateMetadata(data.song);
          mediaSessionService.updatePlaybackState(true, audioService.getCurrentTime(), audioService.getDuration());
          useHistoryStore.getState().addSong(data.song);
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
            });
          }
        } else {
          useAudioStore.getState().nextSong();
        }
        break;
      }
      case 'progress':
      case 'timeupdate': {
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
        const current = state.currentSong;
        if (data?.song && current && current.id !== data.song.id) return;
        useAudioStore.setState({
          isLoading: false,
          currentSong: data.song ?? current,
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
        useAudioStore.setState({
          error: typeof data === 'string' ? data : 'Playback error',
          isLoading: false,
        });
        break;
      case 'waiting':
        useAudioStore.setState({ isLoading: true });
        break;
      case 'canplay':
        useAudioStore.setState({ isLoading: false });
        break;
    }
  });
}

// Guard against double-init on HMR — wrapped in try/catch so module-level failures
// don't crash the entire app in Capacitor WebView
if (!(globalThis as any).__audioStoreInitialized) {
  (globalThis as any).__audioStoreInitialized = true;

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
  } catch (e) {
    console.warn('[AudioStore] mediaSessionService init failed:', e);
  }

  try {
    backgroundPlaybackService.init();
  } catch (e) {
    console.warn('[AudioStore] backgroundPlaybackService init failed:', e);
  }

  try {
    backgroundPlaybackService.onInterruption((type) => {
      if (type === 'headphone-unplug' || type === 'bluetooth-disconnect') {
        useAudioStore.getState().pause();
      }
    });

    backgroundPlaybackService.onReconnect(() => {
      const state = useAudioStore.getState();
      if (state.currentSong && !state.isPlaying) {
        audioService.resume();
        useAudioStore.setState({ isPlaying: true });
      }
    });

    backgroundPlaybackService.onBackgroundChange((isBackground) => {
      if (isBackground) {
        persistPlaybackState();
      }
    });
  } catch (e) {
    console.warn('[AudioStore] backgroundPlaybackService listeners failed:', e);
  }

  try {
    initAudioServiceHandler();
  } catch (e) {
    console.warn('[AudioStore] initAudioServiceHandler failed:', e);
  }

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

  try {
    window.addEventListener('beforeunload', () => {
      persistPlaybackState();
    });
  } catch {}
}

function autoSkipNextSong() {
  clearNextSongRetry();
  const state = useAudioStore.getState();
  if (!state.currentSong) return;
  
  consecutivePlayFailures++;
  console.log(`[AudioStore] Auto-skip failure ${consecutivePlayFailures}/${MAX_CONSECUTIVE_FAILURES}`);
  
  if (consecutivePlayFailures >= MAX_CONSECUTIVE_FAILURES) {
    console.error('[AudioStore] Too many consecutive failures, stopping auto-skip');
    useAudioStore.setState({
      error: 'Multiple songs failed to play. Check your connection.',
      isLoading: false,
      isPlaying: false,
    });
    return;
  }
  
  const backoff = Math.min(1000 * Math.pow(2, consecutivePlayFailures - 1), 5000);
  console.log(`[AudioStore] Retrying next song in ${backoff}ms`);
  nextSongRetryTimeout = setTimeout(() => {
    nextSongRetryTimeout = null;
    useAudioStore.getState().nextSong();
  }, backoff);
}

export const useAudioStore = create<AudioStore>((set, get) => ({
  currentSong: null,
  isPlaying: false,
  volume: loadVolume(),
  isShuffled: false,
  repeatMode: 'off',
  isLoading: false,
  error: null,
  progress: 0,
  duration: 0,
  favorites: loadFavorites(),

  loadSong: (song: Song, playlist: Song[], index: number) => {
    clearNextSongRetry();
    const { currentSong } = get();
    if (currentSong?.id === song.id) return;

    const qs = useQueueStore.getState();
    qs.setQueue(playlist, index);

    set({
      currentSong: song,
      isLoading: true,
      error: null,
      duration: song.duration,
      progress: 0,
      isPlaying: true,
      isShuffled: qs.isShuffled,
      repeatMode: qs.repeatMode,
    });
    
    audioService.play(song, playlist, index).catch(err => {
      console.error('[AudioStore] loadSong play() failed:', err);
      set({ error: err.message, isLoading: false, isPlaying: false });
      autoSkipNextSong();
    });
  },

  play: () => {
    const { currentSong } = get();
    if (!currentSong) return;
    audioService.resume();
    set({ isPlaying: true });
  },

  pause: () => {
    audioService.pause();
    set({ isPlaying: false });
  },

  togglePlayPause: () => {
    const { isPlaying, currentSong } = get();
    if (!currentSong) return;
    if (isPlaying) {
      audioService.pause();
      set({ isPlaying: false });
    } else {
      audioService.resume();
      set({ isPlaying: true });
    }
  },

  nextSong: async () => {
    clearNextSongRetry();
    const song = await useQueueStore.getState().nextSong();
    if (song) {
      set({
        currentSong: song,
        isPlaying: true,
        progress: 0,
        isLoading: true,
        duration: song.duration,
        error: null,
      });
      audioService.play(song, useQueueStore.getState().queue, useQueueStore.getState().currentIndex).catch(err => {
        console.error('[AudioStore] nextSong play() failed:', err);
        set({ error: err.message, isLoading: false, isPlaying: false });
        autoSkipNextSong();
      });
    } else {
      clearNextSongRetry();
      set({ isPlaying: false, progress: 0 });
    }
  },

  previousSong: async () => {
    clearNextSongRetry();
    const song = await useQueueStore.getState().previousSong();
    if (song) {
      set({
        currentSong: song,
        isPlaying: true,
        progress: 0,
        isLoading: true,
        duration: song.duration,
        error: null,
      });
      audioService.play(song, useQueueStore.getState().queue, useQueueStore.getState().currentIndex).catch(err => {
        console.error('[AudioStore] previousSong play() failed:', err);
        set({ error: err.message, isLoading: false, isPlaying: false });
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
    const qs = useQueueStore.getState();
    set({ isShuffled: qs.isShuffled });
  },

  cycleRepeat: () => {
    useQueueStore.getState().cycleRepeat();
    set({ repeatMode: useQueueStore.getState().repeatMode });
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

    console.log('[AudioStore] Restoring from persistence:', saved.currentSong.title);

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

    set({
      currentSong: saved.currentSong,
      volume: vol,
      isShuffled: saved.isShuffled,
      repeatMode: saved.repeatMode,
      duration: saved.duration,
      progress: 0,
      isPlaying: false,
    });

    if (saved.progress > 0 && saved.progress < saved.duration) {
      setTimeout(() => {
        audioService.seek(saved.progress);
        set({ progress: saved.progress });
      }, 500);
    }
  },
}));
