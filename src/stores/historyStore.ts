import { create } from 'zustand';
import { Song } from '../types/music';

export interface HistoryEntry {
  song: Song;
  playedAt: number; // timestamp
}

export interface HistoryStore {
  history: HistoryEntry[];
  addSong: (song: Song) => void;
  removeSong: (songId: string) => void;
  clearHistory: () => void;
  getRecent: (count?: number) => HistoryEntry[];
  getMostPlayed: (count?: number) => Song[];
}

const STORAGE_KEY = 'listening_history';
const MAX_HISTORY = 500;

function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { return []; }
}

function saveHistory(history: HistoryEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  history: loadHistory(),

  addSong: (song: Song) => {
    const { history } = get();
    const entry: HistoryEntry = { song, playedAt: Date.now() };
    const newHistory = [entry, ...history.filter(e => e.song.id !== song.id)].slice(0, MAX_HISTORY);
    saveHistory(newHistory);
    set({ history: newHistory });
  },

  removeSong: (songId: string) => {
    const { history } = get();
    const newHistory = history.filter(e => e.song.id !== songId);
    saveHistory(newHistory);
    set({ history: newHistory });
  },

  clearHistory: () => {
    saveHistory([]);
    set({ history: [] });
  },

  getRecent: (count = 20) => {
    return get().history.slice(0, count);
  },

  getMostPlayed: (count = 20) => {
    const { history } = get();
    const playCounts = new Map<string, { song: Song; count: number }>();
    for (const entry of history) {
      const existing = playCounts.get(entry.song.id);
      if (existing) {
        existing.count++;
      } else {
        playCounts.set(entry.song.id, { song: entry.song, count: 1 });
      }
    }
    return Array.from(playCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, count)
      .map(e => e.song);
  },
}));
