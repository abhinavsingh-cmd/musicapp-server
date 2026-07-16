import { create } from 'zustand';
import { api } from '../config/api';

export interface ChartSong {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  rank: number;
  trend: 'up' | 'down' | 'same' | 'new';
  youtubeId?: string;
  duration?: number;
}

interface ChartsStore {
  topCharts: ChartSong[];
  globalCharts: ChartSong[];
  bollywoodCharts: ChartSong[];
  kpopCharts: ChartSong[];
  loading: boolean;
  error: string | null;
  fetchCharts: () => Promise<void>;
}

export const useChartsStore = create<ChartsStore>((set) => ({
  topCharts: [],
  globalCharts: [],
  bollywoodCharts: [],
  kpopCharts: [],
  loading: false,
  error: null,

  fetchCharts: async () => {
    set({ loading: true, error: null });
    try {
      // Use YouTube trending for charts
      const res = await fetch(api('/youtube/trending'));
      if (!res.ok) throw new Error('Failed to fetch charts');
      const data = await res.json();

      const charts: ChartSong[] = data.results.map((r: any, i: number) => ({
        id: r.id,
        title: r.title,
        artist: r.artist,
        thumbnail: r.thumbnail,
        rank: i + 1,
        trend: i < 3 ? 'up' as const : i < 10 ? 'same' as const : 'down' as const,
        youtubeId: r.id,
        duration: r.duration,
      }));

      set({
        topCharts: charts.slice(0, 50),
        globalCharts: charts.filter((c: ChartSong) =>
          !c.artist.toLowerCase().includes('bollywood') &&
          !c.artist.toLowerCase().includes('hindi')
        ).slice(0, 50),
        bollywoodCharts: charts.filter((c: ChartSong) =>
          c.artist.toLowerCase().includes('bollywood') ||
          c.artist.toLowerCase().includes('hindi') ||
          c.artist.toLowerCase().includes('arijit') ||
          c.artist.toLowerCase().includes('shreya')
        ).slice(0, 50),
        kpopCharts: charts.filter((c: ChartSong) =>
          c.artist.toLowerCase().includes('bts') ||
          c.artist.toLowerCase().includes('blackpink') ||
          c.artist.toLowerCase().includes('k-pop') ||
          c.artist.toLowerCase().includes('kpop')
        ).slice(0, 50),
        loading: false,
      });
    } catch {
      set({ error: 'Failed to load charts', loading: false });
    }
  },
}));
