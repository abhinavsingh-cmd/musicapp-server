/**
 * Playback Persistence Service
 *
 * Saves playback state to localStorage and restores it on app load.
 * Stores: current song, queue, playback position, shuffle, repeat, volume.
 *
 * Debounced writes to avoid excessive localStorage access during playback.
 */

import { Song } from '../types/music';

const STORAGE_KEY = 'playback-state';
const SAVE_DEBOUNCE_MS = 2000;

export interface PlaybackState {
  currentSong: Song | null;
  queue: Song[];
  currentIndex: number;
  progress: number;
  duration: number;
  volume: number;
  isShuffled: boolean;
  repeatMode: 'off' | 'all' | 'one';
  originalQueue: Song[];
  savedAt: number; // timestamp
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;

export const playbackPersistenceService = {
  /** Save current playback state (debounced) */
  save(state: Omit<PlaybackState, 'savedAt'>): void {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      try {
        const data: PlaybackState = {
          ...state,
          savedAt: Date.now(),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch {
        // localStorage unavailable or full
      }
    }, SAVE_DEBOUNCE_MS);
  },

  /** Save immediately (for use before page unload) */
  saveImmediate(state: Omit<PlaybackState, 'savedAt'>): void {
    if (saveTimeout) clearTimeout(saveTimeout);
    try {
      const data: PlaybackState = {
        ...state,
        savedAt: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // ignore
    }
  },

  /** Load saved playback state */
  load(): PlaybackState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as PlaybackState;
      // Discard if older than 24 hours
      if (Date.now() - data.savedAt > 24 * 60 * 60 * 1000) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return data;
    } catch {
      return null;
    }
  },

  /** Clear saved state */
  clear(): void {
    localStorage.removeItem(STORAGE_KEY);
  },
};
