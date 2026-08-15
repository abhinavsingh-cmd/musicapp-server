import { create } from 'zustand';
import { lyricsService, LyricLine } from '../services/lyricsService';
import { findActiveLine } from '../utils/lrcParser';

// Outer safety net only — the service bounds its own source chain well
// inside this budget, so a healthy fetch never reaches this limit.
const LYRICS_TIMEOUT_MS = 12_000;

export type { LyricLine } from '../utils/lrcParser';

// Monotonic request sequence. Every fetchLyrics/clearLyrics bumps it, and an
// in-flight result may only touch state while it still owns the latest seq —
// this is what makes rapid song switching (including A→B→A) incapable of
// landing stale lyrics or a stale error on the wrong song.
let requestSeq = 0;

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
    if (current === songId && get().lyrics.length > 0 && !get().loading) return; // already loaded

    const seq = ++requestSeq; // invalidates every in-flight fetch
    set({ loading: true, error: null, lyrics: [], currentLine: -1, songId });
    try {
      const lyrics = await Promise.race([
        lyricsService.fetchLyrics(title, artist),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Lyrics timeout')), LYRICS_TIMEOUT_MS)
        ),
      ]);
      // Superseded by a newer fetch/clear — the result is stale and must
      // never replace the state owned by the newer request.
      if (seq !== requestSeq) return;
      set({ lyrics, loading: false, currentLine: -1 });
    } catch (err) {
      if (seq !== requestSeq) return; // a stale error must not poison the new song
      const message = err instanceof Error && err.message === 'Lyrics timeout'
        ? 'Lyrics request timed out'
        : 'Failed to fetch lyrics';
      set({ error: message, loading: false });
    }
  },

  updateCurrentLine: (currentTime: number) => {
    const { lyrics } = get();
    if (lyrics.length === 0) return;
    if (!Number.isFinite(currentTime) || currentTime < 0) return;
    const line = findActiveLine(lyrics, currentTime);
    if (line !== get().currentLine) {
      set({ currentLine: line });
    }
  },

  clearLyrics: () => {
    requestSeq++; // kill any in-flight fetch too
    set({ lyrics: [], currentLine: -1, error: null, songId: null, loading: false });
  },
}));
