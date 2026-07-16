import { parseLRC, plainToSynced, LyricLine } from '../utils/lrcParser';

export type { LyricLine } from '../utils/lrcParser';

const CACHE_KEY = 'lyrics-cache';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

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
      if (now - v.ts < CACHE_TTL) {
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

  async fetchLyrics(songTitle: string, artist: string): Promise<LyricLine[]> {
    const cacheKey = `${songTitle}::${artist}`.toLowerCase();

    // Check cache first
    const cached = this.memoryCache.get(cacheKey);
    if (cached) return cached.data;

    try {
      const lyrics =
        (await this.tryLRCLib(songTitle, artist)) ??
        (await this.tryLyricsOVH(songTitle, artist)) ??
        (await this.tryLyricsFallback(songTitle, artist));

      const result = lyrics || [];
      if (result.length > 0) {
        this.memoryCache.set(cacheKey, { data: result, ts: Date.now() });
        persistCache(this.memoryCache);
      }
      return result;
    } catch {
      return [];
    }
  }

  private clean(s: string): string {
    return s.replace(/\s*\(.*?\)\s*/g, '').replace(/\s*\[.*?\]\s*/g, '').trim();
  }

  private async tryLRCLib(title: string, artist: string): Promise<LyricLine[] | null> {
    try {
      const res = await fetch(
        `https://lrclib.net/api/get?artist_name=${encodeURIComponent(this.clean(artist))}&track_name=${encodeURIComponent(this.clean(title))}`
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (data.syncedLyrics) return parseLRC(data.syncedLyrics);
      if (data.plainLyrics) return plainToSynced(data.plainLyrics);
      return null;
    } catch {
      return null;
    }
  }

  private async tryLyricsOVH(title: string, artist: string): Promise<LyricLine[] | null> {
    try {
      const res = await fetch(
        `https://lrclib.net/api/search?q=${encodeURIComponent(this.clean(artist) + ' ' + this.clean(title))}`
      );
      if (!res.ok) return null;
      const data = await res.json();
      for (const item of data) {
        if (item.syncedLyrics) return parseLRC(item.syncedLyrics);
      }
      if (data.length > 0 && data[0].plainLyrics) return plainToSynced(data[0].plainLyrics);
      return null;
    } catch {
      return null;
    }
  }

  private async tryLyricsFallback(title: string, artist: string): Promise<LyricLine[] | null> {
    try {
      const res = await fetch(
        `https://api.lyrics.ovh/suggest/${encodeURIComponent(artist + ' ' + title + ' lyrics')}`
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (data.data?.length > 0) {
        const first = data.data[0];
        const lr = await fetch(
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
