import { parseLRC, plainToSynced, LyricLine } from '../utils/lrcParser';

export type { LyricLine } from '../utils/lrcParser';

const CACHE_KEY = 'lyrics-cache';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
// "No lyrics found" results are cached too, but with a short TTL so a
// song without lyrics never re-runs the whole slow source chain per play.
const NEGATIVE_TTL = 6 * 60 * 60 * 1000; // 6 hours
// Hard cap: every source chain must finish inside this budget so the store's
// own timeout is never raced by an unbounded cascade of source timeouts.
const TOTAL_BUDGET_MS = 9_000;
const MAX_CACHE_ENTRIES = 150;

interface CacheEntry {
  data: LyricLine[];
  ts: number;
}

function loadCache(): Map<string, CacheEntry> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, CacheEntry>;
    const now = Date.now();
    const map = new Map<string, CacheEntry>();
    for (const [k, v] of Object.entries(obj)) {
      if (!v || !Array.isArray(v.data)) continue;
      const ttl = v.data.length > 0 ? CACHE_TTL : NEGATIVE_TTL;
      if (now - v.ts < ttl) {
        map.set(k, v);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

function persistCache(map: Map<string, CacheEntry>): void {
  try {
    const obj: Record<string, CacheEntry> = {};
    for (const [k, v] of map) {
      obj[k] = v;
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

export class LyricsService {
  private memoryCache = loadCache();
  // Deduplicates concurrent fetches for the same song — a slow API must
  // never be hammered by rapid song switches or double mounts.
  private inflight = new Map<string, Promise<LyricLine[]>>();

  async fetchLyrics(songTitle: string, artist: string): Promise<LyricLine[]> {
    if (!songTitle || !artist) return [];
    const cacheKey = `${songTitle}::${artist}`.toLowerCase();

    // Check cache first (includes recent "no lyrics" results).
    const cached = this.memoryCache.get(cacheKey);
    if (cached) {
      const ttl = cached.data.length > 0 ? CACHE_TTL : NEGATIVE_TTL;
      if (Date.now() - cached.ts < ttl) return cached.data;
      this.memoryCache.delete(cacheKey);
    }

    const pending = this.inflight.get(cacheKey);
    if (pending) return pending;

    const job = this.resolveLyrics(songTitle, artist)
      .catch(() => [] as LyricLine[])
      .then((result) => {
        this.inflight.delete(cacheKey);
        this.memoryCache.set(cacheKey, { data: result, ts: Date.now() });
        this.evictIfNeeded();
        persistCache(this.memoryCache);
        return result;
      });
    this.inflight.set(cacheKey, job);
    return job;
  }

  /** Run every source inside ONE bounded total budget. */
  private async resolveLyrics(songTitle: string, artist: string): Promise<LyricLine[]> {
    const deadline = Date.now() + TOTAL_BUDGET_MS;
    const sources = [
      () => this.tryLRCLib(songTitle, artist),
      () => this.tryLyricsOVH(songTitle, artist),
      () => this.tryLyricsFallback(songTitle, artist),
    ];
    for (const source of sources) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break; // budget exhausted — give up cleanly
      const lyrics = await source();
      if (lyrics && lyrics.length > 0) return lyrics;
    }
    return [];
  }

  /** Keep the persisted cache bounded — evict oldest entries first. */
  private evictIfNeeded(): void {
    while (this.memoryCache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = this.memoryCache.keys().next().value;
      if (oldestKey === undefined) break;
      this.memoryCache.delete(oldestKey);
    }
  }

  private clean(s: string): string {
    return s.replace(/\s*\(.*?\)\s*/g, '').replace(/\s*\[.*?\]\s*/g, '').trim();
  }

  private async fetchWithTimeout(url: string, timeoutMs = 6000): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  private async tryLRCLib(title: string, artist: string): Promise<LyricLine[] | null> {
    try {
      const res = await this.fetchWithTimeout(
        `https://lrclib.net/api/get?artist_name=${encodeURIComponent(this.clean(artist))}&track_name=${encodeURIComponent(this.clean(title))}`
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (data.syncedLyrics) {
        const synced = parseLRC(data.syncedLyrics);
        if (synced.length > 0) return synced;
      }
      if (data.plainLyrics) return plainToSynced(data.plainLyrics);
      return null;
    } catch {
      return null;
    }
  }

  private async tryLyricsOVH(title: string, artist: string): Promise<LyricLine[] | null> {
    try {
      const res = await this.fetchWithTimeout(
        `https://lrclib.net/api/search?q=${encodeURIComponent(this.clean(artist) + ' ' + this.clean(title))}`
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data)) return null;
      for (const item of data) {
        if (item.syncedLyrics) {
          const synced = parseLRC(item.syncedLyrics);
          if (synced.length > 0) return synced;
        }
      }
      if (data.length > 0 && data[0].plainLyrics) return plainToSynced(data[0].plainLyrics);
      return null;
    } catch {
      return null;
    }
  }

  private async tryLyricsFallback(title: string, artist: string): Promise<LyricLine[] | null> {
    try {
      const res = await this.fetchWithTimeout(
        `https://api.lyrics.ovh/suggest/${encodeURIComponent(artist + ' ' + title + ' lyrics')}`
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (data.data?.length > 0) {
        const first = data.data[0];
        const lr = await this.fetchWithTimeout(
          `https://api.lyrics.ovh/v1/${encodeURIComponent(first.artist.name)}/${encodeURIComponent(first.title)}`
        );
        if (lr.ok) {
          const ld = await lr.json();
          if (ld.lyrics) return plainToSynced(ld.lyrics);
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  clearCache(): void {
    this.memoryCache.clear();
    localStorage.removeItem(CACHE_KEY);
  }
}

export const lyricsService = new LyricsService();
