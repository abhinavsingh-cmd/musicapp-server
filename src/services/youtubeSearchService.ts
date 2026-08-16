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
import { api, apiFetch, raceWithDeadline } from '../config/api';

const INVIDIOUS_INSTANCES = [
  'https://yewtu.be',
  'https://invidious.flokinet.to',
  'https://invidious.io.lol',
];

export const SEARCH_TIMEOUT_MS = 8000;

// ── Non-music keyword blacklist ──────────────────────────────────
// Titles matching these are almost certainly NOT music.
const BLACKLIST_PATTERNS: RegExp[] = [
  // Shorts
  /#shorts?\b/i,
  /\bshorts?\s*(#|\d)/i,

  // Podcasts / talk shows
  /\bpodcast\b/i,
  /\bepisode\s*#?\d+/i,
  /\bep\.?\s*\d+/i,
  /\btalk\s*show/i,
  /\bdebate\b/i,
  /\bdiscussion\b/i,
  /\bpanel\b/i,

  // Lectures / education
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

  // Study / academic
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

  // Gaming
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

  // Movies / trailers / clips
  /\bmovie\b/i,
  /\btrailer\b/i,
  /\bofficial\s*trailer\b/i,
  /\bfull\s*movie\b/i,
  /\bscene\b.*\bfrom\b/i,
  /\bbehind\s*the\s*scenes\b/i,
  /\binterview\b/i,
  /\bpress\s*conference\b/i,
  /\bpaparazzi\b/i,

  // Vlogs / lifestyle
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

  // Sports / news / politics
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

  // Tech / reviews
  /\breview\b/i,
  /\bunboxing\b/i,
  /\bvs\.?\b/i,
  /\bcomparison\b/i,
  /\btech\s*news\b/i,
  /\bsmartphone\b/i,
  /\blaptop\b/i,
];

// ── Music keyword whitelist ──────────────────────────────────────
// Boost score for these — they indicate music content.
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

/**
 * Check if a title matches any blacklist pattern.
 * Returns true if the result should be EXCLUDED.
 */
function isBlacklisted(title: string): boolean {
  return BLACKLIST_PATTERNS.some(p => p.test(title));
}

/**
 * Score a title by music relevance. Higher = more likely music.
 * 0 = neutral, positive = music, negative = non-music.
 */
function scoreMusicRelevance(title: string): number {
  let score = 0;
  for (const p of WHITELIST_PATTERNS) {
    if (p.test(title)) score += 2;
  }
  // Short titles (< 5 words) are more likely song titles
  if (title.split(/\s+/).length <= 5) score += 1;
  // All caps often indicates a song name
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
    // Hard deadlines on both the fetch and the body read: an instance that
    // wedges (fetch ignoring its abort) or stalls mid-body must reject within
    // SEARCH_TIMEOUT_MS so Promise.any — and therefore the whole search —
    // can never stay pending forever.
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

/**
 * Search YouTube, racing all Invidious instances simultaneously.
 * Returns results from the fastest responding instance.
 *
 * Error contract: the search NEVER returns an error disguised as empty
 * results. A definitive "no results" answer (server replied with a valid
 * envelope containing no usable rows) resolves with []; a genuine failure
 * (server unreachable/timed out/errored AND every fallback instance
 * failed) REJECTS with the server-side error so callers can surface an
 * explicit network/server/timeout state instead of a fake "no results".
 */
export async function youtubeSearch(
  query: string,
  signal?: AbortSignal,
): Promise<YTSong[]> {
  if (!query.trim()) return [];

  // Enhance query for better music-only results
  const hasMusicTerm = /\b(song|music|audio|video|singer|artist|album|playlist)\b/i.test(query);
  const musicQuery = hasMusicTerm ? `${query} official` : `${query} official audio song`;

  // Why the primary path failed. Non-null => the search is in an error
  // state and MUST reject once every fallback also fails.
  let serverError: Error | null = null;
  // True when the server answered authoritatively with zero usable rows.
  // That is a legitimate "no results" — never an error.
  let serverDefinitive = false;

  // PRIMARY: Use server endpoint (yt-dlp YouTube search).
  // NOTE: must go through api() — a hardcoded relative URL silently 404s
  // whenever the API is served from a different host (production), which
  // made search look broken while reporting no error.
  try {
    const url = api(`/youtube/search?q=${encodeURIComponent(musicQuery)}`);
    const result = await apiFetch(url, { timeout: 12_000, retries: 1, signal });

    // Malformed-response protection: a body that isn't valid JSON, or isn't
    // the expected shape, falls through to the Invidious fallback — it can
    // never produce garbage rows or throw into the caller.
    // Bounded body read: apiFetch's timeout stops when the headers arrive, so
    // a server that stalls mid-body would otherwise hang the search forever.
    // A stalled body is treated exactly like a parse failure.
    let data: any = null;
    try {
      data = await raceWithDeadline(result.json(), 12_000, url);
    } catch (parseErr) {
      serverError = parseErr instanceof Error ? parseErr : new Error('Malformed search response');
      logError('Server search returned malformed JSON:', parseErr);
    }

    if (data !== null && typeof data === 'object') {
      const wrapped = (data as any)?.details?.results ?? (data as any)?.results;
      if (Array.isArray(wrapped)) {
        // Normalize at the boundary: every emitted row MUST have a non-empty
        // playable id, a finite duration, and a usable thumbnail. Rows that
        // cannot satisfy this are dropped — a result with no id can never be
        // played and would produce a broken queue item if clicked.
        const seen = new Set<string>();
        const normalized = wrapped
          .map((r: any): YTSong | null => {
            const id = typeof r?.id === 'string' && r.id.trim()
              ? r.id.trim()
              : typeof r?.youtubeId === 'string' && r.youtubeId.trim()
                ? r.youtubeId.trim()
                : '';
            if (!id) return null;
            // Duplicate-result protection: providers occasionally return the
            // same video twice — duplicates break React keys and confuse users.
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
          return normalized;
        }
        // Valid envelope, zero usable rows — the server answered
        // authoritatively. Only the Invidious fallback can still help.
        serverDefinitive = true;
      } else {
        serverError ??= new Error('Malformed search response');
      }
    }
  } catch (err) {
    if (signal?.aborted) return [];
    serverError = err instanceof Error ? err : new Error(String(err));
    logError('Server search failed, falling back to Invidious:', err);
  }

  // FALLBACK: Race Invidious instances
  const promises = INVIDIOUS_INSTANCES.map(instance =>
    searchViaInstance(instance, musicQuery, signal).then(results => {
      if (results.length === 0) throw new Error('Empty results');
      return results;
    })
  );

  try {
    const results = await Promise.any(promises);
    log(`Promise.any resolved with ${results.length} results`);
    return results;
  } catch (err) {
    if (signal?.aborted) return [];
    logError('All Invidious instances failed:', err);
    // Only a definitive server answer makes this a real "no results" state.
    // Everything else is a genuine failure and must surface as an error.
    if (serverDefinitive) return [];
    throw serverError ?? new Error('YouTube search unavailable');
  }
}

/**
 * Coerce an arbitrary server value to a finite, non-negative number.
 * Servers have returned durations/viewCounts as strings, null, and even
 * missing entirely — downstream math and rendering require real numbers.
 */
function toSafeNumber(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
}

function cleanTitle(title: string): string {
  return title
    .replace(/\(official\s*(music\s*)?video\)/gi, '')
    .replace(/\(lyrics?\)/gi, '')
    .replace(/\[official\s*(music\s*)?video\]/gi, '')
    .replace(/\(audio\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
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
