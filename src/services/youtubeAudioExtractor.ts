/**
 * YouTube Audio Extractor
 *
 * Fetches direct audio stream URLs from YouTube via Invidious API instances.
 * This allows playing audio via HTML <audio> instead of YouTube IFrame,
 * which is required for background playback on Android.
 *
 * YouTube IFrame stops when the WebView goes to background.
 * HTML <audio> with a foreground service continues playing — like Spotify.
 */

const INVIDIOUS_INSTANCES = [
  'https://yewtu.be',
  'https://invidious.flokinet.to',
  'https://invidious.io.lol',
];

const EXTRACT_TIMEOUT_MS = 10_000;

// Cache extracted URLs to avoid repeated network calls
const urlCache = new Map<string, { url: string; expiresAt: number }>();
const CACHE_TTL_MS = 25 * 60 * 1000; // 25 minutes

interface InvidiousFormat {
  type: string;
  url?: string;
  bitrate?: number;
  encoding?: string;
  container?: string;
  qualityLabel?: string;
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
  if (import.meta.env.DEV) console.error('[YouTubeAudioExtractor]', ...args);
}

/**
 * Extract a direct audio stream URL for a YouTube video.
 * Tries multiple Invidious instances in parallel.
 * Returns the best audio URL or null if all fail.
 */
export async function extractAudioUrl(youtubeId: string): Promise<string | null> {
  // Check cache first
  const cached = urlCache.get(youtubeId);
  if (cached && cached.expiresAt > Date.now()) {
    log('Cache hit for:', youtubeId);
    return cached.url;
  }

  log('Extracting audio URL for:', youtubeId);

  // Race all instances — first successful response wins
  const results = await Promise.allSettled(
    INVIDIOUS_INSTANCES.map(instance => fetchFromInstance(instance, youtubeId))
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      const audioUrl = pickBestAudioUrl(result.value);
      if (audioUrl) {
        // Cache the result
        urlCache.set(youtubeId, {
          url: audioUrl,
          expiresAt: Date.now() + CACHE_TTL_MS,
        });
        log('✓ Extracted audio URL for:', youtubeId, audioUrl.substring(0, 80));
        return audioUrl;
      }
    }
  }

  logError('✗ All Invidious instances failed for:', youtubeId);
  return null;
}

async function fetchFromInstance(
  instance: string,
  youtubeId: string
): Promise<InvidiousFormat[] | null> {
  const url = `${instance}/api/v1/videos/${youtubeId}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) return null;

    const data: InvidiousVideoResponse = await response.json();
    return data.adaptiveFormats || null;
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function pickBestAudioUrl(formats: InvidiousFormat[]): string | null {
  // Filter to audio-only formats with a URL
  const audioFormats = formats.filter(f => {
    if (!f.url) return false;
    const mime = (f.type || '').toLowerCase();
    return mime.startsWith('audio/') && (mime.includes('mp4') || mime.includes('webm') || mime.includes('opus'));
  });

  if (audioFormats.length === 0) return null;

  // Prefer m4a/mp4a (best compatibility with HTML audio), then sort by bitrate
  audioFormats.sort((a, b) => {
    const aIsM4a = (a.type || '').includes('mp4');
    const bIsM4a = (b.type || '').includes('mp4');
    if (aIsM4a && !bIsM4a) return -1;
    if (!aIsM4a && bIsM4a) return 1;
    return (b.bitrate || 0) - (a.bitrate || 0);
  });

  return audioFormats[0].url || null;
}

/**
 * Pre-extract audio URLs for a list of songs (background prefetch).
 * Failures are silently ignored — this is best-effort.
 */
export async function prefetchAudioUrls(songIds: string[]): Promise<void> {
  const toFetch = songIds.filter(id => !urlCache.has(id));
  if (toFetch.length === 0) return;

  log('Prefetching audio URLs for', toFetch.length, 'songs');

  // Fire and forget — don't block the caller
  Promise.allSettled(toFetch.map(id => extractAudioUrl(id))).catch(() => {});
}

/**
 * Clear the URL cache (e.g. on logout or cache invalidation).
 */
export function clearAudioUrlCache(): void {
  urlCache.clear();
}
