import { create } from 'zustand';
import { trendingService, TrendingResult } from '../services/trendingService';
import { Song } from '../types/music';

export interface ChartSong {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  rank: number;
  trend: 'up' | 'down' | 'same' | 'new';
  youtubeId?: string;
  duration?: number;
  viewCount?: number;
}

export type TrendingSource = 'youtube_music' | 'charts' | 'cache' | 'builtin' | 'local_library' | 'none';

interface ChartsStore {
  topCharts: ChartSong[];
  globalCharts: ChartSong[];
  bollywoodCharts: ChartSong[];
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
  source: TrendingSource;
  fetchCharts: () => Promise<void>;
}

function isBollywood(song: ChartSong): boolean {
  const a = song.artist.toLowerCase();
  return a.includes('bollywood') || a.includes('hindi') ||
         a.includes('arijit') || a.includes('shreya') ||
         a.includes('armaan') || a.includes('kishore');
}

function toChartSong(song: Song, rank: number): ChartSong {
  return {
    id: song.id,
    title: song.title || 'Unknown',
    artist: song.artist || 'Unknown',
    thumbnail: song.coverArt || '',
    rank: rank + 1,
    trend: rank < 3 ? 'up' : rank < 10 ? 'same' : 'down',
    youtubeId: song.youtubeId || song.id,
    duration: song.duration || 0,
    viewCount: 0,
  };
}

function buildCharts(result: TrendingResult): {
  topCharts: ChartSong[];
  globalCharts: ChartSong[];
  bollywoodCharts: ChartSong[];
} {
  const songs = result.songs;
  const all = songs.map((s, i) => toChartSong(s, i));

  return {
    topCharts: all.slice(0, 50),
    globalCharts: all.filter(c => !isBollywood(c)).slice(0, 50),
    bollywoodCharts: all.filter(c => isBollywood(c)).slice(0, 50),
  };
}

export const useChartsStore = create<ChartsStore>((set) => ({
  topCharts: [],
  globalCharts: [],
  bollywoodCharts: [],
  loading: false,
  error: null,
  lastUpdated: null,
  source: 'none',

  fetchCharts: async () => {
    const state = useChartsStore.getState();

    // If data exists and is very fresh (< 2 min), skip to avoid hammering
    if (state.lastUpdated && Date.now() - state.lastUpdated < 2 * 60_000) {
      if (state.topCharts.length > 0) return;
    }

    set({ loading: true, error: null });

    try {
      const result = await trendingService.getTrending();
      const charts = buildCharts(result);

      set({
        ...charts,
        loading: false,
        error: null,
        source: result.source as TrendingSource,
        lastUpdated: result.lastUpdated,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load charts';

      // Keep previous data visible on error
      set({ loading: false, error: msg });
    }
  },
}));
