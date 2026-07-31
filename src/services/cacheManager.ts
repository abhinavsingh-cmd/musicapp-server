import { metricsCollector } from '../services/metricsCollector';

class LRUCacheNode<T> {
  key: string;
  value: T;
  timestamp: number;
  accessedAt: number;
  prev: LRUCacheNode<T> | null = null;
  next: LRUCacheNode<T> | null = null;
}

class LRUCache<K, V> {
  private head: LRUCacheNode<V> | null = null;
  private tail: LRUCacheNode<V> | null = null;
  private size = 0;
  private maxSize: number;
  private ttl: number;
  private readonly defaultTTL: number;
  
  constructor(maxSize: number = 100, defaultTTL: number = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
    this.ttl = defaultTTL;
  }

  set(key: K, value: V, ttl?: number): boolean {
    const now = Date.now();
    const ttlToUse = ttl !== undefined ? ttl : this.ttl;
    
    let node: LRUCacheNode<V>;
    if (this.head) {
      node = new LRUCacheNode<V>();
      node.key = key as string;
      node.value = value;
      node.timestamp = now;
      node.accessedAt = now;
      
      this.head.prev = node;
      node.next = this.head;
      this.head = node;
      this.size++;
    } else {
      node = new LRUCacheNode<V>();
      node.key = key as string;
      node.value = value;
      node.timestamp = now;
      node.accessedAt = now;
      this.head = node;
      this.tail = node;
      this.size++;
    }
    
    while (this.size > this.maxSize) {
      if (this.tail && this.tail.prev) {
        const removed = this.tail;
        if (removed.prev) {
          removed.prev.next = null;
          this.tail = removed.prev;
        }
        this.size--;
      } else {
        break;
      }
    }
    
    return true;
  }

  get(key: K): V | undefined {
    if (!this.head) return undefined;
    
    let current: LRUCacheNode<V> | null = this.head;
    while (current) {
      const now = Date.now();
      if (now - current.timestamp > this.ttl) {
        this.removeAtCurrent(current);
        current = this.head;
        continue;
      }
      
      if (current.key === (key as string)) {
        current.accessedAt = now;
        metricsCollector.pushCacheEvent(true, key as string);
        return current.value;
      }
      current = current.next;
    }
    
    metricsCollector.pushCacheEvent(false, key as string);
    return undefined;
  }

  remove(key: K): boolean {
    let current: LRUCacheNode<V> | null = this.head;
    while (current) {
      if (current.key === (key as string)) {
        this.removeAtCurrent(current);
        return true;
      }
      current = current.next;
    }
    return false;
  }

  clear(): void {
    this.head = null;
    this.tail = null;
    this.size = 0;
  }

  private removeAtCurrent(node: LRUCacheNode<V>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }
    
    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
    
    this.size--;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  sizeStats(): number {
    return this.size;
  }

  entries(): Array<{ key: K; value: V }> {
    const result: Array<{ key: K; value: V }> = [];
    let current: LRUCacheNode<V> | null = this.head;
    while (current) {
      result.push({ key: current.key as K, value: current.value });
      current = current.next;
    }
    return result;
  }
}

export class CacheManager {
  private static instance: CacheManager;

  // Cache instances
  private searchCache: LRUCache<string, any>;
  private trendingCache: LRUCache<string, any>;
  private artworkCache: LRUCache<string, string>;
  private albumsCache: LRUCache<string, any>;
  private artistsCache: LRUCache<string, any>;
  private lyricsCache: LRUCache<string, string>;
  private streamUrlCache: LRUCache<string, string>;
  private metadataCache: LRUCache<string, any>;

  // Cache TTLs (in milliseconds)
  private readonly SEARCH_TTL = 2 * 60 * 1000; // 2 minutes
  private readonly TRENDING_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly ARTWORK_TTL = 24 * 60 * 60 * 1000; // 24 hours
  private readonly ALBUMS_TTL = 10 * 60 * 1000; // 10 minutes
  private readonly ARTISTS_TTL = 10 * 60 * 1000; // 10 minutes
  private readonly LYRICS_TTL = 1 * 60 * 1000; // 1 minute
  private readonly STREAM_TTL = 24 * 60 * 60 * 1000; // 24 hours
  private readonly METADATA_TTL = 30 * 60 * 1000; // 30 minutes

  // Offline storage
  private offlineDb: IDBFactory | null = null;

  private constructor() {
    this.initializeIndexes();
  }

  static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager();
    }
    return CacheManager.instance;
  }

  private async initializeIndexes(): Promise<void> {
    if (typeof window !== 'undefined' && 'indexedDB' in window) {
      this.offlineDb = window.indexedDB;
      await this.ensureDatabase();
    }
  }

  private async ensureDatabase(): Promise<void> {
    if (!this.offlineDb) return;

    return new Promise((resolve) => {
      const request = this.offlineDb!.open('music-cache-db', 1);
      request.onerror = () => resolve();
      request.onsuccess = (event) => {
        const db = (event.target as IDBRequest).result;
        if (!db.objectStoreNames.contains('cache')) {
          db.createObjectStore('cache', { keyPath: 'key' });
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
        resolve();
      };
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('cache')) {
          db.createObjectStore('cache', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
      };
    });
  }

  // Search cache operations
  async getSearch(key: string): Promise<any> {
    const start = performance.now();
    const cacheKey = `search:${key}`;
    
    const cached = this.searchCache.get(cacheKey);
    if (cached !== undefined) {
      const duration = performance.now() - start;
      metricsCollector.pushDataLoadEvent({
        type: 'search',
        count: Array.isArray(cached) ? cached.length : 1,
        source: 'cache',
        duration,
        timestamp: Date.now(),
      });
      return cached;
    }
    
    const duration = performance.now() - start;
    metricsCollector.pushDataLoadEvent({
      type: 'search',
      count: 0,
      source: 'miss',
      duration,
      timestamp: Date.now(),
    });
    return null;
  }

  setSearch(key: string, value: any): void {
    const start = performance.now();
    this.searchCache.set(`search:${key}`, value, this.SEARCH_TTL);
    const duration = performance.now() - start;
    metricsCollector.pushPreloadEvent({
      resource: 'search',
      duration,
      timestamp: Date.now(),
    });

    if (this.offlineDb) {
      this.saveToOfflineStorage('search', key, value);
    }
  }

  // Trending cache operations
  async getTrending(key: string): Promise<any> {
    const start = performance.now();
    const cacheKey = `trending:${key}`;
    
    const cached = this.trendingCache.get(cacheKey);
    if (cached !== undefined) {
      const duration = performance.now() - start;
      metricsCollector.pushDataLoadEvent({
        type: 'trending',
        count: cached.songs?.length || 0,
        source: 'cache',
        duration,
        timestamp: Date.now(),
      });
      return cached;
    }
    
    const duration = performance.now() - start;
    metricsCollector.pushDataLoadEvent({
      type: 'trending',
      count: 0,
      source: 'miss',
      duration,
      timestamp: Date.now(),
    });
    return null;
  }

  setTrending(key: string, value: any): void {
    const start = performance.now();
    this.trendingCache.set(`trending:${key}`, value, this.TRENDING_TTL);
    const duration = performance.now() - start;
    metricsCollector.pushPreloadEvent({
      resource: 'trending',
      duration,
      timestamp: Date.now(),
    });

    if (this.offlineDb) {
      this.saveToOfflineStorage('trending', key, value);
    }
  }

  // Artwork cache operations
  async getArtwork(url: string): Promise<string | null> {
    const cached = this.artworkCache.get(url);
    return cached !== undefined ? cached : null;
  }

  setArtwork(url: string, data: string): void {
    this.artworkCache.set(url, data, this.ARTWORK_TTL);

    if (this.offlineDb) {
      this.saveToOfflineStorage('artwork', url, data);
    }
  }

  // Albums cache operations
  async getAlbums(key: string): Promise<any> {
    const cached = this.albumsCache.get(key);
    return cached !== undefined ? cached : null;
  }

  setAlbums(key: string, value: any): void {
    this.albumsCache.set(`albums:${key}`, value, this.ALBUMS_TTL);
  }

  // Artists cache operations
  async getArtists(key: string): Promise<any> {
    const cached = this.artistsCache.get(key);
    return cached !== undefined ? cached : null;
  }

  setArtists(key: string, value: any): void {
    this.artistsCache.set(`artists:${key}`, value, this.ARTISTS_TTL);
  }

  // Lyrics cache operations
  async getLyrics(songId: string): Promise<string | null> {
    const cached = this.lyricsCache.get(songId);
    return cached !== undefined ? cached : null;
  }

  setLyrics(songId: string, lyrics: string): void {
    this.lyricsCache.set(`lyrics:${songId}`, lyrics, this.LYRICS_TTL);
  }

  // Stream URL cache operations
  async getStreamUrl(songId: string): Promise<string | null> {
    const cached = this.streamUrlCache.get(songId);
    return cached !== undefined ? cached : null;
  }

  setStreamUrl(songId: string, url: string): void {
    this.streamUrlCache.set(`stream:${songId}`, url, this.STREAM_TTL);
  }

  // Metadata cache operations
  async getMetadata(key: string): Promise<any> {
    const cached = this.metadataCache.get(key);
    return cached !== undefined ? cached : null;
  }

  setMetadata(key: string, value: any): void {
    this.metadataCache.set(`metadata:${key}`, value, this.METADATA_TTL);
  }

  // Background refresh
  async startBackgroundRefresh(): Promise<void> {
    setTimeout(() => this.refreshSearchCache(), this.SEARCH_TTL);
    setTimeout(() => this.refreshTrendingCache(), this.TRENDING_TTL);
    setTimeout(() => this.refreshArtworkCache(), this.ARTWORK_TTL);
    setTimeout(() => this.refreshAlbumsCache(), this.ALBUMS_TTL);
    setTimeout(() => this.refreshArtistsCache(), this.ARTISTS_TTL);
    setTimeout(() => this.refreshLyricsCache(), this.LYRICS_TTL);
    setTimeout(() => this.refreshStreamUrlCache(), this.STREAM_TTL);
    setTimeout(() => this.refreshMetadataCache(), this.METADATA_TTL);
  }

  private async refreshSearchCache(): Promise<void> {
    try {
      const cached = this.searchCache.entries().slice(0, 5);
      cached.forEach(entry => {
        const key = entry.key.replace('search:', '');
        this.setSearch(key, entry.value);
      });
    } catch {}
  }

  private async refreshTrendingCache(): Promise<void> {
    try {
      const cached = this.trendingCache.entries().slice(0, 5);
      cached.forEach(entry => {
        const key = entry.key.replace('trending:', '');
        this.setTrending(key, entry.value);
      });
    } catch {}
  }

  private async refreshArtworkCache(): Promise<void> {
    try {
      const cached = this.artworkCache.entries().slice(0, 20);
      cached.forEach(entry => {
        this.setArtwork(entry.key, entry.value);
      });
    } catch {}
  }

  private async refreshAlbumsCache(): Promise<void> {
    try {
      const cached = this.albumsCache.entries();
      cached.forEach(entry => {
        const key = entry.key.replace('albums:', '');
        this.setAlbums(key, entry.value);
      });
    } catch {}
  }

  private async refreshArtistsCache(): Promise<void> {
    try {
      const cached = this.artistsCache.entries();
      cached.forEach(entry => {
        const key = entry.key.replace('artists:', '');
        this.setArtists(key, entry.value);
      });
    } catch {}
  }

  private async refreshLyricsCache(): Promise<void> {
    try {
      const cached = this.lyricsCache.entries().slice(0, 100);
      cached.forEach(entry => {
        const key = entry.key.replace('lyrics:', '');
        this.setLyrics(key, entry.value);
      });
    } catch {}
  }

  private async refreshStreamUrlCache(): Promise<void> {
    try {
      const cached = this.streamUrlCache.entries();
      cached.forEach(entry => {
        const key = entry.key.replace('stream:', '');
        this.setStreamUrl(key, entry.value);
      });
    } catch {}
  }

  private async refreshMetadataCache(): Promise<void> {
    try {
      const cached = this.metadataCache.entries();
      cached.forEach(entry => {
        const key = entry.key.replace('metadata:', '');
        this.setMetadata(key, entry.value);
      });
    } catch {}
  }

  // Offline storage operations
  private async saveToOfflineStorage(type: string, key: string, value: any): Promise<void> {
    if (!this.offlineDb) return;

    return new Promise((resolve) => {
      const request = this.offlineDb!.open('music-cache-db', 1);
      request.onerror = () => resolve();
      request.onsuccess = (event) => {
        const db = (event.target as IDBRequest).result;
        const tx = db.transaction('cache', 'readwrite');
        const store = tx.objectStore('cache');
        
        store.put({ 
          key: `${type}:${key}`, 
          value, 
          timestamp: Date.now(),
          type
        });
        
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      };
    });
  }

  // Load from offline storage
  async loadFromOfflineStorage(type: string): Promise<any[]> {
    if (!this.offlineDb) return [];

    return new Promise((resolve) => {
      const request = this.offlineDb!.open('music-cache-db', 1);
      request.onerror = () => resolve([]);
      request.onsuccess = (event) => {
        const db = (event.target as IDBRequest).result;
        const tx = db.transaction('cache', 'readonly');
        const store = tx.objectStore('cache');
        const all = store.getAll();
        
        all.onsuccess = (e) => {
          const items: any[] = [];
          const results = (e.target as IDBRequest).result;
          for (const item of results) {
            if (item.type === type) {
              const age = Date.now() - item.timestamp;
              if (age < this.getTTLForType(type)) {
                items.push(item.value);
              }
            }
          }
          resolve(items);
        };
        all.onerror = () => resolve([]);
      };
    });
  }

  // Get TTL based on type
  private getTTLForType(type: string): number {
    const ttlMap: { [key: string]: number } = {
      'search': this.SEARCH_TTL,
      'trending': this.TRENDING_TTL,
      'artwork': this.ARTWORK_TTL,
      'albums': this.ALBUMS_TTL,
      'artists': this.ARTISTS_TTL,
      'lyrics': this.LYRICS_TTL,
      'stream': this.STREAM_TTL,
      'metadata': this.METADATA_TTL,
    };
    return ttlMap[type] || this.defaultTTL;
  }

  // Get cache stats
  getStats() {
    return {
      search: this.searchCache.sizeStats(),
      trending: this.trendingCache.sizeStats(),
      artwork: this.artworkCache.sizeStats(),
      albums: this.albumsCache.sizeStats(),
      artists: this.artistsCache.sizeStats(),
      lyrics: this.lyricsCache.sizeStats(),
      stream: this.streamUrlCache.sizeStats(),
      metadata: this.metadataCache.sizeStats(),
    };
  }

  // Clear all caches
  clearAll(): void {
    this.searchCache.clear();
    this.trendingCache.clear();
    this.artworkCache.clear();
    this.albumsCache.clear();
    this.artistsCache.clear();
    this.lyricsCache.clear();
    this.streamUrlCache.clear();
    this.metadataCache.clear();
  }
}

// Global cache instance
export const cacheManager = new CacheManager();