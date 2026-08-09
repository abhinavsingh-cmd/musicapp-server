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

const INVIDIOUS_INSTANCES: string[] = [];

const SERVER_TIMEOUT_MS = 4_000;
const INVIDIOUS_TIMEOUT_MS = 3_000;

// Cache extracted URLs to avoid repeated network calls
const urlCache = new Map<string, { url: string; expiresAt: number }>();
const CACHE_TTL_MS = 25 * 60 * 1000; // 25 minutes

// Track failed IDs to avoid retrying known-dead sources
const failedIds = new Set<string>();

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
  if (import.meta.env.DEV) console.log('[YouTubeAudioExtractor]', ...args);
}

function logError(...args: any[]) {
  console.error('[YouTubeAudioExtractor]', ...args);
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

  // Skip known-failed IDs (within this session only)
  if (failedIds.has(youtubeId)) {
    log('Previously failed, skipping:', youtubeId);
    return null;
  }

  log('Extracting audio URL for:', youtubeId);

  // Strategy 1: Server yt-dlp audio-info endpoint
  try {
    const serverUrl = await fetchFromServer(youtubeId);
    if (serverUrl) {
      urlCache.set(youtubeId, { url: serverUrl, expiresAt: Date.now() + CACHE_TTL_MS });
      log('✓ Got audio URL from server for:', youtubeId);
      return serverUrl;
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

  // All failed — mark as failed for this session
  failedIds.add(youtubeId);
  logError('✗ All extraction methods failed for:', youtubeId);
  return null;
}

/**
 * Fetch audio URL from server's yt-dlp audio-info endpoint.
 * Returns a proxy URL that streams through the server (Google URLs are IP-locked).
 */
async function fetchFromServer(youtubeId: string): Promise<string | null> {
  const url = api(`/audio-info/${youtubeId}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SERVER_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (!data.success || !data.details?.formats?.length) return null;

    // Pick the best audio format with a URL
    const best = data.details.formats
      .filter((f: any) => f.url && f.url.startsWith('http'))
      .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];

    if (!best?.url) return null;

    // Google URLs are IP-locked to the server. Return a proxy URL so the
    // client can play it — the server fetches from Google and streams to us.
    return api(`/proxy-audio?url=${encodeURIComponent(best.url)}`);
  } catch {
    return null;
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
