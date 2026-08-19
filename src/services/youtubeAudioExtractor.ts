/**
 * YouTube Audio Extractor
 *
 * Fetches direct audio stream URLs for YouTube videos.
 * This allows playing audio via HTML <audio> instead of YouTube IFrame,
 * which is required for background playback on Android.
 *
 * YouTube IFrame stops when the WebView goes to background.
 * HTML <audio> with a foreground service continues playing — like Spotify.
 *
 * Strategy:
 *   1. Server yt-dlp audio-info endpoint (fastest, uses server-side yt-dlp)
 *   2. Invidious API instances (fallback, most are dead as of 2026)
 *
 * Falls back to YouTube IFrame player (foreground only) if all fail.
 */

import { api } from '../config/api';
import { logger } from '../utils/logger';

const INVIDIOUS_INSTANCES: string[] = [];


const INVIDIOUS_TIMEOUT_MS = 3_000;

// Bounded retry policy — extraction NEVER retries infinitely:
//   - at most MAX_SERVER_ATTEMPTS server calls per extraction, with backoff
//   - PERMANENT failures (bad id, deleted video, malformed response) stop
//     immediately and block the id for a long TTL
//   - TRANSIENT failures (timeout, network, 5xx) retry once, then block the
//     id only briefly so a later tap gets a fresh chance
const MAX_SERVER_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 400;
const PERMANENT_FAIL_TTL_MS = 30 * 60 * 1000;
const TRANSIENT_FAIL_TTL_MS = 60 * 1000;

// Cache extracted URLs to avoid repeated network calls
const urlCache = new Map<string, { url: string; expiresAt: number }>();
const CACHE_TTL_MS = 25 * 60 * 1000; // 25 minutes

// Failed ids with an expiry — a failure blocks retries only until the TTL
// lapses (or until invalidateAudioUrl clears it), never for the whole session.
const failedIds = new Map<string, number>();

type FailureKind = 'permanent' | 'transient';

interface ExtractionFailure {
  kind: FailureKind;
  reason: string;
}

type ServerResult = { url: string } | { failure: ExtractionFailure };

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}



interface InvidiousFormat {
  type: string;
  url?: string;
  bitrate?: number;
}

interface InvidiousVideoResponse {
  title?: string;
  lengthSeconds?: number;
  adaptiveFormats?: InvidiousFormat[];
}

function log(...args: any[]) {
  if (import.meta.env.DEV) logger.debug('[YouTubeAudioExtractor]', ...args);
}

function logError(...args: any[]) {
  logger.error('[YouTubeAudioExtractor]', ...args);
}

/**
 * Extract a direct audio stream URL for a YouTube video.
 * Tries server endpoint first, then Invidious instances.
 * Returns the best audio URL or null if all fail.
 */
export async function extractAudioUrl(youtubeId: string): Promise<string | null> {
  // Check cache first
  const cached = urlCache.get(youtubeId);
  if (cached && cached.expiresAt > Date.now()) {
    log('Cache hit for:', youtubeId);
    return cached.url;
  }
  if (cached) urlCache.delete(youtubeId);

  // Blocked ids: skip until the failure TTL lapses (transient failures clear
  // quickly; permanent ones stay blocked much longer).
  const blockedUntil = failedIds.get(youtubeId);
  if (blockedUntil !== undefined) {
    if (blockedUntil > Date.now()) {
      log('Previously failed, skipping:', youtubeId);
      return null;
    }
    failedIds.delete(youtubeId);
  }

  log('Extracting audio URL for:', youtubeId);

  // Strategy 1: Server yt-dlp audio-info endpoint — bounded attempts.
  // Transient failures (timeout/network/5xx) retry once with backoff;
  // permanent failures (invalid id, unavailable video, malformed response)
  // stop immediately — never an infinite retry loop.
  let lastFailure: ExtractionFailure | null = null;
  try {
    for (let attempt = 1; attempt <= MAX_SERVER_ATTEMPTS; attempt++) {
      const result = await fetchFromServer(youtubeId);
      if ('url' in result) {
        urlCache.set(youtubeId, { url: result.url, expiresAt: Date.now() + CACHE_TTL_MS });
        log('✓ Got audio URL from server for:', youtubeId);
        return result.url;
      }
      lastFailure = result.failure;
      if (lastFailure.kind === 'permanent') break;
      if (attempt < MAX_SERVER_ATTEMPTS) {
        log(`Transient failure (${lastFailure.reason}) — retry ${attempt}/${MAX_SERVER_ATTEMPTS - 1} in ${RETRY_BACKOFF_MS}ms`);
        await sleep(RETRY_BACKOFF_MS);
      }
    }
  } catch (err) {
    log('Server extraction failed:', err);
  }

  // Strategy 2: Invidious API instances (race all)
  try {
    const results = await Promise.allSettled(
      INVIDIOUS_INSTANCES.map(instance => fetchFromInvidious(instance, youtubeId))
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        const audioUrl = pickBestAudioUrl(result.value);
        if (audioUrl) {
          urlCache.set(youtubeId, { url: audioUrl, expiresAt: Date.now() + CACHE_TTL_MS });
          log('✓ Got audio URL from Invidious for:', youtubeId);
          return audioUrl;
        }
      }
    }
  } catch (err) {
    log('Invidious extraction failed:', err);
  }

  // All failed — block the id only until the TTL for this failure class
  // lapses, so a transient outage never poisons the whole session.
  const ttl = lastFailure?.kind === 'permanent' ? PERMANENT_FAIL_TTL_MS : TRANSIENT_FAIL_TTL_MS;
  failedIds.set(youtubeId, Date.now() + ttl);
  logError('✗ All extraction methods failed for:', youtubeId, lastFailure ? `(${lastFailure.kind}: ${lastFailure.reason})` : '');
  return null;
}

/**
 * Return the server-side streaming URL for a YouTube video.
 *
 * The /stream endpoint handles extraction AND download through a single
 * yt-dlp invocation (same WARP connection = same exit IP = works).
 * Calling /audio-info first was wasting 5-20s on a SEPARATE yt-dlp
 * extraction just to validate the video — then ignoring the extracted
 * URLs and returning /stream anyway. Skipping it saves one full
 * extraction round-trip per first play.
 *
 * The stream endpoint fails fast (<2s) for invalid/deleted videos,
 * so validation happens naturally through the player's retry logic.
 */
async function fetchFromServer(youtubeId: string): Promise<ServerResult> {
  // Validate the youtubeId format before returning a stream URL.
  if (!youtubeId || !/^[a-zA-Z0-9_-]{11}$/.test(youtubeId)) {
    return { failure: { kind: 'permanent', reason: 'invalid_id' } };
  }

  // Quick HEAD-check to detect deleted/unavailable videos before the
  // player commits to a 20s+ stream request. The HEAD check hits the
  // audio-info endpoint which is fast when the video exists and returns
  // a clear error when it doesn't. This costs ~3-5s but prevents the
  // player from showing a permanent loading spinner on invalid videos.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const resp = await fetch(api(`/audio-info/${youtubeId}`), {
      signal: controller.signal,
      method: 'HEAD',
      headers: { Accept: 'application/json' },
    });
    if (resp.status === 404) {
      return { failure: { kind: 'permanent', reason: 'video_not_found' } };
    }
    if (resp.status === 400) {
      return { failure: { kind: 'permanent', reason: 'invalid_video' } };
    }
  } catch {
    // Network error or timeout — proceed to stream anyway (it will
    // handle its own errors). A slow server is not a permanent failure.
  } finally {
    clearTimeout(timeout);
  }

  // Return the stream URL directly. The server's /stream endpoint does
  // extraction + download in one yt-dlp invocation — no separate
  // audio-info extraction needed. Cold start ~20s; cached ~1-2s.
  return { url: api(`/stream/${youtubeId}`) };
}

/**
 * Fetch audio formats from an Invidious instance.
 */
async function fetchFromInvidious(
  instance: string,
  youtubeId: string
): Promise<InvidiousFormat[] | null> {
  const url = `${instance}/api/v1/videos/${youtubeId}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INVIDIOUS_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) return null;

    const data: InvidiousVideoResponse = await response.json();
    return data.adaptiveFormats || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function pickBestAudioUrl(formats: InvidiousFormat[]): string | null {
  const audioFormats = formats.filter(f => {
    if (!f.url) return false;
    const mime = (f.type || '').toLowerCase();
    return mime.startsWith('audio/') && (mime.includes('mp4') || mime.includes('webm') || mime.includes('opus'));
  });

  if (audioFormats.length === 0) return null;

  // Prefer m4a (best HTML audio compatibility), then sort by bitrate
  audioFormats.sort((a, b) => {
    const aIsM4a = (a.type || '').includes('mp4');
    const bIsM4a = (b.type || '').includes('mp4');
    if (aIsM4a && !bIsM4a) return -1;
    if (!aIsM4a && bIsM4a) return 1;
    return (b.bitrate || 0) - (a.bitrate || 0);
  });

  return audioFormats[0]?.url || null;
}

/**
 * Clear the URL cache (e.g. on logout or cache invalidation).
 */
export function clearAudioUrlCache(): void {
  urlCache.clear();
  failedIds.clear();
}

/**
 * Invalidate a single video's cached URL (e.g. after a proven playback failure).
 * Forces the next extractAudioUrl call to re-fetch a fresh stream URL.
 */
export function invalidateAudioUrl(youtubeId: string): void {
  if (urlCache.delete(youtubeId)) {
    log('Invalidated cached URL for:', youtubeId);
  }
  failedIds.delete(youtubeId);
}
