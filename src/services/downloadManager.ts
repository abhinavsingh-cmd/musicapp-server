import { Song } from '../types/music';
import { api } from '../config/api';
import { metricsCollector } from '../services/metricsCollector';

// -------------------------------
// Configuration
// -------------------------------

const CONFIG = {
  MAX_CACHE_SIZE: 500 * 1024 * 1024, // 500MB
  MAX_CONCURRENT_DOWNLOADS: 3,
  DOWNLOAD_TIMEOUT_MS: 30000,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY_MS: 2000,
  OFFLINE_THRESHOLD: 1024, // bytes
  MAX_RETRIES: 5,
  MAX_PARALLEL_STREAMS: 2,
  CHUNK_SIZE: 1024 * 1024, // 1MB
  DB_VERSION: 3,
  DB_NAME: 'music-app-offline-v3',
};

// -------------------------------
// Types
// -------------------------------

export interface DownloadedSong {
  id: string;
  youtubeId: string;
  title: string;
  artist: string;
  album?: string;
  genre?: string;
  duration: number;
  coverArt: string;
  audioUrl: string;
  audioBlob: Blob;
  downloadedAt: number;
  size: number;
}

export interface DownloadQueueItem {
  id: string;
  youtubeId: string;
  title: string;
  artist: string;
  album?: string;
  genre?: string;
  duration: number;
  coverArt?: string;
  audioUrl?: string;
  fileName: string;
  filePath?: string;
  fileSize?: number;
  downloadedBytes: number;
  status: DownloadStatus;
  error?: string;
  startTime?: number;
  endTime?: number;
  progress: number;
  priority: number;
  retryCount: number;
  tags: string[];
  metadata?: Record<string, any>;
  audioBlob?: Blob;
}

export type DownloadStatus = 
  | 'pending'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'verifying'
  | 'ready';

export interface DownloadProgress {
  id: string;
  loaded: number;
  total: number;
  percent: number;
  speed: number;
  remaining: number;
  estimatedTime: number;
}

export interface DownloadStats {
  totalDownloads: number;
  activeDownloads: number;
  failedDownloads: number;
  cacheSize: number;
  availableSpace: number;
}

export interface DownloadNotification {
  id: string;
  type: 'progress' | 'success' | 'error' | 'warning';
  title: string;
  message: string;
  song?: { id: string; title: string; artist: string; };
  action?: DownloadAction;
  persistent: boolean;
  timestamp: number;
}

export type DownloadAction = 
  | { type: 'play'; songId: string }
  | { type: 'view'; songId: string }
  | { type: 'share'; songId: string }
  | { type: 'delete'; songId: string }
  | { type: 'retry'; songId: string }
  | { type: 'pause'; songId: string }
  | { type: 'resume'; songId: string };

export interface DownloadSource {
  type: 'library' | 'trending' | 'search' | 'album' | 'playlist' | 'artist' | 'youtube';
  id: string;
  context?: {
    playlistId?: string;
    albumId?: string;
    artistName?: string;
    genre?: string;
  };
}

// -------------------------------
// Database Schema
// -------------------------------

const STORES = {
  DOWNLOADS: 'downloads_v3',
  QUEUE: 'queue_v3',
  NOTIFICATIONS: 'notifications_v3',
  SETTINGS: 'settings_v3',
  ANDROID_FILES: 'android_files_v3',
};

// -------------------------------
// Main Download Manager Class
// -------------------------------

export class DownloadManager {
  private static instance: DownloadManager;
  private db: IDBDatabase | null = null;
  private queue: DownloadQueueItem[] = [];
  private activeDownloads = new Map<string, DownloadQueueItem>();
  private progressCallbacks = new Map<string, Set<(progress: DownloadProgress) => void>>();
  private statusCallbacks = new Map<string, Set<(status: DownloadQueueItem) => void>>();
  private notificationCallbacks = new Set<(notification: DownloadNotification) => void>();
  private isOnline = navigator.onLine;
  private abortControllers = new Map<string, AbortController>();
  private retryTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  // Statistics
  private stats: DownloadStats = {
    totalDownloads: 0,
    activeDownloads: 0,
    failedDownloads: 0,
    cacheSize: 0,
    availableSpace: 0,
  };

  private constructor() {
    this.initializeEventListeners();
    this.loadStats();
  }

  static getInstance(): DownloadManager {
    if (!DownloadManager.instance) {
      DownloadManager.instance = new DownloadManager();
    }
    return DownloadManager.instance;
  }

  // -------------------------------
  // Initialization
  // -------------------------------

  private async initializeDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as any)?.result as IDBDatabase;

      if (!db.objectStoreNames.contains(STORES.DOWNLOADS)) {
        const downloadsStore = db.createObjectStore(STORES.DOWNLOADS, { keyPath: 'id' });
        downloadsStore.createIndex('status', 'status');
        downloadsStore.createIndex('youtubeId', 'youtubeId');
        downloadsStore.createIndex('downloadedAt', 'downloadedAt');
        downloadsStore.createIndex('priority', 'priority');
        downloadsStore.createIndex('tags', 'tags', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.QUEUE)) {
        const queueStore = db.createObjectStore(STORES.QUEUE, { keyPath: 'id' });
        queueStore.createIndex('status', 'status');
        queueStore.createIndex('priority', 'priority');
      }

      if (!db.objectStoreNames.contains(STORES.NOTIFICATIONS)) {
        const notificationsStore = db.createObjectStore(STORES.NOTIFICATIONS, { keyPath: 'id' });
        notificationsStore.createIndex('type', 'type');
        notificationsStore.createIndex('timestamp', 'timestamp');
      }

      if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
        db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
      }

      if (!db.objectStoreNames.contains(STORES.ANDROID_FILES)) {
        const androidStore = db.createObjectStore(STORES.ANDROID_FILES, { keyPath: 'youtubeId' });
        androidStore.createIndex('filePath', 'filePath');
        androidStore.createIndex('fileName', 'fileName');
      }
    };

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onerror = () => {
        reject(request.error);
      };

      request.onblocked = () => {
        console.warn('[DownloadManager] Database upgrade blocked');
      };
    });
  }

  private async loadStats(): Promise<void> {
    const db = await this.initializeDB();
    try {
      const tx = db.transaction(STORES.SETTINGS, 'readonly');
      const store = tx.objectStore(STORES.SETTINGS);
      const count = await new Promise<number>((resolve) => {
        const req = store.count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(0);
      });

      if (count === 0) {
        await this.saveStats();
      }
    } catch (error) {
      console.warn('[DownloadManager] Failed to load stats:', error);
      await this.saveStats();
    }
  }

  private async saveStats(): Promise<void> {
    const db = await this.initializeDB();
    try {
      const tx = db.transaction(STORES.SETTINGS, 'readwrite');
      const store = tx.objectStore(STORES.SETTINGS);

      await new Promise<void>((resolve) => {
        const req = store.put({ key: 'stats', value: this.stats });
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    } catch (error) {
      console.warn('[DownloadManager] Failed to save stats:', error);
    }
  }

  private initializeEventListeners(): void {
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.processQueue();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.pauseAllDownloads();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pauseAllDownloads();
      } else {
        this.processQueue();
      }
    });
  }

  // -------------------------------
  // Public API
  // -------------------------------

  async addToQueue(song: Song, source: DownloadSource, priority: number = 1): Promise<string> {
    const id = this.generateId();

    const queueItem: DownloadQueueItem = {
      id,
      youtubeId: song.youtubeId || song.id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      genre: song.genre,
      duration: song.duration,
      coverArt: song.coverArt,
      audioUrl: song.audioUrl,
      fileName: this.generateFileName(song),
      downloadedBytes: 0,
      status: 'pending',
      progress: 0,
      priority,
      retryCount: 0,
      tags: this.generateTags(song, source),
      metadata: {
        source,
        addedAt: Date.now(),
        lastModified: Date.now(),
      },
    };

    const db = await this.initializeDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORES.QUEUE, 'readwrite');
      const store = tx.objectStore(STORES.QUEUE);
      store.add(queueItem);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });

    this.queue.push(queueItem);
    this.queue.sort((a, b) => b.priority - a.priority);

    this.sendNotification({
      id: `queue-${id}`,
      type: 'progress',
      title: 'Added to download queue',
      message: `"${song.title}" by ${song.artist}"`,
      song: { id: song.id, title: song.title, artist: song.artist },
      action: { type: 'resume', songId: song.id },
      persistent: false,
      timestamp: Date.now(),
    });

    if (this.queue.length === 1) {
      this.processQueue();
    }

    return id;
  }

  async startDownload(id: string): Promise<void> {
    const queueItem = this.queue.find(item => item.id === id);
    if (!queueItem) return;

    if (queueItem.status !== 'pending') return;

    queueItem.status = 'downloading';
    queueItem.startTime = Date.now();
    this.updateQueueItem(queueItem);
    this.activeDownloads.set(id, queueItem);

    this.updateStats();
    this.emitStatusChange(queueItem);

    try {
      await this.downloadSong(queueItem);
    } catch (error) {
      queueItem.status = 'failed';
      queueItem.error = error instanceof Error ? error.message : 'Download failed';
      this.updateQueueItem(queueItem);
      this.emitStatusChange(queueItem);
      this.stats.failedDownloads++;
      this.updateStats();

      if (queueItem.retryCount < CONFIG.RETRY_ATTEMPTS) {
        this.scheduleRetry(queueItem);
      }
    } finally {
      this.activeDownloads.delete(id);
      this.updateStats();
    }
  }

  async pauseDownload(id: string): Promise<void> {
    const controller = this.abortControllers.get(id);
    if (controller) {
      controller.abort();
    }

    const queueItem = this.queue.find(item => item.id === id);
    if (queueItem) {
      queueItem.status = 'paused';
      this.updateQueueItem(queueItem);
      this.emitStatusChange(queueItem);
    }
  }

  async resumeDownload(id: string): Promise<void> {
    const queueItem = this.queue.find(item => item.id === id);
    if (!queueItem) return;

    if (queueItem.status !== 'paused') return;

    queueItem.status = 'pending';
    queueItem.retryCount++;
    this.updateQueueItem(queueItem);
    this.emitStatusChange(queueItem);

    this.processQueue();
  }

  async cancelDownload(id: string): Promise<void> {
    const controller = this.abortControllers.get(id);
    if (controller) {
      controller.abort();
    }

    const queueItem = this.queue.find(item => item.id === id);
    if (!queueItem) return;

    queueItem.status = 'cancelled';
    this.removeFromQueue(id);
    this.updateQueueItem(queueItem);
    this.emitStatusChange(queueItem);

    this.sendNotification({
      id: `cancel-${id}-${Date.now()}`,
      type: 'warning',
      title: 'Download cancelled',
      message: `"${queueItem.title}" has been cancelled`,
      song: { id: queueItem.youtubeId, title: queueItem.title, artist: queueItem.artist },
      persistent: false,
      timestamp: Date.now(),
    });
  }

  async removeFromQueue(id: string): Promise<void> {
    this.queue = this.queue.filter(item => item.id !== id);

    const db = await this.initializeDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORES.QUEUE, 'readwrite');
      const store = tx.objectStore(STORES.QUEUE);
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  async retryDownload(id: string): Promise<void> {
    const queueItem = this.queue.find(item => item.id === id);
    if (!queueItem || queueItem.status !== 'failed') return;

    queueItem.status = 'pending';
    queueItem.retryCount++;
    delete queueItem.error;
    this.updateQueueItem(queueItem);
    this.emitStatusChange(queueItem);

    this.processQueue();
  }

  getQueue(): DownloadQueueItem[] {
    return [...this.queue];
  }

  getActiveDownloads(): DownloadQueueItem[] {
    return Array.from(this.activeDownloads.values());
  }

  getStats(): DownloadStats {
    return { ...this.stats };
  }

  subscribeToProgress(songId: string, callback: (progress: DownloadProgress) => void): () => void {
    if (!this.progressCallbacks.has(songId)) {
      this.progressCallbacks.set(songId, new Set());
    }
    this.progressCallbacks.get(songId)?.add(callback);

    return () => {
      this.progressCallbacks.get(songId)?.delete(callback);
    };
  }

  subscribeToStatus(songId: string, callback: (item: DownloadQueueItem) => void): () => void {
    if (!this.statusCallbacks.has(songId)) {
      this.statusCallbacks.set(songId, new Set());
    }
    this.statusCallbacks.get(songId)?.add(callback);

    return () => {
      this.statusCallbacks.get(songId)?.delete(callback);
    };
  }

  subscribeToNotifications(callback: (notification: DownloadNotification) => void): () => void {
    this.notificationCallbacks.add(callback);
    return () => {
      this.notificationCallbacks.delete(callback);
    };
  }

  async clearAllDownloads(): Promise<void> {
    for (const [, controller] of this.abortControllers) {
      controller.abort();
    }

    const db = await this.initializeDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORES.DOWNLOADS, 'readwrite');
      tx.objectStore(STORES.DOWNLOADS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });

    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORES.QUEUE, 'readwrite');
      tx.objectStore(STORES.QUEUE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });

    this.queue = [];
    this.activeDownloads.clear();
    this.stats.totalDownloads = 0;
    this.stats.activeDownloads = 0;
    this.stats.failedDownloads = 0;
    this.updateStats();
  }

  // -------------------------------
  // Helper Methods
  // -------------------------------

  private async downloadSong(queueItem: DownloadQueueItem): Promise<void> {
    const startTime = performance.now();
    const controller = new AbortController();
    this.abortControllers.set(queueItem.id, controller);

    try {
      const existing = await this.getDownload(queueItem.youtubeId);
      if (existing) {
        queueItem.status = 'completed';
        queueItem.progress = 100;
        queueItem.endTime = Date.now();
        this.updateQueueItem(queueItem);
        this.saveDownload(queueItem);
        this.emitStatusChange(queueItem);
        return;
      }

      let downloadUrl: string;
      if (queueItem.audioUrl) {
        downloadUrl = queueItem.audioUrl;
      } else {
        downloadUrl = api(`/download/${queueItem.youtubeId}?title=${encodeURIComponent(queueItem.title)}`);
      }

      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');

      const response = await fetch(downloadUrl, {
        signal: controller.signal,
        headers: { 'Range': 'bytes=0-' },
      });

      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }

      const contentLength = Number(response.headers.get('content-length')) || 0;
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body available');
      }

      const contentType = response.headers.get('content-type') || 'audio/mpeg';
      if (!contentType.includes('audio/')) {
        throw new Error(`Invalid file type: ${contentType}`);
      }

      const chunks: Uint8Array[] = [];
      let loaded = 0;
      let lastProgressTime = Date.now();
      let speedSamples: number[] = [];

      while (true) {
        if (controller.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        loaded += value.length;

        const now = Date.now();
        const elapsed = (now - lastProgressTime) / 1000;
        if (elapsed >= 0.5) {
          const speed = loaded / (elapsed || 0.001);
          speedSamples.push(speed);
          if (speedSamples.length > 10) speedSamples.shift();

          const avgSpeed = speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length;
          const remaining = contentLength ? contentLength - loaded : 0;
          const estimatedTime = avgSpeed > 0 ? remaining / avgSpeed : 0;

          const progress: DownloadProgress = {
            id: queueItem.id,
            loaded,
            total: contentLength || loaded,
            percent: contentLength ? Math.min(100, Math.round((loaded / contentLength) * 100)) : 0,
            speed: avgSpeed,
            remaining,
            estimatedTime,
          };

          this.emitProgress(queueItem.id, progress);

          lastProgressTime = now;
        }
      }

      const blob = new Blob(chunks, { type: contentType });

      if (blob.size === 0) {
        throw new Error('Downloaded file is empty');
      }

      queueItem.audioBlob = blob;
      queueItem.fileSize = blob.size;
      queueItem.downloadedBytes = blob.size;

      await this.saveDownload(queueItem);

      const duration = (performance.now() - startTime) / 1000;
      const bytesPerSecond = blob.size / (duration || 1);

      metricsCollector.pushDownloadSpeed({
        bytesPerSecond,
        timestamp: Date.now(),
      });

      queueItem.status = 'verifying';
      this.updateQueueItem(queueItem);

      await this.verifyDownload(queueItem);

      this.sendNotification({
        id: `success-${queueItem.id}-${Date.now()}`,
        type: 'success',
        title: 'Download complete',
        message: `"${queueItem.title}" by ${queueItem.artist} is ready for offline playback`,
        song: { id: queueItem.youtubeId, title: queueItem.title, artist: queueItem.artist },
        action: { type: 'play', songId: queueItem.youtubeId },
        persistent: true,
        timestamp: Date.now(),
      });

    } catch (error) {
      throw error;
    } finally {
      this.abortControllers.delete(queueItem.id);
    }
  }

  private async saveDownload(queueItem: DownloadQueueItem): Promise<void> {
    const db = await this.initializeDB();

    const download: DownloadedSong = {
      id: queueItem.id,
      youtubeId: queueItem.youtubeId,
      title: queueItem.title,
      artist: queueItem.artist,
      genre: queueItem.genre || '',
      duration: queueItem.duration,
      coverArt: queueItem.coverArt || '',
      audioBlob: queueItem.audioBlob || new Blob(),
      audioUrl: queueItem.audioUrl || '',
      downloadedAt: queueItem.startTime || Date.now(),
      size: queueItem.fileSize || 0,
    };

    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORES.DOWNLOADS, 'readwrite');
      const store = tx.objectStore(STORES.DOWNLOADS);
      store.put(download);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });

    this.stats.totalDownloads++;
    this.updateStats();
  }

  private async verifyDownload(queueItem: DownloadQueueItem): Promise<void> {
    if (!queueItem.audioBlob || queueItem.audioBlob.size === 0) {
      throw new Error('Invalid downloaded file');
    }

    try {
      const audioUrl = URL.createObjectURL(queueItem.audioBlob);
      const audio = new Audio();
      audio.src = audioUrl;

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Verification timeout')), 5000);
      });

      await Promise.race([
        new Promise<void>((resolve, reject) => {
          audio.addEventListener('canplay', () => resolve());
          audio.addEventListener('error', () => reject(new Error('Audio verification failed')));
          audio.load();
        }),
        timeoutPromise,
      ]);

      URL.revokeObjectURL(audioUrl);
    } catch (error) {
      console.warn('[DownloadManager] File verification failed:', error);
      this.sendNotification({
        id: `verify-${queueItem.id}-${Date.now()}`,
        type: 'warning',
        title: 'Download verification warning',
        message: `"${queueItem.title}" downloaded but may have issues`,
        song: { id: queueItem.youtubeId, title: queueItem.title, artist: queueItem.artist },
        persistent: false,
        timestamp: Date.now(),
      });
    }

    queueItem.status = 'ready';
    queueItem.progress = 100;
    this.updateQueueItem(queueItem);
  }

  private processQueue(): void {
    if (!this.isOnline) {
      return;
    }

    if (this.activeDownloads.size >= CONFIG.MAX_CONCURRENT_DOWNLOADS) {
      return;
    }

    const pendingDownloads = this.queue.filter(item => item.status === 'pending');
    if (pendingDownloads.length === 0) {
      return;
    }

    const nextItem = pendingDownloads[0];
    this.startDownload(nextItem.id);
  }

  private scheduleRetry(queueItem: DownloadQueueItem): void {
    const delay = CONFIG.RETRY_DELAY_MS * Math.pow(2, queueItem.retryCount - 1);
    const timeoutId = setTimeout(() => {
      if (queueItem.status === 'failed') {
        this.processQueue();
      }
    }, delay);

    this.retryTimeouts.set(queueItem.id, timeoutId);
  }

  private updateQueueItem(queueItem: DownloadQueueItem): void {
    const index = this.queue.findIndex(item => item.id === queueItem.id);
    if (index !== -1) {
      this.queue[index] = queueItem;
    }
  }

  private emitProgress(songId: string, progress: DownloadProgress): void {
    this.progressCallbacks.get(songId)?.forEach(callback => {
      try {
        callback(progress);
      } catch (error) {
        console.error('[DownloadManager] Error in progress callback:', error);
      }
    });
  }

  private emitStatusChange(queueItem: DownloadQueueItem): void {
    this.statusCallbacks.get(queueItem.youtubeId)?.forEach(callback => {
      try {
        callback(queueItem);
      } catch (error) {
        console.error('[DownloadManager] Error in status callback:', error);
      }
    });
  }

  private sendNotification(notification: DownloadNotification): void {
    this.notificationCallbacks.forEach(callback => {
      try {
        callback(notification);
      } catch (error) {
        console.error('[DownloadManager] Error in notification callback:', error);
      }
    });
  }

  private updateStats(): void {
    this.stats.activeDownloads = this.activeDownloads.size;
    this.saveStats();
  }

  private generateId(): string {
    return `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateFileName(song: Song): string {
    const sanitizedTitle = song.title.replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, '_');
    const sanitizedArtist = song.artist.replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, '_');
    return `${sanitizedArtist} - ${sanitizedTitle}.mp3`;
  }

  private generateTags(song: Song, source: DownloadSource): string[] {
    const tags: string[] = [source.type];
    if (song.genre) tags.push(song.genre.toLowerCase());
    if (song.artist) tags.push(song.artist.toLowerCase());
    if (source.context?.genre) tags.push(source.context.genre.toLowerCase());
    return tags;
  }

  private pauseAllDownloads(): void {
    for (const [, controller] of this.abortControllers) {
      controller.abort();
    }

    for (const item of this.queue) {
      if (item.status === 'downloading') {
        item.status = 'paused';
        this.updateQueueItem(item);
      }
    }
  }

  private async getDownload(youtubeId: string): Promise<DownloadedSong | null> {
    const db = await this.initializeDB();
    try {
      const tx = db.transaction(STORES.DOWNLOADS, 'readonly');
      const store = tx.objectStore(STORES.DOWNLOADS);
      const index = store.index('youtubeId');
      const request = index.get(youtubeId);
      return await new Promise<DownloadedSong | null>((resolve) => {
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }
}

export const downloadManager = DownloadManager.getInstance();