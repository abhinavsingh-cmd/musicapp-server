import { Song } from '../types/music';

/**
 * Preload Service
 *
 * Pre-loads audio for the next songs in queue so playback feels instant.
 *
 * For audioUrl songs: creates hidden <audio> elements with preload="metadata"
 * For youtubeId songs: DNS prefetch only — YouTube IFrame preloading is handled
 *   by youtubePlayerService itself to avoid API script conflicts.
 */

// --- Audio preload pool ---
const preloadPool = new Map<string, HTMLAudioElement>();
const MAX_PRELOAD_AUDIO = 5;

function prewarmAudioElement(url: string): void {
  if (preloadPool.has(url)) return;

  if (preloadPool.size >= MAX_PRELOAD_AUDIO) {
    const firstKey = preloadPool.keys().next().value;
    if (firstKey) {
      const old = preloadPool.get(firstKey)!;
      old.removeAttribute('src');
      old.load();
      preloadPool.delete(firstKey);
    }
  }

  const audio = new Audio();
  audio.preload = 'auto';
  audio.src = url;
  preloadPool.set(url, audio);
}

// --- DNS prefetch for YouTube (fastens domain resolution) ---
let ytDnsPrefetched = false;

function prefetchYouTubeDNS(): void {
  if (ytDnsPrefetched) return;
  ytDnsPrefetched = true;

  const domains = [
    'https://www.youtube.com',
    'https://i.ytimg.com',
    'https://s.ytimg.com',
  ];
  for (const href of domains) {
    const link = document.createElement('link');
    link.rel = 'dns-prefetch';
    link.href = href;
    document.head.appendChild(link);
  }
}

// --- DNS prefetch for server ---
let dnsPrefetched = false;

function prefetchServerDNS(): void {
  if (dnsPrefetched) return;
  dnsPrefetched = true;

  const API_BASE = import.meta.env.VITE_API_URL;
  if (!API_BASE) return;

  const link = document.createElement('link');
  link.rel = 'dns-prefetch';
  link.href = API_BASE;
  document.head.appendChild(link);
}

// --- Main preload function ---

interface PreloadOptions {
  count?: number;
  priority?: 'high' | 'normal';
}

/**
 * Preload the next N songs in the queue.
 * Called after a song starts playing to warm up the next songs.
 */
export async function preloadNextSongs(
  queue: Song[],
  currentIndex: number,
  options: PreloadOptions = {},
): Promise<void> {
  const { count = 3 } = options;

  const nextSongs = queue.slice(currentIndex + 1, currentIndex + 1 + count);
  if (nextSongs.length === 0) return;

  prefetchServerDNS();

  for (const song of nextSongs) {
    if (song.audioUrl && song.audioUrl.trim()) {
      prewarmAudioElement(song.audioUrl);
    } else if (song.youtubeId) {
      // Just prefetch DNS — don't load the YouTube IFrame API here
      // (youtubePlayerService owns the API lifecycle)
      prefetchYouTubeDNS();
    }
  }
}

/**
 * Get a preloaded audio element for a song, if available.
 */
export function getPreloadedElement(song: Song): HTMLAudioElement | null {
  if (song.audioUrl && preloadPool.has(song.audioUrl)) {
    const el = preloadPool.get(song.audioUrl)!;
    // Only return if the element has enough data loaded
    if (el.readyState >= 2) return el;
  }
  return null;
}

/**
 * Clear all preloaded audio elements.
 * Call when the queue changes significantly.
 */
export function clearPreloadPool(): void {
  for (const [, audio] of preloadPool) {
    audio.removeAttribute('src');
    audio.load();
  }
  preloadPool.clear();
}

export function prewarmOnFirstInteraction(): void {
  let done = false;
  const handler = () => {
    if (done) return;
    done = true;
    prefetchYouTubeDNS();
    prefetchServerDNS();
    document.removeEventListener('click', handler);
    document.removeEventListener('touchstart', handler);
  };
  document.addEventListener('click', handler, { once: false, passive: true });
  document.addEventListener('touchstart', handler, { once: false, passive: true });
}

/**
 * Preload critical resources in the background after startup:
 * DNS prefetching for YouTube and the music API plus connection warmup,
 * so first playback / first fetch feels instant.
 */
export async function preloadCriticalResources(): Promise<void> {
  try {
    prefetchYouTubeDNS();
    prefetchServerDNS();
  } catch {}
  await Promise.resolve();
}
