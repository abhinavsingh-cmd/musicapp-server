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
 *   - Pause / Resume / Cancel support
 *   - File verification before marking complete
 *   - LRU eviction when total cache exceeds MAX_CACHE_SIZE
 *   - Thumbnail prefetch alongside song download
 */

import { toTrack } from '../providers/adapters';
import { resolveDownloadDescriptor } from '../providers/resolve';
import type { Track } from '../providers/types';
import { logger } from './logger';

const DB_NAME = 'music-app-offline';
const DB_VERSION = 2;
const STORE_SONGS = 'songs';
const STORE_THUMBS = 'thumbnails';
const STORE_META = 'meta';

const MAX_CACHE_SIZE = 500 * 1024 * 1024; // 500 MB soft limit
const MIN_AUDIO_SIZE = 10 * 1024; // 10 KB — anything smaller is not a valid audio file

/**
 * Hard deadline for the initial download request (response headers). The
 * server's /api/download endpoint buffers the whole yt-dlp payload before
 * committing headers and caps each attempt at 60s × 2 attempts, so a
 * healthy-but-slow download can legitimately take ~2 minutes. This bound
 * sits above that: it only fires when the server accepts the connection but
 * NEVER responds (a wedged process/network) — which would otherwise leave
 * the row button spinning forever.
 */
export const HEADER_TIMEOUT_MS = 150_000;

/**
 * No-data stall deadline while streaming the body. Reset on every received
 * chunk, so it only fires when the connection is truly dead (no bytes AND no
 * end-of-stream for this long) — the server's own idle caps are shorter, so
 * a healthy transfer can never trip it. Without this a wedged mid-stream
 * connection keeps the download "in progress" forever.
 */
export const STALL_TIMEOUT_MS = 40_000;

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
  // Bounded map: evict the oldest entry (and its object URL) when full.
  if (thumbnailUrlCache.size > MAX_THUMBNAIL_URLS) {
    const oldest = thumbnailUrlCache.keys().next().value;
    if (oldest !== undefined) {
      const oldUrl = thumbnailUrlCache.get(oldest);
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      thumbnailUrlCache.delete(oldest);
    }
  }
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

export type DownloadState = 'idle' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled';

/**
 * A download failure is *transient* when a retry has a realistic chance of
 * succeeding (network blip, connection drop mid-stream, truncated transfer,
 * rate limit, upstream 5xx). Deterministic failures (403 expired link, 404,
 * non-audio payload) are NOT transient — retrying them just burns quota.
 *
 * `downloadSongWithProgress` tags thrown errors with this flag so the store
 * can decide whether to auto-retry without re-parsing message strings.
 */
export function isTransientDownloadError(err: unknown): boolean {
  return !!(err && typeof err === 'object' && (err as { transient?: boolean }).transient === true);
}

function downloadFailure(message: string, opts?: { transient?: boolean; cause?: unknown }): Error {
  const err = new Error(message, opts?.cause !== undefined ? { cause: opts.cause } : undefined);
  (err as { transient?: boolean }).transient = opts?.transient ?? false;
  return err;
}

/**
 * Race a promise against a hard deadline. `onTimeout` runs first so the
 * caller can cancel the underlying operation (abort the fetch, cancel the
 * reader) before the TimeoutError rejects the race. The wrapped operation is
 * abandoned — the returned promise ALWAYS settles within `ms`.
 */
function raceWithTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new DOMException('TimedOut', 'TimeoutError'));
    }, ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------
// Pause / Resume controller
// ---------------------------------------------------------------------------

interface DownloadController {
  abortController: AbortController;
  paused: boolean;
  pauseGate: { promise: Promise<void>; resolve: () => void } | null;
}

const activeControllers = new Map<string, DownloadController>();

function getOrCreateController(key: string): DownloadController {
  let ctrl = activeControllers.get(key);
  if (!ctrl) {
    ctrl = { abortController: new AbortController(), paused: false, pauseGate: null };
    activeControllers.set(key, ctrl);
  }
  return ctrl;
}

export function pauseDownload(youtubeId: string): void {
  const ctrl = getOrCreateController(youtubeId);
  if (ctrl.paused) return;
  ctrl.paused = true;
  let resolveFn!: () => void;
  const promise = new Promise<void>((resolve) => { resolveFn = resolve; });
  ctrl.pauseGate = { promise, resolve: resolveFn };
}

export function resumeDownload(youtubeId: string): void {
  const ctrl = activeControllers.get(youtubeId);
  if (!ctrl || !ctrl.paused) return;
  ctrl.paused = false;
  // Release the gate if the read loop is already waiting on it. If the loop
  // has not reached the pause check yet, the cleared `paused` flag alone is
  // enough — it will never block.
  ctrl.pauseGate?.resolve();
  ctrl.pauseGate = null;
}

export function cancelDownloadById(youtubeId: string): void {
  const ctrl = activeControllers.get(youtubeId);
  if (ctrl) {
    ctrl.abortController.abort();
    ctrl.pauseGate?.resolve();
    ctrl.pauseGate = null;
    activeControllers.delete(youtubeId);
  }
}

export function isDownloadPaused(youtubeId: string): boolean {
  return activeControllers.get(youtubeId)?.paused ?? false;
}

// ---------------------------------------------------------------------------
// File verification
// ---------------------------------------------------------------------------

/**
 * Sniff the leading bytes of a downloaded payload to confirm it actually
 * contains audio data, not an error page, JSON body, or other mislabeled
 * content served with an audio/* content-type.
 */
export function sniffAudioBytes(head: Uint8Array): boolean {
  if (!head || head.length === 0) return false;
  // ID3v2 tag ('ID3')
  if (head.length >= 3 && head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return true;
  // MPEG audio frame sync (MP3) or ADTS (AAC)
  if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return true;
  // MP4 / M4A / MOV container ('....ftyp')
  if (head.length >= 12 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return true;
  // WebM / Matroska (EBML)
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return true;
  // Ogg ('OggS')
  if (head.length >= 4 && head[0] === 0x4f && head[1] === 0x67 && head[2] === 0x67 && head[3] === 0x53) return true;
  // FLAC ('fLaC')
  if (head.length >= 4 && head[0] === 0x66 && head[1] === 0x4c && head[2] === 0x61 && head[3] === 0x43) return true;
  // RIFF / WAVE ('RIFF....WAVE')
  if (head.length >= 12 && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
      head[8] === 0x57 && head[9] === 0x41 && head[10] === 0x56 && head[11] === 0x45) return true;
  // AIFF ('FORM....AIFF')
  if (head.length >= 12 && head[0] === 0x46 && head[1] === 0x4f && head[2] === 0x52 && head[3] === 0x4d &&
      head[8] === 0x41 && head[9] === 0x49 && head[10] === 0x46 && head[11] === 0x46) return true;
  return false;
}

async function verifyAudioBlob(blob: unknown): Promise<boolean> {
  if (!(blob instanceof Blob)) return false;
  if (blob.size < MIN_AUDIO_SIZE) return false;
  const type = blob.type.toLowerCase();
  // Accept common audio types or octet-stream (some servers don't set content-type)
  if (!type.startsWith('audio/') && type !== 'application/octet-stream' && type !== '') return false;
  try {
    // Require the payload to actually look like audio, regardless of what the
    // server claimed — expired stream URLs often return HTML/JSON error pages
    // with a stale audio/* content-type.
    const head = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
    return sniffAudioBytes(head);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Download a song with progress, pause, resume, cancel, and verification
// ---------------------------------------------------------------------------

/**
 * The download system consumes a normalized track (or a legacy Song-like
 * object, which is normalized first). The actual download URL comes from the
 * track's provider via `resolveDownloadDescriptor` — the downloader never
 * knows whether the track is a YouTube video, a server-hosted library file,
 * or a future provider's stream.
 */
export type DownloadableInput =
  | Track
  | {
      id: string;
      youtubeId: string;
      title: string;
      artist: string;
      genre: string;
      duration: number;
      coverArt: string;
      audioUrl?: string;
    };

export async function downloadSongWithProgress(
  input: DownloadableInput,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<DownloadedSong> {
  const track = toTrack(input);
  const descriptor = await resolveDownloadDescriptor(track);
  const downloadUrl = descriptor?.url || '';

  logger.debug('[Download] Starting:', { title: track.title, provider: track.provider, externalId: track.externalId || 'NONE', url: downloadUrl.substring(0, 120) });

  if (!downloadUrl) {
    throw downloadFailure('No download URL available for this song');
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  let res: Response;
  // The caller's abort must still cancel the fetch — it forwards to a local
  // controller so exactly one abort path drives the request. A hard header
  // deadline then races the fetch itself: a server that accepts the
  // connection but never responds (wedged process/network) is a transient
  // failure instead of an endless spinner.
  const requestController = new AbortController();
  const forwardCallerAbort = () => requestController.abort();
  signal?.addEventListener('abort', forwardCallerAbort, { once: true });
  try {
    // fetch() follows redirects automatically; whatever the final hop serves
    // still passes every validation below (status, content-type, magic bytes).
    res = await raceWithTimeout(
      fetch(downloadUrl, {
        signal: requestController.signal,
        redirect: 'follow',
        headers: { 'Accept': 'audio/*' },
      }),
      HEADER_TIMEOUT_MS,
      () => requestController.abort(),
    );
  } catch (fetchErr: any) {
    if (fetchErr?.name === 'AbortError' || signal?.aborted) throw fetchErr;
    if (fetchErr?.name === 'TimeoutError') {
      throw downloadFailure('Download request timed out — the server did not respond', { transient: true, cause: fetchErr });
    }
    logger.error('[Download] fetch() failed:', fetchErr?.message || fetchErr);
    throw downloadFailure(`Network error: ${fetchErr?.message || fetchErr}`, { transient: true, cause: fetchErr });
  } finally {
    signal?.removeEventListener('abort', forwardCallerAbort);
  }

  if (res.redirected) {
    logger.debug('[Download] Followed redirect to:', res.url?.substring(0, 120));
  }

  logger.debug('[Download] Response:', { status: res.status, type: res.headers.get('content-type'), len: res.headers.get('content-length'), body: !!res.body });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.clone().json())?.message || ''; } catch {}
    // Map common statuses to human-readable causes so the Downloads UI shows
    // the real reason instead of a bare status code.
    let reason: string;
    switch (res.status) {
      case 403:
        reason = 'Access denied — the stream link is expired or blocked';
        break;
      case 404:
        reason = 'The audio source was not found';
        break;
      case 429:
        reason = 'Server is rate-limiting downloads — try again in a minute';
        break;
      default:
        reason = res.status >= 500
          ? 'The download server hit an error'
          : 'Download failed';
    }
    throw downloadFailure(`${reason} (HTTP ${res.status})${detail ? ' — ' + detail : ''}`, {
      // 429 (rate limit) and 5xx (server-side) are worth an automatic retry;
      // 4xx client errors (expired link, not found) are deterministic.
      transient: res.status === 429 || res.status >= 500,
    });
  }

  const contentType = res.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase() || '';

  // Never save an error page as an audio file: HTML and JSON bodies are
  // rejected up front, regardless of what the body bytes look like.
  if (contentType && !contentType.startsWith('audio/') && contentType !== 'application/octet-stream') {
    if (contentType.startsWith('application/json')) {
      let msg: string;
      try { msg = (await res.clone().json())?.message || 'Server returned an error'; } catch { msg = 'Server returned an error'; }
      throw downloadFailure(msg);
    }
    if (contentType.startsWith('text/html')) {
      throw new Error('Server returned an HTML error page instead of audio — the stream link may have expired, try again');
    }
    throw new Error(`Unexpected response type: ${contentType}`);
  }

  const contentLength = Number(res.headers.get('content-length')) || 0;
  if (contentLength === 0 && !res.body) {
    throw downloadFailure('Server returned an empty response — the stream link may have expired, try again', { transient: true });
  }

  const reader = res.body?.getReader();
  if (!reader) throw downloadFailure('No response body', { transient: true });

  const chunks: Uint8Array[] = [];
  let received = 0;

  // A cancel while paused must release the pause gate — otherwise the read
  // loop blocks on it forever, the downloadSong promise never settles, and
  // the store's parallel-download slot leaks until new downloads queue up.
  const releasePauseOnAbort = () => {
    const c = activeControllers.get(track.externalId || track.id);
    if (c?.pauseGate) { c.pauseGate.resolve(); c.pauseGate = null; }
  };
  if (signal) signal.addEventListener('abort', releasePauseOnAbort, { once: true });

  // Stall-safe read: any single read that yields nothing for STALL_TIMEOUT_MS
  // is a dead connection. The race rejects independently of the reader so a
  // platform that never surfaces the stall cannot leave the download pending.
  const readWithStall = (): Promise<ReadableStreamReadResult<Uint8Array>> =>
    new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { reader.cancel(); } catch {}
        reject(downloadFailure(`Download stalled — no data received for ${STALL_TIMEOUT_MS / 1000}s`, { transient: true }));
      }, STALL_TIMEOUT_MS);
      reader.read().then(
        (r) => { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } },
        (err) => { if (!settled) { settled = true; clearTimeout(timer); reject(err); } },
      );
    });

  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      // Check pause state — block until resumed (or cancelled, which aborts).
      const ctrl = activeControllers.get(track.externalId || track.id);
      if (ctrl?.paused && ctrl.pauseGate) {
        await ctrl.pauseGate.promise;
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      }

      const { done, value } = await readWithStall();
      if (done) break;
      chunks.push(value);
      received += value.length;
      // Over-delivery: the connection produced more bytes than the declared
      // Content-Length. That is just as corrupt as a truncated transfer —
      // never assemble a blob whose true size contradicts the headers.
      if (contentLength > 0 && received > contentLength) {
        try { reader.cancel(); } catch {}
        throw downloadFailure(`Corrupted download: received ${received} bytes but server declared ${contentLength}`, { transient: true });
      }
      onProgress?.({ loaded: received, total: contentLength || received, percent: contentLength ? Math.round((received / contentLength) * 100) : 0 });
    }
  } catch (err: any) {
    if (err?.name === 'AbortError' || signal?.aborted) throw err;
    if (isTransientDownloadError(err)) throw err;
    logger.error('[Download] Stream interrupted:', err?.message || err);
    throw downloadFailure(`Connection lost during download${err?.message ? ': ' + err.message : ''}`, { transient: true, cause: err });
  } finally {
    signal?.removeEventListener('abort', releasePauseOnAbort);
  }

  // Partial transfer: the server declared more bytes than the connection
  // actually delivered. Never persist a truncated file as a valid download.
  if (contentLength > 0 && received < contentLength) {
    throw downloadFailure(`Incomplete download: received ${received} of ${contentLength} bytes`, { transient: true });
  }

  // A fully-empty stream is never a valid download. Rejected explicitly so
  // the error names the real cause, and so the "invalid file" check below
  // can never report a 0-byte file.
  if (received === 0) {
    throw downloadFailure('Downloaded file is empty: 0 bytes — the server returned no audio data', { transient: true });
  }

  if (received < MIN_AUDIO_SIZE) {
    throw downloadFailure(`Downloaded file is too small: ${received} bytes (minimum ${MIN_AUDIO_SIZE}) — the stream link may have expired, try again`, { transient: true });
  }

  const blobType = contentType || 'audio/mpeg';
  const blob = new Blob(chunks, { type: blobType });

  logger.debug('[Download] Complete:', { received, blobSize: blob.size, type: blobType });

  if (!(await verifyAudioBlob(blob))) {
    // Not retryable: the server completed the transfer but the payload is
    // not audio (error page, empty file, wrong content). Retrying the same
    // URL would return the same bytes.
    throw downloadFailure(`Downloaded file is invalid: ${blob.size} bytes, type: ${blob.type || 'unknown'} — the response did not contain valid audio data`);
  }

  // Persist to IndexedDB
  const db = await openDB();
  const entry: DownloadedSong = {
    id: track.id,
    youtubeId: track.externalId || '',
    title: track.title,
    artist: track.artist,
    genre: track.genre,
    duration: track.duration,
    coverArt: track.artwork,
    audioBlob: blob,
    audioUrl: '',
    downloadedAt: Date.now(),
    size: blob.size,
  };
  try {
    await txPut(db, STORE_SONGS, entry);
  } catch (err: any) {
    db.close();
    // IndexedDB throws DOMException with name "QuotaExceededError" when storage
    // is full.  Surface a clear message instead of a generic failure.
    if (err?.name === 'QuotaExceededError' || err?.message?.includes('quota')) {
      throw downloadFailure('Storage full — free up space and try again', { cause: err });
    }
    throw downloadFailure(`Failed to save to local storage: ${err?.message || err}`, { transient: true, cause: err });
  }
  db.close();

  entry.audioUrl = URL.createObjectURL(blob);

  // Cache thumbnail in background
  getCachedImageUrl(track.artwork).catch(() => {});

  // Cache metadata
  cacheMetadata({
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    genre: track.genre,
    duration: track.duration,
    coverArt: track.artwork,
    youtubeId: track.externalId,
    releaseYear: track.releaseYear,
  }).catch(() => {});

  return entry;
}

// ---------------------------------------------------------------------------
// Thumbnail cache — THE single image cache for the app
// ---------------------------------------------------------------------------
// CachedImage (UI cover art) and the download pipeline both read through
// this one function. Blobs persist in IndexedDB (offline-safe, counted in
// the storage breakdown) and surface as blob: URLs via a bounded in-memory
// map so repeat renders never re-read the DB or re-fetch the network.

/** Cap for the in-memory blob-URL map (evicts oldest first). */
const MAX_THUMBNAIL_URLS = 100;

/**
 * Resolve a cover-art URL to a cached blob: URL, fetching and persisting on
 * miss. Returns the original URL unchanged for empty/data: URLs and when the
 * fetch fails (callers fall back to the remote URL).
 */
export async function getCachedImageUrl(url: string): Promise<string> {
  if (!url || url.startsWith('data:')) return url;

  // Fast path: already materialized as a blob URL this session.
  const memHit = thumbnailUrlCache.get(url);
  if (memHit) return memHit;

  const db = await openDB();
  try {
    const existing = await txGet<CachedThumbnail>(db, STORE_THUMBS, url);
    if (existing?.blob) return getThumbnailObjectUrl(existing);

    // Fetch + persist on miss.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, { credentials: 'omit', signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return url;
    const blob = await res.blob();
    await txPut(db, STORE_THUMBS, { url, blob, cachedAt: Date.now() });
    return getThumbnailObjectUrl({ url, blob, cachedAt: Date.now() });
  } catch {
    return url;
  } finally {
    db.close();
  }
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
// Blob integrity verification
// ---------------------------------------------------------------------------

/**
 * Check if a downloaded entry has a valid audio blob that can be played.
 * Returns true if the blob exists and has a reasonable minimum size.
 */
export function isValidBlob(blob: unknown): blob is Blob {
  return blob instanceof Blob && blob.size >= MIN_AUDIO_SIZE;
}

// ---------------------------------------------------------------------------
// Database repair
// ---------------------------------------------------------------------------

/**
 * Iterate all downloaded songs and remove entries whose audio blobs are
 * missing or too small to be valid audio files.  This fixes phantom
 * "downloaded" status that appears when IndexedDB entries become corrupted
 * (e.g. after a WebView crash, storage eviction, or failed write).
 *
 * Returns the number of entries removed so callers can notify the user.
 */
export async function repairDownloads(): Promise<number> {
  const db = await openDB();
  const all = await txGetAll<DownloadedSong>(db, STORE_SONGS);
  let removed = 0;
  for (const entry of all) {
    // Full verification (size + mime + magic bytes) removes phantom entries
    // left behind by older builds that could persist 0-byte "audio/mpeg" blobs.
    if (!(await verifyAudioBlob(entry.audioBlob))) {
      await txDelete(db, STORE_SONGS, entry.id);
      removed++;
    }
  }
  db.close();
  if (removed > 0) {
    logger.warn(`[Downloads] Repaired: removed ${removed} corrupted/empty download entries`);
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Song CRUD
// ---------------------------------------------------------------------------

export async function saveDownload(song: Omit<DownloadedSong, 'audioUrl' | 'downloadedAt' | 'size'>): Promise<DownloadedSong> {
  // Never persist an invalid blob — a download record is only meaningful when
  // its audio data is actually playable.
  if (!(await verifyAudioBlob(song.audioBlob))) {
    throw new Error(`Cannot save invalid audio blob: ${song.audioBlob?.size ?? 0} bytes, type: ${song.audioBlob?.type || 'unknown'}`);
  }
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
// Storage management
// ---------------------------------------------------------------------------

export async function getDownloadCount(): Promise<number> {
  const db = await openDB();
  const count = await txCount(db, STORE_SONGS);
  db.close();
  return count;
}

export async function getStorageBreakdown(): Promise<{ songs: number; thumbnails: number; total: number }> {
  const db = await openDB();
  const songs = await txGetAll<DownloadedSong>(db, STORE_SONGS);
  const thumbs = await txGetAll<CachedThumbnail>(db, STORE_THUMBS);
  db.close();
  const songsSize = songs.reduce((acc, s) => acc + (s.size || 0), 0);
  const thumbsSize = thumbs.reduce((acc, t) => acc + (t.blob?.size || 0), 0);
  return { songs: songsSize, thumbnails: thumbsSize, total: songsSize + thumbsSize };
}

export async function clearThumbnailCache(): Promise<void> {
  const db = await openDB();
  await txClear(db, STORE_THUMBS);
  db.close();
  thumbnailUrlCache.clear();
}
