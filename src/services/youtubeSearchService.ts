/**
 * YouTube Search Service
 *
 * Client-side YouTube search using Invidious API instances.
 * Races all instances simultaneously via Promise.any for fastest response.
 * Free, no API key required.
 *
 * Post-filters results to return ONLY music:
 *   - Blacklists non-music keywords (shorts, podcasts, lectures, gaming, etc.)
 *   - Whitelists music keywords (official audio, lyrics, music video, etc.)
 *   - Scores results by music relevance and sorts accordingly
 */

import { YTSong } from '../stores/searchStore';
import { api, apiFetch, raceWithDeadline, RateLimitError, TimeoutError, NetworkError } from '../config/api';

const INVIDIOUS_INSTANCES: string[] = [
  'https://yewtu.be',
  'https://invidious.flokinet.to',
  'https://invidious.io.lol',
];

export const SEARCH_TIMEOUT_MS = 8000;

const searchCache = new Map<string, { results: YTSong[]; expiresAt: number }>();
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SEARCH_CACHE_MAX = 50;

function getCachedSearch(query: string): YTSong[] | null {
  const cached = searchCache.get(query.toLowerCase().trim());
  if (cached && cached.expiresAt > Date.now()) return cached.results;
  if (cached) searchCache.delete(query.toLowerCase().trim());
  return null;
}

function setCachedSearch(query: string, results: YTSong[]): void {
  const key = query.toLowerCase().trim();
  if (searchCache.size >= SEARCH_CACHE_MAX) {
    const oldest = searchCache.keys().next().value;
    if (oldest !== undefined) searchCache.delete(oldest);
  }
  searchCache.set(key, { results, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
}

interface CooldownEntry {
  expiresAt: number;
  retryAfterMs?: number;
}

const cooldownCache = new Map<string, CooldownEntry>();

function getCooldown(query: string): CooldownEntry | null {
  const entry = cooldownCache.get(query.toLowerCase().trim());
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    cooldownCache.delete(query.toLowerCase().trim());
    return null;
  }
  return entry;
}

function setCooldown(query: string, retryAfterMsParam?: number): void {
  const key = query.toLowerCase().trim();
  const effectiveRetryMs = retryAfterMsParam 
    ? Math.min(retryAfterMsParam, 5 * 60 * 1000) 
    : 30_000;
  const expiresAt = Date.now() + Math.min(effectiveRetryMs, 5 * 60 * 1000);
  cooldownCache.set(key, { expiresAt, retryAfterMs: retryAfterMsParam ?? 30_000 });
}

function clearCooldown(query: string): void {
  cooldownCache.delete(query.toLowerCase().trim());
}

export function clearSearchCache(): void {
  searchCache.clear();
}

const BLACKLIST_PATTERNS: RegExp[] = [
  /#shorts?\b/i,
  /\bshorts?\s*(#|\d)/i,
  /\bpodcast\b/i,
  /\bepisode\s*#?\d+/i,
  /\bep\.?\s*\d+/i,
  /\btalk\s*show/i,
  /\bdebate\b/i,
  /\bdiscussion\b/i,
  /\bpanel\b/i,
  /\blecture\b/i,
  /\btutorial\b/i,
  /\blesson\b/i,
  /\bcourse\b/i,
  /\bclass(?:room)?\b/i,
  /\bprofessor\b/i,
  /\buniversity\b/i,
  /\bcollege\b/i,
  /\bseminar\b/i,
  /\bworkshop\b/i,
  /\bwebinar\b/i,
  /\bstudy\b/i,
  /\bexam\b/i,
  /\bpreparation\b/i,
  /\brevision\b/i,
  /\bnotes\b/i,
  /\bhomework\b/i,
  /\bassignment\b/i,
  /\bsyllabus\b/i,
  /\bphysics\b/i,
  /\bchemistry\b/i,
  /\bmath(?:s|ematics)?\b/i,
  /\bcalculus\b/i,
  /\balgebra\b/i,
  /\bgeometry\b/i,
  /\bbiology\b/i,
  /\bhistory\b(?:\s+of)?/i,
  /\bgeography\b/i,
  /\bcomputer\s*science\b/i,
  /\bprogramming\b/i,
  /\bcoding\b/i,
  /\bdata\s*science\b/i,
  /\bmachine\s*learning\b/i,
  /\bartificial\s*intelligence\b/i,
  /\bgaming\b/i,
  /\bgameplay\b/i,
  /\bwalkthrough\b/i,
  /\blets\s*play\b/i,
  /\blive\s*stream\b/i,
  /\btwitch\b/i,
  /\bfortnite\b/i,
  /\bminecraft\b/i,
  /\bvalorant\b/i,
  /\bgta\b/i,
  /\bpubg\b/i,
  /\bapex\b/i,
  /\broblox\b/i,
  /\bcrusader\s*kings\b/i,
  /\bmovie\b/i,
  /\btrailer\b/i,
  /\bofficial\s*trailer\b/i,
  /\bfull\s*movie\b/i,
  /\bscene\b.*\bfrom\b/i,
  /\bbehind\s*the\s*scenes\b/i,
  /\binterview\b/i,
  /\bpress\s*conference\b/i,
  /\bpaparazzi\b/i,
  /\bvlog\b/i,
  /\bdaily\s*vlog\b/i,
  /\broutine\b/i,
  /\bday\s*in\s*the\s*life\b/i,
  /\bmorning\s*routine\b/i,
  /\bbedroom\s*tour\b/i,
  /\broom\s*tour\b/i,
  /\bhous(?:e|ing)\s*tour\b/i,
  /\bprank\b/i,
  /\bchallenge\b/i,
  /\bdare\b/i,
  /\breaction\b/i,
  /\bhighlights?\b/i,
  /\bnews\b/i,
  /\bpolitic/i,
  /\belection\b/i,
  /\bpress\b.*\brelease\b/i,
  /\bsports?\b/i,
  /\bcricket\b/i,
  /\bfootball\b/i,
  /\bsoccer\b/i,
  /\bnba\b/i,
  /\bnfl\b/i,
  /\breview\b/i,
  /\bunboxing\b/i,
  /\bvs\.?\b/i,
  /\bcomparison\b/i,
  /\btech\s*news\b/i,
  /\bsmartphone\b/i,
  /\blaptop\b/i,
];

const WHITELIST_PATTERNS: RegExp[] = [
  /\bofficial\s*audio\b/i,
  /\bofficial\s*music\s*video\b/i,
  /\bofficial\s*video\b/i,
  /\bofficial\s*song\b/i,
  /\b(remastered|remaster)\b/i,
  /\b(lyrics?|lyric\s*video)\b/i,
  /\b(audio|visualizer|visualiser)\b/i,
  /\b(song|track|single|album)\b/i,
  /\bmv\b/,
  /\blive\s*(performance|session|concert|acoustic)\b/i,
  /\bacoustic\s*(version|cover|session)\b/i,
  /\bcover\s*(version)?\b/i,
  /\bkaraoke\b/i,
  /\binst(?:rumental|\.?\s*ver(?:sion)?)\b/i,
  /\b(version|ver\.?)\b.*\b(of|from)\b/i,
  /\bfrom\b.*\b(album|movie|film|series|soundtrack)\b/i,
  /\bsoundtrack\b/i,
  /\bfeat\.?\b/i,
  /\bft\.?\b/i,
  /\bextended\s*(mix|version)\b/i,
  /\bclub\s*(mix|remix)\b/i,
  /\bremix\b/i,
  /\bmashup\b/i,
  /\bsped\s*up\b/i,
  /\bslowed\b/i,
  /\breverb\b/i,
];

function log(...args: any[]) {
  if (import.meta.env.DEV) console.log('[YTSearch]', ...args);
}

function logError(...args: any[]) {
  if (import.meta.env.DEV) console.error('[YTSearch]', ...args);
}

function cleanTitle(title: string): string {
  return title
    .replace(/[()[\]{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toSafeNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function isBlacklisted(title: string): boolean {
  return BLACKLIST_PATTERNS.some(p => p.test(title));
}

function scoreMusicRelevance(title: string): number {
  let score = 0;
  for (const p of WHITELIST_PATTERNS) {
    if (p.test(title)) score += 2;
  }
  if (title.split(/\s+/).length <= 5) score += 1;
  if (title === title.toUpperCase() && title.length > 3) score += 1;
  return score;
}

function parseResults(data: unknown): YTSong[] {
  const items = Array.isArray(data) ? data : [];
  return items
    .filter((r: any) => r && typeof r.videoId === 'string' && r.videoId.trim() && r.title && toSafeNumber(r.lengthSeconds) > 0)
    .filter((r: any) => toSafeNumber(r.lengthSeconds) >= 60 && toSafeNumber(r.lengthSeconds) <= 900)
    .filter((r: any) => !isBlacklisted(r.title || ''))
    .map((r: any) => ({
      id: r.videoId.trim(),
      title: cleanTitle(r.title || 'Unknown') || 'Unknown',
      artist: r.author || r.uploader || 'Unknown',
      duration: toSafeNumber(r.lengthSeconds),
      thumbnail: getBestThumbnail(r.videoThumbnails, r.videoId.trim()),
      viewCount: toSafeNumber(r.viewCount),
      album: '',
      _score: scoreMusicRelevance(r.title || ''),
    }))
    .sort((a: any, b: any) => (b._score || 0) - (a._score || 0))
    .map(({ _score, ...rest }: any) => rest)
    .slice(0, 20);
}

async function searchViaInstance(
  instance: string,
  query: string,
  signal?: AbortSignal,
): Promise<YTSong[]> {
  if (signal?.aborted) return [];
  const url = `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=music&sort_by=relevance`;
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onCallerAbort, { once: true });
  try {
    const res = await raceWithDeadline(
      fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      }),
      SEARCH_TIMEOUT_MS,
      url,
      () => controller.abort(),
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await raceWithDeadline(res.json(), SEARCH_TIMEOUT_MS, url);
    return parseResults(data);
  } finally {
    if (signal) signal.removeEventListener('abort', onCallerAbort);
  }
}

export async function youtubeSearch(
  query: string,
  signal?: AbortSignal,
): Promise<YTSong[]> {
  if (!query.trim()) return [];
  const cached = getCachedSearch(query);
  if (cached) {
    log(`Cache hit for query: ${query}`);
    return cached;
  }
  const cooldown = getCooldown(query);
  const isCooldownActive = !!cooldown;
  const hasMusicTerm = /\b(song|music|audio|video|singer|artist|album|playlist)\b/i.test(query);
  const musicQuery = hasMusicTerm ? query : `${query} music`;

  let serverError: Error | null = null;
  let serverDefinitive = false;
  let lastRateLimitError: RateLimitError | null = null;

  const serverPromise = (async (): Promise<YTSong[]> => {
    if (isCooldownActive) {
      throw new RateLimitError(
        'Service temporarily unavailable',
        429,
        api(`/youtube/search?q=${encodeURIComponent(query)}`),
        cooldown!.expiresAt - Date.now()
      );
    }
    const url = api(`/youtube/search?q=${encodeURIComponent(musicQuery)}`);
    const result = await apiFetch(url, { timeout: 12_000, retries: 0, signal });
    let data: any;
    try {
      data = await raceWithDeadline(result.json(), 12_000, url);
    } catch (parseErr) {
      serverError = parseErr instanceof Error ? parseErr : new Error('Malformed search response');
      logError('Server search returned malformed JSON:', parseErr);
      throw serverError;
    }
    if (data !== null && typeof data === 'object') {
      const wrapped = (data as any)?.details?.results ?? (data as any)?.results;
      if (Array.isArray(wrapped)) {
        const seen = new Set<string>();
        const normalized = wrapped
          .map((r: any): YTSong | null => {
            const id = typeof r?.id === 'string' && r.id.trim()
              ? r.id.trim()
              : typeof r?.youtubeId === 'string' && r.youtubeId.trim()
                ? r.youtubeId.trim()
                : '';
            if (!id) return null;
            if (seen.has(id)) return null;
            seen.add(id);
            const artist = typeof r?.artist === 'string' && r.artist.trim()
              ? r.artist.trim()
              : typeof r?.channel === 'string' && r.channel.trim()
                ? r.channel.trim()
                : 'Unknown';
            const thumbnail = typeof r?.thumbnail === 'string' && /^https?:\/\//.test(r.thumbnail)
              ? r.thumbnail
              : `https://img.youtube.com/vi/${id}/mqdefault.jpg`;
            return {
              id,
              title: cleanTitle(typeof r.title === 'string' ? r.title : '') || 'Unknown',
              artist,
              duration: toSafeNumber(r.duration),
              thumbnail,
              viewCount: toSafeNumber(r.viewCount),
              album: '',
            };
          })
          .filter((r: YTSong | null): r is YTSong => r !== null);
        if (normalized.length > 0) {
          log(`Server search returned ${normalized.length} results`);
          setCachedSearch(query, normalized);
          clearCooldown(query);
          return normalized;
        }
        serverDefinitive = true;
        throw new Error('Empty server results');
      } else {
        serverError = new Error('Malformed search response');
        throw serverError;
      }
    }
    serverError = new Error('Malformed search response');
    throw serverError;
  })().catch((err: any) => {
    if (signal?.aborted) throw err;
    if (err instanceof RateLimitError) {
      setCooldown(query, err.retryAfterMs);
      lastRateLimitError = err;
      serverError = err;
    } else if (err instanceof TimeoutError || err instanceof NetworkError) {
      const cached = getCachedSearch(query);
      if (cached) return cached as never;
      serverError = err instanceof Error ? err : new Error(String(err));
    } else {
      serverError = err instanceof Error ? err : new Error(String(err));
    }
    logError('Server search failed, falling back to Invidious:', err);
    throw err;
  });

  const invidiousPromises = INVIDIOUS_INSTANCES.map(instance =>
    searchViaInstance(instance, musicQuery, signal).then(results => {
      if (results.length === 0) throw new Error('Empty results');
      return results;
    })
  );

  try {
    const results = await Promise.any([...invidiousPromises, serverPromise as Promise<YTSong[]>]);
    // Cache the winner if it wasn't already cached (Invidious win)
    if (results.length > 0) {
      const alreadyCached = getCachedSearch(query);
      if (!alreadyCached) {
        setCachedSearch(query, results);
        clearCooldown(query);
      }
    }
    log(`Search resolved with ${results.length} results`);
    return results;
  } catch (err) {
    if (signal?.aborted) return [];
    logError('All search instances failed:', err);
    if (serverDefinitive) return [];
    if (lastRateLimitError) {
      const e = lastRateLimitError as any;
      const retryAfterSec = e.retryAfterMs ? Math.ceil(e.retryAfterMs / 1000) : 0;
      e.message = `YouTube search rate limited. ${retryAfterSec > 0 ? `Try again in ~${retryAfterSec}s` : 'Please try again later.'}`;
      throw e;
    }
    throw serverError ?? new Error('YouTube search unavailable');
  }
}

function getBestThumbnail(thumbnails: any[] | undefined, videoId: string): string {
  if (thumbnails && thumbnails.length > 0) {
    const medium = thumbnails.find((t: any) => t.quality === 'medium');
    if (medium?.url) return medium.url;
    const last = thumbnails[thumbnails.length - 1];
    if (last?.url) return last.url;
  }
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}
