/**
 * Playback Latency Tracker
 *
 * Logs a detailed tap-to-play breakdown for every song:
 *   - Total latency (tap → audio playing)
 *   - Source resolution time (provider extract)
 *   - Server stream time (first byte received)
 *   - Source type (memory cache / disk cache / cold / preloaded)
 *   - Whether it was a retry or fresh play
 *
 * Keeps a rolling history of the last 50 plays for the DevPage.
 */

export interface PlayLatencyRecord {
  songId: string;
  songTitle: string;
  artist: string;
  /** performance.now() when play() was called */
  tapTime: number;
  /** ms to resolve the stream URL from provider */
  sourceResolveMs: number;
  /** ms from tap to first audio playing event */
  totalLatencyMs: number;
  /** 'memory' | 'disk' | 'cold' | 'preloaded' | 'local' */
  cacheStatus: 'memory' | 'disk' | 'cold' | 'preloaded' | 'local';
  /** 'stream' | 'direct' | 'iframe' | 'native' */
  sourceType: string;
  /** Whether this was a recovery/retry attempt */
  isRetry: boolean;
  /** Timestamp */
  timestamp: number;
  /** Server-side cache hint from URL pattern */
  serverCacheHint: string;
}

const MAX_RECORDS = 50;

class PlaybackLatencyTracker {
  private records: PlayLatencyRecord[] = [];
  private sessionTapTime = 0;
  private sessionSourceResolveMs = 0;

  /** Mark the moment the user tapped play. */
  startTap(): void {
    this.sessionTapTime = performance.now();
    this.sessionSourceResolveMs = 0;
  }

  /** Record how long source resolution took. */
  markSourceResolved(ms: number): void {
    this.sessionSourceResolveMs = ms;
  }

  /**
   * Record a completed play with full latency data.
   * Called from handlePlaying / pollNativeState when audio starts.
   */
  recordPlay(opts: {
    songId: string;
    songTitle: string;
    artist: string;
    totalLatencyMs: number;
    sourceType: string;
    isRetry: boolean;
    serverUrl?: string;
  }): PlayLatencyRecord {
    const cacheStatus = this.inferCacheStatus(opts.serverUrl || '', opts.totalLatencyMs);
    const record: PlayLatencyRecord = {
      songId: opts.songId,
      songTitle: opts.songTitle,
      artist: opts.artist,
      tapTime: this.sessionTapTime,
      sourceResolveMs: this.sessionSourceResolveMs,
      totalLatencyMs: opts.totalLatencyMs,
      cacheStatus,
      sourceType: opts.sourceType,
      isRetry: opts.isRetry,
      timestamp: Date.now(),
      serverCacheHint: opts.serverUrl || '',
    };

    this.records.push(record);
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(-MAX_RECORDS);
    }

    this.logRecord(record);
    return record;
  }

  /** Record a failed play attempt. */
  recordFailure(opts: {
    songId: string;
    songTitle: string;
    artist: string;
    reason: string;
    serverUrl?: string;
  }): void {
    const totalMs = this.sessionTapTime > 0
      ? Math.round(performance.now() - this.sessionTapTime)
      : 0;

    console.log(
      `[Playback] ❌ FAILED — ${totalMs}ms (${(totalMs / 1000).toFixed(1)}s) ` +
      `song="${opts.songTitle}" artist="${opts.artist}" reason="${opts.reason}"`
    );
  }

  /** Get rolling history for DevPage. */
  getRecords(): readonly PlayLatencyRecord[] {
    return this.records;
  }

  /** Get aggregate stats. */
  getStats(): {
    totalPlays: number;
    avgLatencyMs: number;
    p50Ms: number;
    p95Ms: number;
    cacheHits: number;
    cacheMisses: number;
    cacheHitRate: number;
  } {
    if (this.records.length === 0) {
      return { totalPlays: 0, avgLatencyMs: 0, p50Ms: 0, p95Ms: 0, cacheHits: 0, cacheMisses: 0, cacheHitRate: 0 };
    }

    const sorted = [...this.records].sort((a, b) => a.totalLatencyMs - b.totalLatencyMs);
    const total = sorted.reduce((s, r) => s + r.totalLatencyMs, 0);
    const cacheHits = this.records.filter(r => r.cacheStatus === 'memory' || r.cacheStatus === 'disk' || r.cacheStatus === 'preloaded').length;

    return {
      totalPlays: this.records.length,
      avgLatencyMs: Math.round(total / this.records.length),
      p50Ms: sorted[Math.floor(sorted.length * 0.5)]?.totalLatencyMs || 0,
      p95Ms: sorted[Math.floor(sorted.length * 0.95)]?.totalLatencyMs || 0,
      cacheHits,
      cacheMisses: this.records.length - cacheHits,
      cacheHitRate: this.records.length > 0 ? Math.round((cacheHits / this.records.length) * 100) : 0,
    };
  }

  clear(): void {
    this.records = [];
  }

  // ── Private ──

  private inferCacheStatus(url: string, totalMs: number): PlayLatencyRecord['cacheStatus'] {
    if (url.includes('file://') || url.startsWith('blob:')) return 'local';
    // Very fast = likely from memory cache (<500ms)
    if (totalMs < 500) return 'memory';
    // Fast = likely disk cache (<2s)
    if (totalMs < 2000) return 'disk';
    return 'cold';
  }

  private logRecord(r: PlayLatencyRecord): void {
    const latencyStr = r.totalLatencyMs >= 1000
      ? `${(r.totalLatencyMs / 1000).toFixed(1)}s`
      : `${r.totalLatencyMs}ms`;

    const resolveStr = r.sourceResolveMs > 0
      ? `resolve=${r.sourceResolveMs}ms`
      : '';

    const tag = r.isRetry ? '🔄 RETRY' : '✅ PLAYING';
    const cacheTag = r.cacheStatus.toUpperCase();

    console.log(
      `[Playback] ${tag} — ${latencyStr} ` +
      `[${cacheTag}] ` +
      `song="${r.songTitle}" ` +
      `artist="${r.artist}" ` +
      `${resolveStr} ` +
      `source=${r.sourceType}`
    );

    // Summary line for quick scanning
    const bar = r.totalLatencyMs < 500 ? '🟢'
      : r.totalLatencyMs < 2000 ? '🟡'
      : r.totalLatencyMs < 5000 ? '🟠'
      : '🔴';

    console.log(
      `  ${bar} Latency: ${latencyStr} | Cache: ${cacheTag} | Source: ${r.sourceType} | Resolve: ${r.sourceResolveMs}ms`
    );
  }
}

export const playbackLatencyTracker = new PlaybackLatencyTracker();
