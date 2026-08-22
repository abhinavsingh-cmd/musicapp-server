import { toTrack } from '../providers/adapters';
import { providerRegistry } from '../providers/registry';
import { Song } from '../types/music';
// Ensure built-in providers are registered (idempotent). Static import: the
// barrel is already in the main bundle via audioService — a dynamic import
// here prevents Vite from code-splitting the providers chunk.
import '../providers';

/**
 * Preload Service
 *
 * Pre-loads audio for the next songs in queue so playback feels instant.
 *
 * Provider-neutral by design:
 *   - Tracks carrying a direct stream URL get a hidden <audio> element with
 *     preload, regardless of which provider produced them.
 *   - Tracks without a direct stream warm their owning provider's network
 *     resources via the optional `preconnect()` hook (YouTube: CDN
 *     preconnect + IFrame API script prefetch). IFrame preloading itself is
 *     owned by youtubePlayerService to avoid API script conflicts.
 */

function isNativePlatform(): boolean {
  return !!(window as any).Capacitor;
}

/** Make sure the built-in providers are registered (idempotent). */
async function ensureBuiltinProviders(): Promise<void> {
  // Built-ins are registered at module load via the static import above.
  return Promise.resolve();
}

/** Warm every registered provider's network resources (each is idempotent). */
async function preconnectProviders(): Promise<void> {
  try {
    await ensureBuiltinProviders();
    for (const provider of providerRegistry.list()) {
      try {
        provider.preconnect?.();
      } catch {
        // Warmup is best-effort — never break preload for one provider.
      }
    }
  } catch {
    // ignore
  }
}

// --- Audio preload pool ---
const preloadPool = new Map<string, HTMLAudioElement>();
const MAX_PRELOAD_AUDIO = 5;

function prewarmAudioElement(url: string): void {
  // On Android the native MediaPlayer owns streaming — extra HTML audio
  // elements would only compete for bandwidth and never be played.
  if (isNativePlatform()) return;
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
  /**
   * Downloaded tracks play from their local copy — prewarming a remote URL
   * or preconnecting for them only wastes bandwidth (and fails offline).
   * The caller supplies the download check so this service stays store-free.
   */
  isDownloaded?: (song: Song) => boolean;
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
  const { count = 3, isDownloaded } = options;

  const nextSongs = queue.slice(currentIndex + 1, currentIndex + 1 + count);
  if (nextSongs.length === 0) return;

  prefetchServerDNS();

  for (const song of nextSongs) {
    // A downloaded song needs no network at all — skip every warmup for it.
    if (isDownloaded && isDownloaded(song)) continue;
    const track = toTrack(song);
    if (track.streamUrl && track.streamUrl.trim()) {
      prewarmAudioElement(track.streamUrl);
    } else {
      // No direct stream — warm the owning provider's network resources
      // (the engine never branches on provider identity here).
      await ensureBuiltinProviders();
      try {
        providerRegistry.get(track.provider)?.preconnect?.();
      } catch {
        // ignore — warmup is best-effort
      }
    }
  }
}

/**
 * Get a preloaded audio element for a song, if available.
 */
export function getPreloadedElement(song: Song): HTMLAudioElement | null {
  const streamUrl = toTrack(song).streamUrl;
  if (streamUrl && preloadPool.has(streamUrl)) {
    const el = preloadPool.get(streamUrl)!;
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
    prefetchServerDNS();
    preconnectStreamEndpoint();
    void preconnectProviders();
    document.removeEventListener('click', handler);
    document.removeEventListener('touchstart', handler);
  };
  document.addEventListener('click', handler, { once: false, passive: true });
  document.addEventListener('touchstart', handler, { once: false, passive: true });
}

let streamEndpointPreconnected = false;
function preconnectStreamEndpoint(): void {
  if (streamEndpointPreconnected) return;
  streamEndpointPreconnected = true;

  const API_BASE = import.meta.env.VITE_API_URL;
  if (!API_BASE) return;

  const link = document.createElement('link');
  link.rel = 'preconnect';
  link.href = API_BASE;
  link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
}

/**
 * Preload critical resources in the background after startup:
 * DNS prefetching for the music API plus every registered provider's
 * connection warmup, so first playback / first fetch feels instant.
 */
export async function preloadCriticalResources(): Promise<void> {
  try {
    prefetchServerDNS();
    await preconnectProviders();
  } catch {}
  await Promise.resolve();
}
