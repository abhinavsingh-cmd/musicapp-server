/**
 * Image Cache — fetches images once, converts to blob URLs.
 * Avoids re-downloading album art / thumbnails on every render.
 * Uses Cache API for persistence + in-memory blob URL map for fast access.
 */

const CACHE_NAME = 'music-app-images-v1';
const MEMORY_CACHE = new Map<string, string>(); // url → blob URL
const MAX_MEMORY_ENTRIES = 100;

let cacheStorage: Cache | null = null;

async function getCache(): Promise<Cache | null> {
  if (cacheStorage) return cacheStorage;
  if (!('caches' in window)) return null;
  try {
    cacheStorage = await caches.open(CACHE_NAME);
    return cacheStorage;
  } catch {
    return null;
  }
}

/**
 * Get an image URL, fetching and caching if needed.
 * Returns a blob URL that's safe to use in <img src={}>.
 */
export async function getCachedImageUrl(url: string): Promise<string> {
  if (!url || url.startsWith('data:')) return url;

  // Fast path: already in memory
  const memHit = MEMORY_CACHE.get(url);
  if (memHit) return memHit;

  // Try Cache API
  const cache = await getCache();
  if (cache) {
    try {
      const cached = await cache.match(url);
      if (cached) {
        const blob = await cached.blob();
        const blobUrl = URL.createObjectURL(blob);
        addMemoryEntry(url, blobUrl);
        return blobUrl;
      }
    } catch { /* fall through to fetch */ }
  }

  // Fetch from network
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, { credentials: 'omit', signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return url;

    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);

    // Store in memory
    addMemoryEntry(url, blobUrl);

    // Store in Cache API (don't await — background write)
    if (cache) {
      cache.put(url, new Response(blob, {
        headers: { 'Content-Type': blob.type, 'Cache-Control': 'public, max-age=2592000' },
      })).catch(() => {});
    }

    return blobUrl;
  } catch {
    return url; // Fallback to original URL
  }
}

function addMemoryEntry(url: string, blobUrl: string): void {
  if (MEMORY_CACHE.size >= MAX_MEMORY_ENTRIES) {
    // Evict oldest entry
    const firstKey = MEMORY_CACHE.keys().next().value;
    if (firstKey) {
      const oldBlob = MEMORY_CACHE.get(firstKey);
      if (oldBlob) URL.revokeObjectURL(oldBlob);
      MEMORY_CACHE.delete(firstKey);
    }
  }
  MEMORY_CACHE.set(url, blobUrl);
}

/**
 * Clear all cached images. Call on logout or storage cleanup.
 */
export async function clearImageCache(): Promise<void> {
  for (const blobUrl of MEMORY_CACHE.values()) {
    URL.revokeObjectURL(blobUrl);
  }
  MEMORY_CACHE.clear();
  const cache = await getCache();
  if (cache) await caches.delete(CACHE_NAME);
}

/** Number of images currently cached in memory. */
export function imageCacheSize(): number {
  return MEMORY_CACHE.size;
}
