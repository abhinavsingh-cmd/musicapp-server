import { create } from 'zustand';
import { api, apiFetch, ApiError } from '../config/api';

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

async function fetchTrendingWithRetry(maxRetries = 2): Promise<any[]> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await apiFetch(api('/youtube/trending'), { timeout: 20_000 });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new ApiError(
          `Expected JSON, got ${contentType.slice(0, 40) || 'unknown'}`,
          res.status,
          'BAD_RESPONSE',
          api('/youtube/trending'),
        );
      }
      const data = await res.json();
      return data.results || [];
    } catch (err: any) {
      lastError = err;
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429) {
        throw err;
      }
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 800 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError || new Error('Failed to fetch trending');
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
      const results = await fetchTrendingWithRetry();

      const charts: ChartSong[] = results
        .filter((r: any) => r && r.id && r.title)
        .map((r: any, i: number) => ({
          id: r.id,
          title: r.title || 'Unknown',
          artist: r.artist || 'Unknown',
          thumbnail: r.thumbnail || '',
          rank: i + 1,
          trend: i < 3 ? 'up' as const : i < 10 ? 'same' as const : 'down' as const,
          youtubeId: r.id,
          duration: r.duration || 0,
        }));

      if (charts.length === 0) {
        set({ loading: false, error: null });
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
        kpopCharts: charts.filter((c: ChartSong) =>
          c.artist.toLowerCase().includes('bts') ||
          c.artist.toLowerCase().includes('blackpink') ||
          c.artist.toLowerCase().includes('k-pop') ||
          c.artist.toLowerCase().includes('kpop')
        ).slice(0, 50),
        loading: false,
        error: null,
      });
    } catch {
      set({ error: 'Failed to load charts', loading: false });
    }
  },
}));
