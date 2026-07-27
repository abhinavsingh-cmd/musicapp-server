/**
 * Offline cache manager using IndexedDB.
 *
 * Stores:
 *   songs       – downloaded audio blobs + metadata
 *   thumbnails  – cached cover-art images (Blob)
 *   meta        – cached song metadata for offline catalogue browsing
 *
 * Features:
 *   - Download progress via onProgress callback
 *   - LRU eviction when total cache exceeds MAX_CACHE_SIZE
 *   - Thumbnail prefetch alongside song download
 */

import { api } from '../config/api';

const DB_NAME = 'music-app-offline';
const DB_VERSION = 2;
const STORE_SONGS = 'songs';
const STORE_THUMBS = 'thumbnails';
const STORE_META = 'meta';

const MAX_CACHE_SIZE = 500 * 1024 * 1024; // 500 MB soft limit

// ---------------------------------------------------------------------------
// IndexedDB helpers
// ---------------------------------------------------------------------------

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SONGS)) {
        const store = db.createObjectStore(STORE_SONGS, { keyPath: 'id' });
        store.createIndex('youtubeId', 'youtubeId', { unique: false });
        store.createIndex('downloadedAt', 'downloadedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_THUMBS)) {
        db.createObjectStore(STORE_THUMBS, { keyPath: 'url' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txGet<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txPut<T>(db: IDBDatabase, store: string, value: T): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function txDelete(db: IDBDatabase, store: string, key: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function txGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function txCount(db: IDBDatabase, store: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function txClear(db: IDBDatabase, store: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clearAllDownloads(): Promise<void> {
  const db = await openDB();
  await txClear(db, STORE_SONGS);
  await txClear(db, STORE_THUMBS);
  await txClear(db, STORE_META);
  db.close();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DownloadedSong {
  id: string;
  youtubeId: string;
  title: string;
  artist: string;
  genre: string;
  duration: number;
  coverArt: string;
  audioBlob: Blob;
  audioUrl: string;
  downloadedAt: number;
  size: number;
}

export interface CachedThumbnail {
  url: string;
  blob: Blob;
  cachedAt: number;
}

// Object URLs are scoped to a document and cannot be persisted in IndexedDB.
// Keep the current-document URLs in memory, keyed by the original image URL.
const thumbnailUrlCache = new Map<string, string>();

function getThumbnailObjectUrl(entry: CachedThumbnail): string {
  const existing = thumbnailUrlCache.get(entry.url);
  if (existing) return existing;
  const objectUrl = URL.createObjectURL(entry.blob);
  thumbnailUrlCache.set(entry.url, objectUrl);
  return objectUrl;
}

export interface CachedMeta {
  id: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  duration: number;
  coverArt: string;
  youtubeId?: string;
  releaseYear: number;
  cachedAt: number;
}

export type DownloadProgress = {
  loaded: number;
  total: number;
  percent: number;
};

// ---------------------------------------------------------------------------
// Download a song with progress
// ---------------------------------------------------------------------------

export async function downloadSongWithProgress(
  song: {
    id: string;
    youtubeId: string;
    title: string;
    artist: string;
    genre: string;
    duration: number;
    coverArt: string;
    audioUrl?: string;
  },
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<DownloadedSong> {
  const downloadUrl = song.audioUrl || api(`/download/${song.youtubeId}?title=${encodeURIComponent(song.title)}`);

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const res = await fetch(downloadUrl, {
    signal,
    headers: { 'Accept': 'audio/*' },
  });

  if (!res.ok) throw new Error(`Download failed: ${res.status}`);

  const contentLength = Number(res.headers.get('content-length')) || 0;
  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.({ loaded: received, total: contentLength || received, percent: contentLength ? Math.round((received / contentLength) * 100) : 0 });
  }

  const contentType = res.headers.get('content-type')?.split(';', 1)[0] || 'audio/mpeg';
  const blob = new Blob(chunks, { type: contentType });

  // Persist to IndexedDB
  const db = await openDB();
  const entry: DownloadedSong = {
    ...song,
    audioBlob: blob,
    audioUrl: '',
    downloadedAt: Date.now(),
    size: blob.size,
  };
  await txPut(db, STORE_SONGS, entry);
  db.close();

  entry.audioUrl = URL.createObjectURL(blob);

  // Cache thumbnail in background
  cacheThumbnail(song.coverArt).catch(() => {});

  // Cache metadata
  cacheMetadata(song).catch(() => {});

  return entry;
}

// ---------------------------------------------------------------------------
// Thumbnail cache
// ---------------------------------------------------------------------------

export async function cacheThumbnail(url: string): Promise<string> {
  if (!url) return '';
  const db = await openDB();
  const existing = await txGet<CachedThumbnail>(db, STORE_THUMBS, url);
  if (existing?.blob) {
    db.close();
    return getThumbnailObjectUrl(existing);
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) { db.close(); return url; }
    const blob = await res.blob();
    await txPut(db, STORE_THUMBS, { url, blob, cachedAt: Date.now() });
    db.close();
    return getThumbnailObjectUrl({ url, blob, cachedAt: Date.now() });
  } catch {
    db.close();
    return url;
  }
}

export async function getCachedThumbnail(url: string): Promise<string> {
  if (!url) return '';
  const db = await openDB();
  const entry = await txGet<CachedThumbnail>(db, STORE_THUMBS, url);
  db.close();
  return entry?.blob ? getThumbnailObjectUrl(entry) : url;
}

// ---------------------------------------------------------------------------
// Metadata cache (for offline catalogue browsing)
// ---------------------------------------------------------------------------

export async function cacheMetadata(song: {
  id: string;
  title: string;
  artist: string;
  album?: string;
  genre: string;
  duration: number;
  coverArt: string;
  youtubeId?: string;
  releaseYear?: number;
}): Promise<void> {
  const db = await openDB();
  await txPut(db, STORE_META, {
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album || '',
    genre: song.genre,
    duration: song.duration,
    coverArt: song.coverArt,
    youtubeId: song.youtubeId,
    releaseYear: song.releaseYear || 0,
    cachedAt: Date.now(),
  });
  db.close();
}

export async function getAllCachedMetadata(): Promise<CachedMeta[]> {
  const db = await openDB();
  const results = await txGetAll<CachedMeta>(db, STORE_META);
  db.close();
  return results.sort((a, b) => b.cachedAt - a.cachedAt);
}

// ---------------------------------------------------------------------------
// Song CRUD
// ---------------------------------------------------------------------------

export async function saveDownload(song: Omit<DownloadedSong, 'audioUrl' | 'downloadedAt' | 'size'>): Promise<DownloadedSong> {
  const db = await openDB();
  const entry: DownloadedSong = {
    ...song,
    audioUrl: '',
    downloadedAt: Date.now(),
    size: song.audioBlob.size,
  };
  await txPut(db, STORE_SONGS, entry);
  db.close();
  entry.audioUrl = URL.createObjectURL(song.audioBlob);
  return entry;
}

export async function getDownload(id: string): Promise<DownloadedSong | null> {
  const db = await openDB();
  const result = await txGet<DownloadedSong>(db, STORE_SONGS, id);
  db.close();
  return result || null;
}

export async function getDownloadByYoutubeId(youtubeId: string): Promise<DownloadedSong | null> {
  const db = await openDB();
  const tx = db.transaction(STORE_SONGS, 'readonly');
  const idx = tx.objectStore(STORE_SONGS).index('youtubeId');
  const req = idx.get(youtubeId);
  const result = await new Promise<DownloadedSong | undefined>((resolve) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
  db.close();
  return result || null;
}

export async function getAllDownloads(): Promise<DownloadedSong[]> {
  const db = await openDB();
  const results = await txGetAll<DownloadedSong>(db, STORE_SONGS);
  db.close();
  return results.sort((a, b) => b.downloadedAt - a.downloadedAt);
}

export async function removeDownload(id: string): Promise<void> {
  const db = await openDB();
  const existing = await txGet<DownloadedSong>(db, STORE_SONGS, id);
  if (existing?.audioUrl) URL.revokeObjectURL(existing.audioUrl);
  await txDelete(db, STORE_SONGS, id);
  db.close();
}

export async function isDownloaded(youtubeId: string): Promise<boolean> {
  const db = await openDB();
  const count = await txCount(db, STORE_SONGS);
  // Fallback: iterate if index count not available
  if (count === 0) { db.close(); return false; }
  const tx = db.transaction(STORE_SONGS, 'readonly');
  const idx = tx.objectStore(STORE_SONGS).index('youtubeId');
  const req = idx.count(youtubeId);
  const result = await new Promise<boolean>((resolve) => {
    req.onsuccess = () => resolve(req.result > 0);
    req.onerror = () => resolve(false);
  });
  db.close();
  return result;
}

// ---------------------------------------------------------------------------
// LRU cache cleanup
// ---------------------------------------------------------------------------

export async function getCacheSize(): Promise<number> {
  const db = await openDB();
  const songs = await txGetAll<DownloadedSong>(db, STORE_SONGS);
  const thumbs = await txGetAll<CachedThumbnail>(db, STORE_THUMBS);
  db.close();
  const songSize = songs.reduce((acc, s) => acc + (s.size || 0), 0);
  const thumbSize = thumbs.reduce((acc, t) => acc + (t.blob?.size || 0), 0);
  return songSize + thumbSize;
}

export async function evictOldCache(targetBytes?: number): Promise<number> {
  const maxSize = targetBytes || MAX_CACHE_SIZE;
  const db = await openDB();
  const songs = await txGetAll<DownloadedSong>(db, STORE_SONGS);
  let totalSize = songs.reduce((acc, s) => acc + (s.size || 0), 0);
  let removed = 0;

  // Sort by downloadedAt ascending (oldest first) and remove until under limit
  const sorted = [...songs].sort((a, b) => a.downloadedAt - b.downloadedAt);
  for (const song of sorted) {
    if (totalSize <= maxSize) break;
    if (song.audioUrl) URL.revokeObjectURL(song.audioUrl);
    await txDelete(db, STORE_SONGS, song.id);
    totalSize -= song.size || 0;
    removed++;
  }

  db.close();
  return removed;
}

// ---------------------------------------------------------------------------
// Total cache size helper
// ---------------------------------------------------------------------------

export async function getDownloadCount(): Promise<number> {
  const db = await openDB();
  const count = await txCount(db, STORE_SONGS);
  db.close();
  return count;
}
