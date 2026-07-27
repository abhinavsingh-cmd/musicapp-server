/**
 * Central metrics collector for the developer diagnostics page.
 *
 * Every subsystem (api, audio, search, etc.) pushes data here.
 * The DevPage polls it via useSyncExternalStore-style subscription.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LatencySample {
  url: string;
  duration: number;
  timestamp: number;
  cached: boolean;
  ok: boolean;
}

export interface SearchLatencySample {
  query: string;
  duration: number;
  resultCount: number;
  timestamp: number;
}

export interface StreamLatencySample {
  songId: string;
  duration: number;
  timestamp: number;
}

export interface BufferSample {
  songId: string;
  bufferDuration: number;
  timestamp: number;
}

export interface FailedRequest {
  url: string;
  status: number;
  error: string;
  timestamp: number;
}

export interface DownloadSpeedSample {
  bytesPerSecond: number;
  timestamp: number;
}

export interface CacheHitEvent {
  key: string;
  hit: boolean;
  timestamp: number;
}

export interface MetricsSnapshot {
  startupTimeMs: number;
  apiLatencies: LatencySample[];
  searchLatencies: SearchLatencySample[];
  streamLatencies: StreamLatencySample[];
  bufferSamples: BufferSample[];
  memoryUsageMB: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
  failedRequests: FailedRequest[];
  downloadSpeedSamples: DownloadSpeedSample[];
  totalApiCalls: number;
  totalCacheEvents: number;
}

type Listener = () => void;

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

class MetricsCollector {
  private listeners = new Set<Listener>();

  // Startup
  private _startupTimeMs = 0;

  // API
  private _apiLatencies: LatencySample[] = [];
  private _totalApiCalls = 0;

  // Search
  private _searchLatencies: SearchLatencySample[] = [];

  // Stream / buffer
  private _streamLatencies: StreamLatencySample[] = [];
  private _bufferSamples: BufferSample[] = [];

  // Cache
  private _cacheHits = 0;
  private _cacheMisses = 0;
  private _totalCacheEvents = 0;

  // Failed requests
  private _failedRequests: FailedRequest[] = [];

  // Download speed
  private _downloadSpeedSamples: DownloadSpeedSample[] = [];

  // Caps
  private static MAX_SAMPLES = 200;
  private static MAX_FAILURES = 100;

  // ---- Public API for producers ----

  setStartupTime(ms: number) {
    this._startupTimeMs = ms;
    this.emit();
  }

  pushApiLatency(sample: LatencySample) {
    this._apiLatencies.push(sample);
    this._totalApiCalls++;
    if (this._apiLatencies.length > MetricsCollector.MAX_SAMPLES) {
      this._apiLatencies = this._apiLatencies.slice(-MetricsCollector.MAX_SAMPLES);
    }
    this.emit();
  }

  pushSearchLatency(sample: SearchLatencySample) {
    this._searchLatencies.push(sample);
    if (this._searchLatencies.length > MetricsCollector.MAX_SAMPLES) {
      this._searchLatencies = this._searchLatencies.slice(-MetricsCollector.MAX_SAMPLES);
    }
    this.emit();
  }

  pushStreamLatency(sample: StreamLatencySample) {
    this._streamLatencies.push(sample);
    if (this._streamLatencies.length > MetricsCollector.MAX_SAMPLES) {
      this._streamLatencies = this._streamLatencies.slice(-MetricsCollector.MAX_SAMPLES);
    }
    this.emit();
  }

  pushBufferSample(sample: BufferSample) {
    this._bufferSamples.push(sample);
    if (this._bufferSamples.length > MetricsCollector.MAX_SAMPLES) {
      this._bufferSamples = this._bufferSamples.slice(-MetricsCollector.MAX_SAMPLES);
    }
    this.emit();
  }

  pushCacheEvent(hit: boolean, _key: string) {
    if (hit) this._cacheHits++;
    else this._cacheMisses++;
    this._totalCacheEvents++;
    if (this._totalCacheEvents > MetricsCollector.MAX_SAMPLES * 10) {
      // Downsample old events — keep ratios, discard individual events
      const factor = 10;
      this._cacheHits = Math.round(this._cacheHits / factor);
      this._cacheMisses = Math.round(this._cacheMisses / factor);
      this._totalCacheEvents = Math.round(this._totalCacheEvents / factor);
    }
    this.emit();
  }

  pushFailedRequest(sample: FailedRequest) {
    this._failedRequests.push(sample);
    if (this._failedRequests.length > MetricsCollector.MAX_FAILURES) {
      this._failedRequests = this._failedRequests.slice(-MetricsCollector.MAX_FAILURES);
    }
    this.emit();
  }

  pushDownloadSpeed(sample: DownloadSpeedSample) {
    this._downloadSpeedSamples.push(sample);
    if (this._downloadSpeedSamples.length > MetricsCollector.MAX_SAMPLES) {
      this._downloadSpeedSamples = this._downloadSpeedSamples.slice(-MetricsCollector.MAX_SAMPLES);
    }
    this.emit();
  }

  // ---- Snapshot ----

  getSnapshot(): MetricsSnapshot {
    const mem = this.getMemoryUsageMB();
    const totalCache = this._cacheHits + this._cacheMisses;
    return {
      startupTimeMs: this._startupTimeMs,
      apiLatencies: this._apiLatencies,
      searchLatencies: this._searchLatencies,
      streamLatencies: this._streamLatencies,
      bufferSamples: this._bufferSamples,
      memoryUsageMB: mem,
      cacheHits: this._cacheHits,
      cacheMisses: this._cacheMisses,
      cacheHitRate: totalCache > 0 ? (this._cacheHits / totalCache) * 100 : 0,
      failedRequests: this._failedRequests,
      downloadSpeedSamples: this._downloadSpeedSamples,
      totalApiCalls: this._totalApiCalls,
      totalCacheEvents: this._totalCacheEvents,
    };
  }

  // ---- Subscription (for useSyncExternalStore) ----

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getServerSnapshot(): MetricsSnapshot {
    return this.getSnapshot();
  }

  // ---- Helpers ----

  private emit() {
    for (const l of this.listeners) l();
  }

  private getMemoryUsageMB(): number {
    if ('memory' in performance) {
      const m = (performance as any).memory;
      return Math.round(m.usedJSHeapSize / (1024 * 1024));
    }
    return 0;
  }

  clear() {
    this._apiLatencies = [];
    this._searchLatencies = [];
    this._streamLatencies = [];
    this._bufferSamples = [];
    this._failedRequests = [];
    this._downloadSpeedSamples = [];
    this._cacheHits = 0;
    this._cacheMisses = 0;
    this._totalCacheEvents = 0;
    this._totalApiCalls = 0;
    this.emit();
  }
}

export const metricsCollector = new MetricsCollector();
