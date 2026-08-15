import { create } from 'zustand';
import { trendingService, TrendingResult, TrendingSourceLabel } from '../services/trendingService';
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

export type TrendingSource = TrendingSourceLabel | 'none';

/** Auto-fetches inside this window reuse the current charts (cache layer). */
const FRESH_WINDOW_MS = 2 * 60_000;

interface ChartsStore {
  topCharts: ChartSong[];
  globalCharts: ChartSong[];
  bollywoodCharts: ChartSong[];
  /** Initial load — no chart data on screen yet. */
  loading: boolean;
  /** Background refresh while chart data is already visible. */
  refreshing: boolean;
  error: string | null;
  lastUpdated: number | null;
  source: TrendingSource;
  /** Upstream origin detail ('youtube_music' | 'charts') when LIVE/CACHED. */
  origin: string | null;
  /** Synchronously seed the store from the trending service cache. */
  hydrateFromCache: () => void;
  /** Fetch charts. `force: true` bypasses the fresh-window cache (manual refresh). */
  fetchCharts: (options?: { force?: boolean }) => Promise<void>;
}

function isBollywood(song: ChartSong): boolean {
  const a = song.artist.toLowerCase();
  return a.includes('bollywood') || a.includes('hindi') ||
         a.includes('arijit') || a.includes('shreya') ||
         a.includes('armaan') || a.includes('kishore');
}

/** Invalid songs never enter a chart: they need a non-empty id AND title. */
function isValidChartSong(song: unknown): song is Song {
  if (!song || typeof song !== 'object') return false;
  const s = song as Song;
  return typeof s.id === 'string' && s.id.trim() !== '' &&
         typeof s.title === 'string' && s.title.trim() !== '';
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
  const songs = Array.isArray(result.songs) ? result.songs : [];
  const seen = new Set<string>();
  const all: ChartSong[] = [];
  for (const song of songs) {
    try {
      // Invalid-song protection + duplicate protection: skip bad or
      // already-seen items individually. Per-item isolation guarantees a
      // single failed item never discards (or crashes) the whole chart.
      if (!isValidChartSong(song)) continue;
      const key = song.youtubeId || song.id;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(toChartSong(song, all.length));
    } catch {
      // Item threw during validation/mapping — keep the rest of the chart.
    }
  }

  return {
    topCharts: all.slice(0, 50),
    globalCharts: all.filter(c => !isBollywood(c)).slice(0, 50),
    bollywoodCharts: all.filter(c => isBollywood(c)).slice(0, 50),
  };
}

// Duplicate-fetch protection: concurrent callers share one in-flight request.
let inFlight: Promise<void> | null = null;

export const useChartsStore = create<ChartsStore>((set, get) => ({
  topCharts: [],
  globalCharts: [],
  bollywoodCharts: [],
  loading: false,
  refreshing: false,
  error: null,
  lastUpdated: null,
  source: 'none',
  origin: null,

  hydrateFromCache: () => {
    const initial = trendingService.getState();
    if (!initial || initial.songs.length === 0) return;
    set({
      ...buildCharts(initial),
      // The trending result carries its own honest source label — fallback
      // data (LIBRARY/BUILT_IN) is never relabeled as LIVE here.
      source: initial.source as TrendingSource,
      origin: initial.origin ?? null,
      lastUpdated: initial.lastUpdated || Date.now(),
      error: null,
    });
  },

  fetchCharts: async (options) => {
    const force = options?.force === true;

    // Duplicate protection: a second caller joins the running request.
    if (inFlight) return inFlight;

    const state = get();
    if (!force) {
      // Cache layer: recent data is reused — but ONLY when it came from a
      // live-sourced response. Fallback data must always be allowed to
      // recover back to LIVE, so it never blocks a refetch.
      const liveSourced = state.source === 'LIVE' || state.source === 'CACHED';
      if (
        liveSourced &&
        state.lastUpdated &&
        Date.now() - state.lastUpdated < FRESH_WINDOW_MS &&
        state.topCharts.length > 0
      ) {
        return;
      }
    }

    const hasData = state.topCharts.length > 0;
    set({ loading: !hasData, refreshing: hasData, error: null });

    inFlight = (async () => {
      try {
        const result = await trendingService.getTrending();

        // Empty responses never replace visible charts.
        if (!result || !Array.isArray(result.songs) || result.songs.length === 0) {
          set({
            loading: false,
            refreshing: false,
            error: hasData ? 'Charts could not be refreshed — showing previous data' : 'No chart data available',
          });
          return;
        }

        set({
          ...buildCharts(result),
          loading: false,
          refreshing: false,
          error: null,
          source: result.source as TrendingSource,
          origin: result.origin ?? null,
          lastUpdated: result.lastUpdated,
        });
      } catch (err) {
        // Error state: keep previous data visible, surface the message.
        const msg = err instanceof Error ? err.message : 'Failed to load charts';
        set({ loading: false, refreshing: false, error: msg });
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  },
}));
