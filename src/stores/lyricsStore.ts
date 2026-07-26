import { create } from 'zustand';
import { lyricsService, LyricLine } from '../services/lyricsService';
import { findActiveLine } from '../utils/lrcParser';

const LYRICS_TIMEOUT_MS = 10_000;

export type { LyricLine } from '../utils/lrcParser';

export interface LyricsStore {
  lyrics: LyricLine[];
  currentLine: number;
  loading: boolean;
  error: string | null;
  songId: string | null; // track which song lyrics belong to
  fetchLyrics: (songId: string, title: string, artist: string) => Promise<void>;
  updateCurrentLine: (currentTime: number) => void;
  clearLyrics: () => void;
}

export const useLyricsStore = create<LyricsStore>((set, get) => ({
  lyrics: [],
  currentLine: -1,
  loading: false,
  error: null,
  songId: null,

  fetchLyrics: async (songId: string, title: string, artist: string) => {
    const { songId: current } = get();
    if (current === songId && get().lyrics.length > 0) return; // already loaded

    set({ loading: true, error: null, lyrics: [], currentLine: -1, songId });
    try {
      const lyrics = await Promise.race([
        lyricsService.fetchLyrics(title, artist),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Lyrics timeout')), LYRICS_TIMEOUT_MS)
        ),
      ]);
      if (get().songId !== songId) return;
      set({ lyrics, loading: false });
    } catch {
      if (get().songId !== songId) return;
      set({ error: 'Failed to fetch lyrics', loading: false });
    }
  },

  updateCurrentLine: (currentTime: number) => {
    const { lyrics } = get();
    if (lyrics.length === 0) return;
    const line = findActiveLine(lyrics, currentTime);
    if (line !== get().currentLine) {
      set({ currentLine: line });
    }
  },

  clearLyrics: () => set({ lyrics: [], currentLine: -1, error: null, songId: null }),
}));
