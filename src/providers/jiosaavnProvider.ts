/**
 * JioSaavn music provider.
 *
 * Talks to JioSaavn's public api.php through the app's own server: the
 * `/api/jiosaavn` passthrough route in server.cjs. JioSaavn's api.php sends
 * no CORS headers, so browsers and Capacitor WebViews cannot reach it
 * directly; the server proxy is this provider's transport and also rebuilds
 * the upstream query (no raw passthrough of user input).
 *
 * Implemented capabilities — all verified against the live API:
 *   - search        -> search.getResults (api_version=4, `q` param)
 *   - track lookup  -> song.getDetails   (api_version=2, keyed by song id)
 *   - artwork       -> saavncdn image URLs, upgraded to 500x500
 *   - album/artist  -> album name, singers, music director, label, year,
 *                      language carried on the normalized Track
 *   - stream        -> the unencrypted `media_url` when the API offers one;
 *                      otherwise the official `media_preview_url`, clearly
 *                      marked `isPreview`. JioSaavn serves most full-length
 *                      audio AES-encrypted (`encrypted_media_url`) — we
 *                      deliberately do NOT embed decryption keys.
 *
 * Leave unsupported (never faked):
 *   - downloads      -> no legitimate full-length download path
 *   - lyrics/charts/related -> not reliably/legitimately available via the
 *                      public surface this provider is allowed to use
 *
 * JioSaavn song ids are opaque (e.g. "rjkrTnma"). Every result is normalized
 * to the shared Track shape, so the player, queue, and download system never
 * see provider internals.
 */

import { api, apiFetch } from '../config/api';
import { logger } from '../utils/logger';
import {
  PlayableSource,
  ProviderCapabilities,
  ResolveStreamOptions,
  SearchOptions,
  Track,
  TrackProvider,
} from './types';

const JIOSAAVN_CALL_SEARCH = 'search.getResults';
const JIOSAAVN_CALL_DETAILS = 'song.getDetails';
const SEARCH_API_VERSION = '4';
const DETAILS_API_VERSION = '2';
const PROXY_PATH = '/jiosaavn';

const CAPABILITIES: ProviderCapabilities = {
  search: true,
  trackLookup: true,
  lyrics: false,
  charts: false,
  relatedTracks: false,
  downloads: false,
};

// ---------------------------------------------------------------------------
// Validation helpers — every upstream value is sanitized before it enters
// the normalized Track. Missing/malformed fields degrade to safe defaults
// instead of crashing or producing fake data.
// ---------------------------------------------------------------------------

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'));
}

function toSeconds(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.trim());
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return 0;
}

function toYear(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.trim());
    if (Number.isFinite(n) && n >= 0) return Math.round(n);
  }
  return undefined;
}

function toCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.trim());
    if (Number.isFinite(n) && n >= 0) return Math.round(n);
  }
  return 0;
}

/** Saavn CDN serves any size — search/detail images arrive as 150x150. */
function upgradeArtwork(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return '';
  return value.replace(/-\d{2,4}x\d{2,4}\./, '-500x500.');
}

// ---------------------------------------------------------------------------
// HTML-entity decoding. JioSaavn's api.php returns titles/album names
// HTML-escaped (e.g. `Main &quot;Title&quot; Song`, `Rockstar &#039;20&#039;`).
// The normalized Track must carry display-ready text, never raw entities.
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith('#')) {
      const code = parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Decode a text field; missing/non-string values degrade to ''. */
function toText(value: unknown): string {
  return typeof value === 'string' ? decodeEntities(value) : '';
}

/**
 * Search subtitles look like "Pritam, Arijit Singh, Amitabh Bhattacharya -
 * Brahmastra". The first segment is the artists; afterwards an album may
 * follow. Keep it tolerant: single-segment subtitles are just the artist.
 */
function parseSubtitle(subtitle: unknown): { artist: string; album: string } {
  if (typeof subtitle !== 'string' || subtitle.trim() === '') {
    return { artist: '', album: '' };
  }
  const parts = subtitle.split(' - ');
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), album: parts[1].trim() };
  }
  return { artist: subtitle.trim(), album: '' };
}

// ---------------------------------------------------------------------------
// Raw shape parsers
// ---------------------------------------------------------------------------

interface RawSearchResult {
  id?: unknown;
  title?: unknown;
  subtitle?: unknown;
  type?: unknown;
  image?: unknown;
  duration?: unknown;
  year?: unknown;
  language?: unknown;
  play_count?: unknown;
  perma_url?: unknown;
  more_info?: unknown;
}

interface RawSongDetails {
  song?: unknown;
  album?: unknown;
  year?: unknown;
  duration?: unknown;
  image?: unknown;
  language?: unknown;
  label?: unknown;
  singers?: unknown;
  music?: unknown;
  play_count?: unknown;
  perma_url?: unknown;
  release_date?: unknown;
  has_lyrics?: unknown;
  is_drm?: unknown;
  rights?: unknown;
  media_url?: unknown;
  media_preview_url?: unknown;
  encrypted_media_url?: unknown;
}

function trackFromSearchResult(r: RawSearchResult | undefined | null): Track | null {
  if (!r || typeof r.id !== 'string' || r.id === '' || typeof r.title !== 'string') return null;
  // Results can include artists/albums/playlists — only songs are tracks.
  if (r.type !== undefined && r.type !== 'song') return null;

  const sub = parseSubtitle(r.subtitle);
  const more = r.more_info && typeof r.more_info === 'object' && !Array.isArray(r.more_info)
    ? (r.more_info as Record<string, unknown>)
    : {};

  const title = toText(r.title);
  if (!title.trim()) return null;

  const metadata: Record<string, unknown> = {};
  if (typeof r.language === 'string' && r.language) metadata.language = r.language;
  if (typeof more.music === 'string' && more.music) metadata.music = more.music;
  if (typeof more.album_id === 'string' && more.album_id) metadata.albumId = more.album_id;
  if (typeof more.label === 'string' && more.label) metadata.label = more.label;
  if (isHttpUrl(r.perma_url)) metadata.permaUrl = r.perma_url;

  return {
    id: 'jsn-' + r.id,
    provider: 'jiosaavn',
    title,
    artist: decodeEntities(sub.artist) || 'Unknown',
    album: toText(more.album) || decodeEntities(sub.album),
    genre: 'Unknown',
    duration: toSeconds(r.duration),
    artwork: upgradeArtwork(r.image),
    releaseYear: toYear(r.year),
    externalId: r.id,
    playCount: toCount(r.play_count),
    metadata,
  };
}

/** Merge fresher `song.getDetails` data onto a Track. Never fabricates fields. */
function enrichFromDetails(track: Track, d: RawSongDetails | null | undefined): Track {
  if (!d || typeof d !== 'object') return track;

  const metadata: Record<string, unknown> = { ...(track.metadata ?? {}) };
  const addMeta = (key: string, value: unknown) => {
    if (typeof value === 'string' && value !== '') metadata[key] = value;
  };
  addMeta('singers', d.singers);
  addMeta('music', d.music);
  addMeta('label', d.label);
  addMeta('language', d.language);
  addMeta('releaseDate', d.release_date);
  if (isHttpUrl(d.perma_url)) metadata.permaUrl = d.perma_url;
  if (typeof d.has_lyrics !== 'undefined' && typeof d.has_lyrics !== 'object') {
    metadata.hasLyrics = d.has_lyrics;
  }
  if (typeof d.is_drm !== 'undefined' && typeof d.is_drm !== 'object') {
    metadata.isDrm = d.is_drm;
  }
  if (d.rights && typeof d.rights === 'object' && !Array.isArray(d.rights)) {
    const code = (d.rights as Record<string, unknown>).code;
    if (typeof code !== 'undefined') metadata.rightsCode = String(code);
  }

  const seconds = toSeconds(d.duration);
  const detailTitle = toText(d.song);
  const detailAlbum = toText(d.album);
  return {
    ...track,
    title: detailTitle || track.title,
    album: detailAlbum || track.album,
    duration: seconds > 0 ? seconds : track.duration,
    artwork: upgradeArtwork(d.image) || track.artwork,
    releaseYear: toYear(d.year) ?? track.releaseYear,
    playCount: toCount(d.play_count) || track.playCount || 0,
    metadata,
  };
}

// ---------------------------------------------------------------------------
// Transport — through the server proxy (api.php has no CORS headers)
// ---------------------------------------------------------------------------

function jiosaavnUrl(call: string, apiVersion: string, params: Record<string, string>): string {
  const qs = new URLSearchParams();
  qs.set('__call', call);
  qs.set('api_version', apiVersion);
  qs.set('_format', 'json');
  for (const [key, value] of Object.entries(params)) qs.set(key, value);
  return api(`${PROXY_PATH}?${qs.toString()}`);
}

async function fetchJson(
  url: string,
  signal?: AbortSignal,
  cacheTTL?: number,
): Promise<unknown> {
  const res = await apiFetch(url, { signal, cacheTTL, retries: 1 });
  if (!res.ok) throw new Error(`JioSaavn proxy responded ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

class JioSaavnProvider implements TrackProvider {
  readonly id = 'jiosaavn' as const;
  readonly name = 'JioSaavn';
  readonly capabilities = CAPABILITIES;

  async search(query: string, options?: SearchOptions): Promise<Track[]> {
    const q = (query || '').trim();
    if (!q) return [];

    const params: Record<string, string> = { q };
    if (options?.page && options.page > 0) params.page = String(options.page);
    if (options?.limit && options.limit > 0) params.n = String(options.limit);

    try {
      const body = await fetchJson(
        jiosaavnUrl(JIOSAAVN_CALL_SEARCH, SEARCH_API_VERSION, params),
        options?.signal,
      );
      if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
      const results = (body as { results?: unknown }).results;
      if (!Array.isArray(results)) return [];

      const tracks = results
        .map(r => trackFromSearchResult(r as RawSearchResult))
        .filter((t): t is Track => t !== null);
      return options?.limit ? tracks.slice(0, options.limit) : tracks;
    } catch (err) {
      if (options?.signal?.aborted) return [];
      logger.warn('[JioSaavn] search failed:', err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  /**
   * Fetch freshest metadata (song.getDetails) and merge it onto the track.
   * Falls back to the input unchanged when details are unavailable.
   */
  async getTrack(track: Track): Promise<Track> {
    if (!track.externalId) return track;
    try {
      const body = await fetchJson(
        jiosaavnUrl(JIOSAAVN_CALL_DETAILS, DETAILS_API_VERSION, { pids: track.externalId }),
      );
      if (!body || typeof body !== 'object' || Array.isArray(body)) return track;
      const entry = (body as Record<string, unknown>)[track.externalId];
      return enrichFromDetails(track, entry as RawSongDetails | undefined);
    } catch (err) {
      logger.warn('[JioSaavn] getTrack failed for', track.id, err instanceof Error ? err.message : String(err));
      return track;
    }
  }

  /**
   * Stream resolution is "only where permitted": a direct http(s) media_url
   * plays as a normal stream; encrypted URLs are not decrypted (no embedded
   * keys), but the official preview URL is offered, flagged `isPreview`.
   */
  async resolveStream(
    track: Track,
    options?: ResolveStreamOptions,
  ): Promise<PlayableSource | null> {
    if (!track.externalId) return null;
    try {
      const body = await fetchJson(
        jiosaavnUrl(JIOSAAVN_CALL_DETAILS, DETAILS_API_VERSION, { pids: track.externalId }),
        undefined,
        options?.force ? 0 : undefined,
      );
      if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
      const entry = (body as Record<string, unknown>)[track.externalId] as RawSongDetails | undefined;
      if (!entry || typeof entry !== 'object') return null;

      if (isHttpUrl(entry.media_url)) {
        return { kind: 'stream', track, streamUrl: entry.media_url, isLocalFile: false };
      }
      if (isHttpUrl(entry.media_preview_url)) {
        return {
          kind: 'stream',
          track,
          streamUrl: entry.media_preview_url,
          isLocalFile: false,
          isPreview: true,
        };
      }
      return null;
    } catch (err) {
      logger.warn('[JioSaavn] resolveStream failed for', track.id, err instanceof Error ? err.message : String(err));
      return null;
    }
  }
}

export const jiosaavnProvider: TrackProvider = new JioSaavnProvider();