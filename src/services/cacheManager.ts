/**
 * Cache statistics for the dev dashboard.
 *
 * This used to be a full LRU cache with IndexedDB offline persistence, but
 * nothing ever wrote to it — the real caching lives in api.ts (response
 * cache) and downloadManager.ts (IndexedDB). All that remained in use was
 * `getStats()` on the DevPage, so this module is now a thin adapter over
 * the live response cache instead of a second, always-empty cache.
 */

import { getResponseCacheStats } from '../config/api';

/**
 * Item counts per cache bucket. `artwork`/`albums`/`artists` no longer have
 * their own caches (thumbnails live in downloadManager's IndexedDB store;
 * albums/artists are derived in memory), so they report 0.
 */
export function getCacheStats(): Record<string, number> {
  const buckets = getResponseCacheStats();
  return {
    search: buckets.search ?? 0,
    trending: buckets.trending ?? 0,
    lyrics: buckets.lyrics ?? 0,
    stream: buckets.stream ?? 0,
    metadata: buckets.metadata ?? 0,
    artwork: 0,
    albums: 0,
    artists: 0,
  };
}

/** Dev-dashboard facade — `getStats()` is the only remaining consumer. */
export const cacheManager = {
  getStats: getCacheStats,
};
