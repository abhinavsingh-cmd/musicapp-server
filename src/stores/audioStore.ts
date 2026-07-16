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
  playbackMode: 'youtube' | 'offline';

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
let currentSongIdRef: string | null = null;

function initAudioServiceHandler() {
  if (audioServiceUnsub) return;

  audioServiceUnsub = audioService.subscribe((event, data) => {
    const state = useAudioStore.getState();

    switch (event) {
      case 'play': {
        if (data?.song) {
          currentSongIdRef = data.song.id;
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
        useAudioStore.setState({ isPlaying: true, isLoading: false });
        break;
      }
      case 'pause':
        useAudioStore.setState({ isPlaying: false });
        mediaSessionService.updatePlaybackState(false, audioService.getCurrentTime(), audioService.getDuration());
        break;
      case 'ended':
        useAudioStore.getState().nextSong();
        break;
      case 'progress':
      case 'timeupdate':
        if (currentSongIdRef && state.currentSong?.id !== currentSongIdRef) return;
        useAudioStore.setState({ progress: data });
        mediaSessionService.updatePlaybackState(useAudioStore.getState().isPlaying, data, audioService.getDuration());
        break;
      case 'loaded':
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
      case 'error':
        useAudioStore.setState({ error: typeof data === 'string' ? data : 'Playback error', isLoading: false });
        break;
      case 'waiting':
        useAudioStore.setState({ isLoading: true });
        break;
      case 'canplay':
        useAudioStore.setState({ isLoading: false });
        break;
      case 'playing':
        useAudioStore.setState({ isPlaying: true, isLoading: false });
        break;
    }
  });
}

mediaSessionService.init({
  onPlay: () => useAudioStore.getState().play(),
  onPause: () => useAudioStore.getState().pause(),
  onNext: () => useAudioStore.getState().nextSong(),
  onPrevious: () => useAudioStore.getState().previousSong(),
  onSeekForward: () => {
    const state = useAudioStore.getState();
    state.seek(Math.min(audioService.getCurrentTime() + 10, audioService.getDuration()));
  },
  onSeekBackward: () => {
    const state = useAudioStore.getState();
    state.seek(Math.max(audioService.getCurrentTime() - 10, 0));
  },
  onStop: () => useAudioStore.getState().pause(),
});

backgroundPlaybackService.init();

backgroundPlaybackService.onInterruption((type) => {
  console.log('Audio interruption:', type);
  if (type === 'headphone-unplug' || type === 'bluetooth-disconnect') {
    useAudioStore.getState().pause();
  }
});

backgroundPlaybackService.onBackgroundChange((isBackground) => {
  if (isBackground) {
    persistPlaybackState();
  }
});

let persistenceInterval: ReturnType<typeof setInterval> | null = null;

function startPersistenceInterval() {
  if (persistenceInterval) return;
  persistenceInterval = setInterval(() => {
    const state = useAudioStore.getState();
    if (state.isPlaying && state.currentSong) {
      persistPlaybackState();
    }
  }, 10000);
}

initAudioServiceHandler();
startPersistenceInterval();

useQueueStore.subscribe((state) => {
  mediaSessionService.updateActions(
    state.currentIndex < state.queue.length - 1,
    state.currentIndex > 0
  );
});

window.addEventListener('beforeunload', () => {
  persistPlaybackState();
});

export function cleanupAudioStore() {
  if (audioServiceUnsub) {
    audioServiceUnsub();
    audioServiceUnsub = null;
  }
  if (persistenceInterval) {
    clearInterval(persistenceInterval);
    persistenceInterval = null;
  }
  currentSongIdRef = null;
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
  playbackMode: 'youtube',

  loadSong: (song: Song, playlist: Song[], index: number) => {
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
      set({ error: err.message, isLoading: false, isPlaying: false });
    });
  },

  play: () => {
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
    const song = await useQueueStore.getState().nextSong();
    if (song) {
      set({
        currentSong: song,
        isPlaying: true,
        progress: 0,
        isLoading: true,
        duration: song.duration,
      });
      audioService.play(song, useQueueStore.getState().queue, useQueueStore.getState().currentIndex);
    } else {
      set({ isPlaying: false, progress: 0 });
    }
  },

  previousSong: async () => {
    const song = await useQueueStore.getState().previousSong();
    if (song) {
      set({
        currentSong: song,
        isPlaying: true,
        progress: 0,
        isLoading: true,
        duration: song.duration,
      });
      audioService.play(song, useQueueStore.getState().queue, useQueueStore.getState().currentIndex);
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
    });

    setTimeout(() => {
      if (saved.progress > 0 && saved.progress < saved.duration) {
        audioService.seek(saved.progress);
        set({ progress: saved.progress });
      }
    }, 500);
  },
}));