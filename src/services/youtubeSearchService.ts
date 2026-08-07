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

const INVIDIOUS_INSTANCES = [
  'https://yewtu.be',
  'https://invidious.flokinet.to',
  'https://invidious.io.lol',
];

const SEARCH_TIMEOUT_MS = 8000;

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
    .filter((r: any) => r && r.videoId && r.title && r.lengthSeconds > 0)
    .filter((r: any) => r.lengthSeconds >= 60 && r.lengthSeconds <= 900)
    .filter((r: any) => !isBlacklisted(r.title || ''))
    .map((r: any) => ({
      id: r.videoId,
      title: cleanTitle(r.title || 'Unknown'),
      artist: r.author || r.uploader || 'Unknown',
      duration: r.lengthSeconds || 0,
      thumbnail: getBestThumbnail(r.videoThumbnails, r.videoId),
      viewCount: r.viewCount || 0,
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
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return parseResults(data);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Search YouTube, racing all Invidious instances simultaneously.
 * Returns results from the fastest responding instance.
 */
export async function youtubeSearch(
  query: string,
  signal?: AbortSignal,
): Promise<YTSong[]> {
  if (!query.trim()) return [];

  // Enhance query for better music-only results
  const hasMusicTerm = /\b(song|music|audio|video|singer|artist|album|playlist)\b/i.test(query);
  const musicQuery = hasMusicTerm ? `${query} official` : `${query} official audio song`;

  // Race all instances — fastest non-empty result wins
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
    return [];
  }
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
