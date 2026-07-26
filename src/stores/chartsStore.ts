import { create } from 'zustand';
import { api, apiFetch } from '../config/api';
import { useSongsStore } from './songsStore';

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

export type TrendingSource = 'youtube_music' | 'charts' | 'cache' | 'builtin' | 'none';

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

function toChartSong(r: any, i: number): ChartSong {
  return {
    id: r.id,
    title: r.title || 'Unknown',
    artist: r.artist || 'Unknown',
    thumbnail: r.thumbnail || '',
    rank: i + 1,
    trend: i < 3 ? 'up' as const : i < 10 ? 'same' as const : 'down' as const,
    youtubeId: r.id,
    duration: r.duration || 0,
    viewCount: r.viewCount || r.view_count || 0,
  };
}

function buildLocalCharts(): { results: any[]; source: TrendingSource } {
  const songs = useSongsStore.getState().songs;
  if (songs.length === 0) return { results: [], source: 'none' };
  const shuffled = [...songs].sort(() => Math.random() - 0.5).slice(0, 50);
  return {
    results: shuffled.map(s => ({
      id: s.youtubeId,
      title: s.title,
      artist: s.artist,
      thumbnail: s.coverArt,
      duration: s.duration,
      viewCount: 0,
    })),
    source: 'builtin',
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
    if (state.topCharts.length > 0 && state.lastUpdated && Date.now() - state.lastUpdated < 30 * 60_000) {
      return;
    }

    set({ loading: true, error: null });
    try {
    let results: any[] = [];
    let source: TrendingSource = 'none';
    let lastUpdated: number = Date.now();

      // Try server: 5s timeout, 2 retries (3 total), hard 8s cap
      const startTime = Date.now();
      let serverOk = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (Date.now() - startTime > 8_000) break;
        try {
          const res = await apiFetch(api('/charts/trending.json'), { timeout: 5_000, retries: 0 });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const contentType = res.headers.get('content-type') || '';
          if (!contentType.includes('application/json')) throw new Error('Not JSON');
          const data = await res.json();
          if (data.results && data.results.length > 0) {
            results = data.results;
            source = data.source || 'none';
            lastUpdated = data.lastUpdated || Date.now();
            serverOk = true;
            break;
          }
        } catch { /* retry */ }
        if (attempt < 2) await new Promise(r => setTimeout(r, 500));
      }

      // Fallback: local songs → empty
      if (!serverOk) {
        const local = buildLocalCharts();
        results = local.results;
        source = local.source;
        lastUpdated = Date.now();
      }

      const charts: ChartSong[] = (results as any[])
        .filter((r: any) => r && r.id && r.title)
        .map((r: any, i: number) => toChartSong(r, i));

      if (charts.length === 0) {
        set({ loading: false, error: 'No trending data available', source: source as TrendingSource, lastUpdated });
        return;
      }

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
        loading: false,
        error: null,
        source: source as TrendingSource,
        lastUpdated,
      });
    } catch {
      set({ error: 'Failed to load charts. Please try again.', loading: false });
    }
  },
}));
