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

// yt-dlp extraction on the server routinely takes longer than 4s — Render
// cold starts alone can stall the first request for many seconds. A too-tight
// timeout aborts every attempt, extraction "fails", and playback silently
// falls back to the YouTube IFrame engine — which dies the moment the app is
// backgrounded (the exact "stops when backgrounded" symptom on Android).
const SERVER_TIMEOUT_MS = 15_000;
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

/** 429/5xx are worth another attempt; other HTTP errors are definitive. */
function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
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
 * Fetch audio URL from server's yt-dlp audio-info endpoint.
 * Returns a proxy URL that streams through the server (Google URLs are IP-locked).
 *
 * Never throws — every failure is classified and returned:
 *   permanent  → invalid id / unavailable video / malformed or empty response
 *   transient  → timeout, network error, throttling, server errors
 */
async function fetchFromServer(youtubeId: string): Promise<ServerResult> {
  const url = api(`/audio-info/${youtubeId}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SERVER_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      return {
        failure: {
          kind: isTransientStatus(response.status) ? 'transient' : 'permanent',
          reason: `http_${response.status}`,
        },
      };
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      return { failure: { kind: 'permanent', reason: 'invalid_response' } };
    }

    if (!data || data.success === false || !data.details?.formats?.length) {
      return { failure: { kind: 'permanent', reason: 'no_audio' } };
    }

    // Pick the best audio format with a URL. Container FIRST, then bitrate:
    // YouTube's highest-bitrate "bestaudio" streams are almost always
    // opus/webm, which the Android native MediaPlayer cannot decode — handing
    // it one fails onError and playback falls back to the WebView engine
    // (no background playback). m4a decodes everywhere (native + HTML <audio>),
    // so prefer it unconditionally and only fall back to webm/opus when no
    // m4a/mp4 format exists at all.
    const containerRank = (f: any): number => {
      const ext = String(f.ext || '').toLowerCase();
      const type = String(f.type || '').toLowerCase();
      if (ext.includes('m4a') || ext.includes('mp4') || type.includes('mp4')) return 0;
      return 1;
    };
    // HLS manifest URLs (manifest.googlevideo.com …/hls_playlist/…) are
    // playlist TEXT, not audio — the proxy would stream the playlist and the
    // player would fail (or worse, a download would save an HTML-ish file).
    // Only direct media URLs are playable through the proxy.
    const IS_HLS_MANIFEST = /manifest\.googlevideo\.com|\/api\/manifest\/hls_playlist\//i;
    const best = data.details.formats
      .filter((f: any) => f.url && f.url.startsWith('http') && !IS_HLS_MANIFEST.test(f.url))
      .sort((a: any, b: any) => {
        const rankDiff = containerRank(a) - containerRank(b);
        if (rankDiff !== 0) return rankDiff;
        return (b.bitrate || 0) - (a.bitrate || 0);
      })[0];

    // Formats arrived without any usable URL — rare, and worth one retry.
    if (!best?.url) {
      return { failure: { kind: 'transient', reason: 'empty_url' } };
    }

    // Google URLs are IP-locked to the server's direct IP when extracted
    // without WARP. proxy-audio fetches from the same IP, so it works.
    return { url: api(`/proxy-audio?url=${encodeURIComponent(best.url)}`) };
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    return { failure: { kind: 'transient', reason: aborted ? 'timeout' : 'network' } };
  } finally {
    clearTimeout(timeout);
  }
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
