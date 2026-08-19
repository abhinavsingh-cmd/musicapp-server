import { Song } from '../types/music';
import { api, apiFetch } from '../config/api';
import { useSongsStore } from '../stores/songsStore';
import { logger } from '../utils/logger';

/**
 * Where the trending data currently on screen actually came from.
 * Explicit priority chain: LIVE → CACHED → LIBRARY → BUILT_IN.
 * Fallback data must NEVER be labeled LIVE, and empty results are never
 * cached as successful trending data.
 */
export type TrendingSourceLabel = 'LIVE' | 'CACHED' | 'LIBRARY' | 'BUILT_IN';

export interface TrendingResult {
  songs: Song[];
  source: TrendingSourceLabel;
  /** Upstream origin detail when known ('youtube_music' | 'charts'). */
  origin?: string;
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
// The server's live fetch (yt-dlp) can take up to ~45s on a cold cache.
// A single failed request must NOT drop us straight to fallback: retry with
// backoff so a later attempt can pick up the server's completed live fetch.
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 25_000;
const TOTAL_TIMEOUT_MS = 55_000;

// ── Built-in fallback (20 popular songs) ───────────────────────────────────
const BUILTIN: TrendingResult = {
  source: 'BUILT_IN',
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

function toFiniteDuration(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Validate the server's raw result items. Malformed/unplayable items are
 * skipped individually — a few bad rows must never discard a whole live
 * response. An item is playable only if it has a non-empty id AND title.
 */
function validateServerItems(items: unknown): Song[] {
  if (!Array.isArray(items)) return [];
  const songs: Song[] = [];
  for (const r of items) {
    if (!r || typeof r !== 'object') continue;
    const item = r as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    if (!id || !title) continue; // unplayable — skip only this item
    const artist = typeof item.artist === 'string' && item.artist.trim()
      ? item.artist.trim()
      : 'Unknown';
    songs.push({
      id: 'trending-' + id,
      youtubeId: id,
      title,
      artist,
      genre: 'Trending',
      duration: toFiniteDuration(item.duration),
      coverArt: typeof item.thumbnail === 'string' ? item.thumbnail : '',
      album: '',
      audioUrl: '',
      releaseYear: 0,
      isFavorite: false,
      playCount: 0,
    });
  }
  return songs;
}

/** True if the reported upstream origin is genuine live data. */
function isLiveOrigin(origin: string): boolean {
  return origin === 'youtube_music' || origin === 'charts';
}

/**
 * Normalize persisted results written by older versions of this service
 * (legacy lowercase source strings) into the current label scheme.
 */
function normalizeResult(result: TrendingResult): TrendingResult {
  const legacy = result.source as string;
  if (legacy === 'youtube_music' || legacy === 'charts') {
    return { ...result, source: 'LIVE', origin: result.origin ?? legacy };
  }
  if (legacy === 'cache') return { ...result, source: 'CACHED' };
  if (legacy === 'local_library') return { ...result, source: 'LIBRARY' };
  if (legacy === 'builtin') return { ...result, source: 'BUILT_IN' };
  return result;
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
    source: 'LIBRARY',
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
    return this.cache !== null && this.cache.source === 'LIVE' && this.cache.songs.length > 0 && Date.now() - this.cacheTime < CACHE_TTL;
  }

  // ── Persistence ──

  private loadFromDisk(): TrendingResult | null {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const entry: CacheEntry = JSON.parse(raw);
      if (!entry.data?.songs || !Array.isArray(entry.data.songs)) return null;
      if (entry.data.songs.length === 0) return null; // empty data is never valid
      if (Date.now() - entry.cachedAt > CACHE_MAX_AGE) return null;
      const result = normalizeResult(entry.data);
      // Disk data is not freshly verified by the server — label it CACHED,
      // never LIVE, even though it was originally live at fetch time.
      if (result.source === 'LIVE') return { ...result, source: 'CACHED' as const };
      return result;
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

  /**
   * Cache live results in memory + disk. ONLY non-empty LIVE results are
   * cached — CACHED/LIBRARY/BUILT_IN data and empty results must never be
   * persisted as successful trending data or masquerade as live later.
   */
  private setCache(result: TrendingResult): void {
    if (result.source !== 'LIVE' || result.songs.length === 0) {
      logger.debug(`[Trending] Skipping cache for source=${result.source}, songs=${result.songs.length}`);
      return;
    }
    this.cache = result;
    this.cacheTime = Date.now();
    this.saveToDisk(result);
    this.notify();
  }

  /**
   * Explicit fallback priority chain after a failed/empty live fetch:
   * cached live result (memory → disk, honestly labeled CACHED)
   *   → valid library data → built-in catalog.
   */
  private bestAvailableFallback(reason: string): TrendingResult {
    for (const candidate of [this.cache, this.loadFromDisk()]) {
      if (candidate && candidate.songs.length > 0 && (candidate.source === 'LIVE' || candidate.source === 'CACHED')) {
        logger.warn(`[Trending] CACHED_YOUTUBE: Serving cached live data as CACHED (${reason})`);
        return { ...candidate, source: 'CACHED' };
      }
    }
    const fallback = buildLocalFallback();
    const marker = fallback.source === 'LIBRARY' ? 'LIBRARY_FALLBACK' : 'BUILT_IN_FALLBACK';
    logger.warn(`[Trending] ${marker}: Falling back to ${fallback.source} (${reason})`);
    return fallback;
  }

  // ── Network ──

  private async fetchFromNetwork(): Promise<TrendingResult> {
    const startTime = Date.now();
    let lastError: string = '';

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (Date.now() - startTime > TOTAL_TIMEOUT_MS) break;

      const reqStart = Date.now();
      try {
        logger.debug(`[Trending] Request started (attempt ${attempt + 1}/${MAX_RETRIES}) → ${api('/charts/trending.json')}`);
        const res = await apiFetch(api('/charts/trending.json'), {
          timeout: REQUEST_TIMEOUT_MS,
          retries: 0,
          // NEVER re-serve a previously cached trending response here.
          // The generic apiFetch cache would keep returning a stale fallback
          // (or empty) payload long after the server recovered, blocking the
          // recovery back to LIVE.
          cacheTTL: 0,
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) throw new Error('Not JSON');

        let data: any;
        try {
          data = await res.json();
        } catch {
          throw new Error('Invalid JSON payload');
        }

        const payload = data?.details ?? data ?? {};
        const origin: string = typeof payload?.source === 'string' ? payload.source : '';
        const rawResults = payload?.results;
        // Item-level validation: malformed/unplayable rows are skipped
        // individually — they must never discard the whole response.
        const songs = validateServerItems(rawResults);
        const serverFresh = payload?.fresh !== false;
        const reqTime = Date.now() - reqStart;

        if (isLiveOrigin(origin) && Array.isArray(rawResults) && songs.length > 0) {
          const result: TrendingResult = {
            songs,
            // Data served from the server's own cache is live-sourced but
            // stale — label it CACHED, never LIVE.
            source: serverFresh ? 'LIVE' : 'CACHED',
            origin,
            lastUpdated: typeof payload?.lastUpdated === 'number' ? payload.lastUpdated : Date.now(),
          };
          if (result.source === 'CACHED') {
            logger.debug(`[Trending] CACHED_YOUTUBE: ${songs.length} songs from ${origin} (server-stale, responseTime=${reqTime}ms)`);
          } else {
            logger.debug(`[Trending] LIVE_YOUTUBE: ${songs.length} songs from ${origin} (live, responseTime=${reqTime}ms)`);
          }
          this.recordSuccess(Date.now() - startTime);
          return result;
        }

        if (isLiveOrigin(origin) && Array.isArray(rawResults)) {
          // HTTP 200 but zero VALID items. The server genuinely has no live
          // data right now — retrying would hit the same empty answer. Do
          // NOT cache this; fall through to the fallback chain.
          lastError = `Live response empty (origin=${origin})`;
          logger.warn(`[Trending] ⚠️ Server returned empty/invalid results (origin=${origin}, reqTime=${reqTime}ms)`);
          break;
        }

        if (isLiveOrigin(origin)) {
          // Live origin but a structurally broken body (results not an
          // array). That is NOT a definitive answer — it can be a transient
          // proxy/pipeline glitch, so retry instead of falling back at once.
          lastError = `Malformed live response (origin=${origin}, results not an array)`;
          logger.warn(`[Trending] ⚠️ ${lastError}, reqTime=${reqTime}ms — treating as transient, retrying`);
        } else if (origin) {
          // The server itself already fell back (builtin/etc). This is a
          // definitive answer — no point retrying the same response.
          lastError = `Server has no live data (source=${origin})`;
          logger.warn(`[Trending] ⚠️ ${lastError}, reqTime=${reqTime}ms`);
          break;
        } else {
          // No origin at all — structurally malformed envelope. Might be a
          // transient glitch; retry before dropping to the fallback chain.
          lastError = 'Malformed response (missing source origin)';
          logger.warn(`[Trending] ⚠️ ${lastError}, reqTime=${reqTime}ms — treating as transient, retrying`);
        }
      } catch (err) {
        const reqTime = Date.now() - reqStart;
        lastError = err instanceof Error ? err.message : 'Unknown error';
        logger.warn(`[Trending] ❌ Request failed (attempt ${attempt + 1}): ${lastError}, reqTime=${reqTime}ms`);
      }

      // Exponential backoff: 1s, 2s, 4s… — a first failed request must not
      // immediately drop to fallback; the server may still be completing a
      // legitimate live fetch.
      if (attempt < MAX_RETRIES - 1) {
        const delay = Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
        logger.debug(`[Trending] Backing off ${delay}ms before retry...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    logger.warn(`[Trending] ❌ Live fetch unsuccessful: ${lastError}`);
    this.recordFailure();
    // Explicit priority chain: CACHED live data → LIBRARY → BUILT_IN.
    return this.bestAvailableFallback(lastError);
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
   * Get trending data. Returns immediately from cache if fresh AND live.
   * If stale, missing, or contains only fallback data, fetches from network.
   * Always returns the best available data (never empty).
   */
  async getTrending(): Promise<TrendingResult> {
    // 1. Return fresh live cache immediately
    if (this.cache && this.cache.source === 'LIVE' && this.cache.songs.length > 0 && Date.now() - this.cacheTime < CACHE_TTL) {
      logger.debug(`[Trending] LIVE_YOUTUBE: ${this.cache.songs.length} songs (fresh cache hit, origin=${this.cache.origin || 'unknown'}, age=${Math.round((Date.now() - this.cacheTime) / 1000)}s)`);
      return this.cache;
    }

    // If cache exists but contains fallback data, log it clearly
    if (this.cache && this.cache.source !== 'LIVE') {
      logger.debug(`[Trending] Cache contains fallback data (source=${this.cache.source}). Attempting live fetch...`);
    }

    logger.debug(`[Trending] Cache MISS or stale (age=${this.cache ? Math.round((Date.now() - this.cacheTime) / 1000) + 's' : 'null'}), fetching from network...`);

    // 2. Deduplicate concurrent requests
    if (this.inFlight) {
      logger.debug('[Trending] Deduplicating concurrent request');
      return this.inFlight;
    }

    // 3. Fetch from network
    this.inFlight = this.fetchFromNetwork()
      .then(result => {
        this.setCache(result);
        logger.debug(`[Trending] Network fetch complete: ${result.songs.length} songs, source=${result.source}`);
        return result;
      })
.catch((err) => {
        // Defensive — fetchFromNetwork resolves with a fallback instead of
        // throwing, so this path only ever runs on unexpected errors.
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn(`[Trending] Unexpected fetch error: ${reason}`);
        return this.bestAvailableFallback(reason);
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
    const disk = this.loadFromDisk();
    if (disk) {
      this.cache = disk;
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        try {
          const entry: CacheEntry = JSON.parse(raw);
          this.cacheTime = entry.cachedAt || 0;
        } catch {
          this.cacheTime = 0;
        }
      } else {
        this.cacheTime = 0;
      }
      const age = Math.round((Date.now() - this.cacheTime) / 1000);
      logger.debug(`[Trending] CACHED_YOUTUBE: init loaded ${disk.songs.length} songs from disk (source=${disk.source}, age=${age}s)`);
    } else {
      logger.debug('[Trending] init: no disk cache, using builtin');
    }

    this.startBackgroundRefresh();

    return this.cache ?? BUILTIN;
  }

  private startBackgroundRefresh(): void {
    this.stopBackgroundRefresh();
    logger.debug(`[Trending] Background refresh started (interval: ${BACKGROUND_INTERVAL / 1000}s)`);
    this.backgroundTimer = setInterval(() => {
      logger.debug('[Trending] Background refresh triggered');
      this.getTrending();
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
