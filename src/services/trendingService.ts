import { Song } from '../types/music';
import { api, apiFetch } from '../config/api';
import { useSongsStore } from '../stores/songsStore';

export interface TrendingResult {
  songs: Song[];
  source: string;
  lastUpdated: number | null;
}

export interface TrendingMetrics {
  totalAttempts: number;
  successes: number;
  failures: number;
  successRate: number;
  lastSuccessTime: number | null;
  lastFailureTime: number | null;
  avgResponseTime: number;
  responseTimes: number[];
}

interface CacheEntry {
  data: TrendingResult;
  cachedAt: number;
}

// ── Constants ──────────────────────────────────────────────────────────────
const CACHE_KEY = 'trending_unified_v1';
const CACHE_TTL = 30 * 60 * 1000;         // 30 min fresh
const CACHE_MAX_AGE = 60 * 60 * 1000;     // 60 min max for loading stale
const BACKGROUND_INTERVAL = 15 * 60 * 1000; // 15 min
const MAX_BACKOFF_MS = 16_000;
const BASE_BACKOFF_MS = 1_000;
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 12_000;
const TOTAL_TIMEOUT_MS = 25_000;

// ── Built-in fallback (20 popular songs) ───────────────────────────────────
const BUILTIN: TrendingResult = {
  source: 'builtin',
  lastUpdated: Date.now(),
  songs: [
    { id:'t-kN6HHzEXKFU', youtubeId:'kN6HHzEXKFU', title:'Pushpa Pushpa', artist:'Devi Sri Prasad', genre:'Trending', duration:230, coverArt:'https://img.youtube.com/vi/kN6HHzEXKFU/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-BddP6PYo2gs', youtubeId:'BddP6PYo2gs', title:'Kesariya', artist:'Arijit Singh', genre:'Trending', duration:268, coverArt:'https://img.youtube.com/vi/BddP6PYo2gs/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-u_wB6byrl5k', youtubeId:'u_wB6byrl5k', title:'Oo Antava', artist:'Devi Sri Prasad', genre:'Trending', duration:226, coverArt:'https://img.youtube.com/vi/u_wB6byrl5k/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-VAdGW7QDJiU', youtubeId:'VAdGW7QDJiU', title:'Chaleya', artist:'Arijit Singh', genre:'Trending', duration:231, coverArt:'https://img.youtube.com/vi/VAdGW7QDJiU/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-hcMzwMrr1tE', youtubeId:'hcMzwMrr1tE', title:'Srivalli', artist:'Javed Ali', genre:'Trending', duration:228, coverArt:'https://img.youtube.com/vi/hcMzwMrr1tE/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-WWZxDA81JFk', youtubeId:'WWZxDA81JFk', title:'Tum Hi Ho', artist:'Arijit Singh', genre:'Trending', duration:262, coverArt:'https://img.youtube.com/vi/WWZxDA81JFk/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-284Ov7ysmfA', youtubeId:'284Ov7ysmfA', title:'Channa Mereya', artist:'Arijit Singh', genre:'Trending', duration:279, coverArt:'https://img.youtube.com/vi/284Ov7ysmfA/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-JGwWNGJdvx8', youtubeId:'JGwWNGJdvx8', title:'Shape of You', artist:'Ed Sheeran', genre:'Trending', duration:234, coverArt:'https://img.youtube.com/vi/JGwWNGJdvx8/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-CevxZvSJLk8', youtubeId:'CevxZvSJLk8', title:'Roar', artist:'Katy Perry', genre:'Trending', duration:223, coverArt:'https://img.youtube.com/vi/CevxZvSJLk8/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-OPf0YbXqDm0', youtubeId:'OPf0YbXqDm0', title:'Finesse', artist:'Bruno Mars', genre:'Trending', duration:200, coverArt:'https://img.youtube.com/vi/OPf0YbXqDm0/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-LXb3EKWsInQ', youtubeId:'LXb3EKWsInQ', title:'Calm Down', artist:'Rema', genre:'Trending', duration:219, coverArt:'https://img.youtube.com/vi/LXb3EKWsInQ/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-hT_nvWreIhg', youtubeId:'hT_nvWreIhg', title:'Counting Stars', artist:'OneRepublic', genre:'Trending', duration:257, coverArt:'https://img.youtube.com/vi/hT_nvWreIhg/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-dQw4w9WgXcQ', youtubeId:'dQw4w9WgXcQ', title:'Never Gonna Give You Up', artist:'Rick Astley', genre:'Trending', duration:213, coverArt:'https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-e-ORhEE9VVg', youtubeId:'e-ORhEE9VVg', title:'Thank U Next', artist:'Ariana Grande', genre:'Trending', duration:207, coverArt:'https://img.youtube.com/vi/e-ORhEE9VVg/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-kJQP7kiw5Fk', youtubeId:'kJQP7kiw5Fk', title:'Despacito', artist:'Luis Fonsi', genre:'Trending', duration:228, coverArt:'https://img.youtube.com/vi/kJQP7kiw5Fk/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-4NRXx6U8ABQ', youtubeId:'4NRXx6U8ABQ', title:'Save Your Tears', artist:'The Weeknd', genre:'Trending', duration:215, coverArt:'https://img.youtube.com/vi/4NRXx6U8ABQ/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-nfWlot6h_JM', youtubeId:'nfWlot6h_JM', title:'Shallow', artist:'Lady Gaga', genre:'Trending', duration:216, coverArt:'https://img.youtube.com/vi/nfWlot6h_JM/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-BmllggGO4pM', youtubeId:'BmllggGO4pM', title:'Senorita', artist:'Shawn Mendes', genre:'Trending', duration:191, coverArt:'https://img.youtube.com/vi/BmllggGO4pM/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-50VNCymT-Cs', youtubeId:'50VNCymT-Cs', title:'Let Me Down Slowly', artist:'Alec Benjamin', genre:'Trending', duration:157, coverArt:'https://img.youtube.com/vi/50VNCymT-Cs/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-kffacxfA7G4', youtubeId:'kffacxfA7G4', title:'Baby', artist:'Justin Bieber', genre:'Trending', duration:214, coverArt:'https://img.youtube.com/vi/kffacxfA7G4/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
  ],
};

// ── Helpers ────────────────────────────────────────────────────────────────

function mapServerResults(data: any): Song[] {
  // Server wraps response in { success, message, code, details: { results, source, lastUpdated } }
  const payload = data.details || data;
  const results = (payload.results || [])
    .filter((r: any) => r && r.id && r.title)
    .map((r: any): Song => ({
      id: 'trending-' + r.id,
      youtubeId: r.id,
      title: r.title || 'Unknown',
      artist: r.artist || 'Unknown',
      genre: 'Trending',
      duration: r.duration || 0,
      coverArt: r.thumbnail || '',
      album: '',
      audioUrl: '',
      releaseYear: 0,
      isFavorite: false,
      playCount: 0,
    }));
  return results;
}

function buildLocalFallback(): TrendingResult {
  const songs = useSongsStore.getState().songs;
  if (songs.length === 0) return BUILTIN;
  const youtubeSongs = songs.filter(s => s.youtubeId).slice(0, 50);
  if (youtubeSongs.length === 0) return BUILTIN;
  return {
    songs: youtubeSongs.map(s => ({
      ...s,
      id: 'trending-' + (s.youtubeId || s.id),
      genre: 'Trending' as const,
    })),
    source: 'local_library',
    lastUpdated: Date.now(),
  };
}

// ── TrendingService (singleton) ────────────────────────────────────────────

class TrendingService {
  // ── State ──
  private cache: TrendingResult | null = null;
  private cacheTime = 0;
  private inFlight: Promise<TrendingResult> | null = null;
  private listeners = new Set<() => void>();
  private backgroundTimer: ReturnType<typeof setInterval> | null = null;

  // ── Metrics ──
  private metrics: TrendingMetrics = {
    totalAttempts: 0,
    successes: 0,
    failures: 0,
    successRate: 0,
    lastSuccessTime: null,
    lastFailureTime: null,
    avgResponseTime: 0,
    responseTimes: [],
  };

  private notify() {
    this.listeners.forEach(fn => fn());
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getState(): TrendingResult {
    return this.cache ?? this.loadFromDisk() ?? BUILTIN;
  }

  getMetrics(): TrendingMetrics {
    return { ...this.metrics };
  }

  isFresh(): boolean {
    return this.cache !== null && Date.now() - this.cacheTime < CACHE_TTL;
  }

  // ── Persistence ──

  private loadFromDisk(): TrendingResult | null {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const entry: CacheEntry = JSON.parse(raw);
      if (!entry.data?.songs || !Array.isArray(entry.data.songs)) return null;
      if (Date.now() - entry.cachedAt > CACHE_MAX_AGE) return null;
      return entry.data;
    } catch {
      return null;
    }
  }

  private saveToDisk(result: TrendingResult): void {
    try {
      const entry: CacheEntry = { data: result, cachedAt: Date.now() };
      localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
    } catch { /* quota exceeded */ }
  }

  private setCache(result: TrendingResult): void {
    this.cache = result;
    this.cacheTime = Date.now();
    this.saveToDisk(result);
    this.notify();
  }

  // ── Network ──

  private async fetchFromNetwork(): Promise<TrendingResult> {
    const startTime = Date.now();
    let lastError: string = '';
    let retryCount = 0;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (Date.now() - startTime > TOTAL_TIMEOUT_MS) break;
      retryCount = attempt;

      const reqStart = Date.now();
      try {
        console.log(`[Trending] Request started (attempt ${attempt + 1}/${MAX_RETRIES}) → ${api('/charts/trending.json')}`);
        const res = await apiFetch(api('/charts/trending.json'), {
          timeout: REQUEST_TIMEOUT_MS,
          retries: 0,
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) throw new Error('Not JSON');

        const data = await res.json();
        const songs = mapServerResults(data);
        const reqTime = Date.now() - reqStart;

        if (songs.length > 0) {
          const payload = data.details || data;
          const result: TrendingResult = {
            songs,
            source: payload.source || 'youtube_music',
            lastUpdated: payload.lastUpdated || Date.now(),
          };
          console.log(`[Trending] ✅ LIVE SUCCESS: ${songs.length} songs, source=${result.source}, responseTime=${reqTime}ms, retries=${retryCount}`);
          this.recordSuccess(Date.now() - startTime);
          return result;
        }

        lastError = 'Empty results';
        console.warn(`[Trending] ⚠️ Empty results from server (attempt ${attempt + 1}), reqTime=${reqTime}ms`);
      } catch (err) {
        const reqTime = Date.now() - reqStart;
        lastError = err instanceof Error ? err.message : 'Unknown error';
        console.warn(`[Trending] ❌ Request failed (attempt ${attempt + 1}): ${lastError}, reqTime=${reqTime}ms`);
      }

      // Exponential backoff: 1s, 2s, 4s, 8s (capped at MAX_BACKOFF_MS)
      if (attempt < MAX_RETRIES - 1) {
        const delay = Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
        console.log(`[Trending] Backing off ${delay}ms before retry...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    console.warn(`[Trending] ❌ ALL RETRIES FAILED after ${MAX_RETRIES} attempts: ${lastError}`);
    this.recordFailure();
    throw new Error(`Trending fetch failed after ${MAX_RETRIES} attempts: ${lastError}`);
  }

  // ── Metrics ──

  private recordSuccess(responseTime: number): void {
    this.metrics.totalAttempts++;
    this.metrics.successes++;
    this.metrics.lastSuccessTime = Date.now();
    this.metrics.responseTimes.push(responseTime);
    if (this.metrics.responseTimes.length > 20) this.metrics.responseTimes.shift();
    this.metrics.avgResponseTime = this.metrics.responseTimes.reduce((a, b) => a + b, 0) / this.metrics.responseTimes.length;
    this.metrics.successRate = this.metrics.successes / this.metrics.totalAttempts;
  }

  private recordFailure(): void {
    this.metrics.totalAttempts++;
    this.metrics.failures++;
    this.metrics.lastFailureTime = Date.now();
    this.metrics.successRate = this.metrics.totalAttempts > 0
      ? this.metrics.successes / this.metrics.totalAttempts
      : 0;
  }

  // ── Public API ──

  /**
   * Get trending data. Returns immediately from cache if fresh.
   * If stale or missing, fetches from network in the background.
   * Always returns the best available data (never empty).
   */
  async getTrending(): Promise<TrendingResult> {
    // 1. Return fresh cache immediately
    if (this.cache && Date.now() - this.cacheTime < CACHE_TTL) {
      console.log(`[Trending] Cache HIT: ${this.cache.songs.length} songs, source=${this.cache.source}, age=${Math.round((Date.now() - this.cacheTime) / 1000)}s`);
      return this.cache;
    }

    console.log(`[Trending] Cache MISS or stale (age=${this.cache ? Math.round((Date.now() - this.cacheTime) / 1000) + 's' : 'null'}), fetching from network...`);

    // 2. Deduplicate concurrent requests
    if (this.inFlight) {
      console.log('[Trending] Deduplicating concurrent request');
      return this.inFlight;
    }

    // 3. Fetch from network
    this.inFlight = this.fetchFromNetwork()
      .then(result => {
        this.setCache(result);
        console.log(`[Trending] Network fetch complete: ${result.songs.length} songs, source=${result.source}`);
        return result;
      })
      .catch(() => {
        // Network failed — return best available (never empty)
        const fallback = this.cache ?? this.loadFromDisk() ?? buildLocalFallback();
        console.warn(`[Trending] Falling back to: source=${fallback.source}, songs=${fallback.songs.length}`);
        return fallback;
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }

  /**
   * Force refresh. Returns new data or falls back gracefully.
   * Previous data stays visible during the refresh.
   */
  async refresh(): Promise<TrendingResult> {
    // Reset cache time to force fetch
    this.cacheTime = 0;
    return this.getTrending();
  }

  /**
   * Initialize: load from disk, start background refresh.
   */
  init(): TrendingResult {
    // Load from disk synchronously, but preserve the original cachedAt time
    // so the data's actual age is respected (don't set cacheTime = Date.now()
    // which would make stale disk data appear "fresh" and block network fetches).
    const disk = this.loadFromDisk();
    if (disk) {
      this.cache = disk;
      // Use the disk entry's cachedAt time, or if missing, treat as stale
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        try {
          const entry: CacheEntry = JSON.parse(raw);
          this.cacheTime = entry.cachedAt || 0;
        } catch {
          this.cacheTime = 0; // stale — will trigger network fetch
        }
      } else {
        this.cacheTime = 0;
      }
      const age = Math.round((Date.now() - this.cacheTime) / 1000);
      console.log(`[Trending] init: loaded from disk: ${disk.songs.length} songs, source=${disk.source}, age=${age}s`);
    } else {
      console.log('[Trending] init: no disk cache, using builtin');
    }

    // Start background refresh
    this.startBackgroundRefresh();

    return this.cache ?? BUILTIN;
  }

  private startBackgroundRefresh(): void {
    this.stopBackgroundRefresh();
    console.log(`[Trending] Background refresh started (interval: ${BACKGROUND_INTERVAL / 1000}s)`);
    this.backgroundTimer = setInterval(() => {
      console.log('[Trending] Background refresh triggered');
      this.getTrending(); // silent background refresh
    }, BACKGROUND_INTERVAL);
  }

  stopBackgroundRefresh(): void {
    if (this.backgroundTimer) {
      clearInterval(this.backgroundTimer);
      this.backgroundTimer = null;
    }
  }

  destroy(): void {
    this.stopBackgroundRefresh();
    this.listeners.clear();
    this.inFlight = null;
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────
export const trendingService = new TrendingService();

// ── Convenience exports (backward-compatible) ──────────────────────────────

/** Synchronous. For initial render. */
export function getInitialTrending(): TrendingResult {
  return trendingService.getState();
}

/** Async. Fetches from network if stale. */
export function fetchYouTubeTrending(): Promise<TrendingResult> {
  return trendingService.getTrending();
}
