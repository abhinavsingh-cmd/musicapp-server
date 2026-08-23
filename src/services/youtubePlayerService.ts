import { Song } from '../types/music';

type YTPlayerEventType = 'play' | 'pause' | 'ended' | 'progress' | 'error' | 'waiting' | 'ready';
type YTPlayerEventHandler = (event: YTPlayerEventType, data?: any) => void;

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

function log(...args: any[]) {
  if (import.meta.env.DEV) console.log('[YouTubePlayer]', ...args);
}

function logWarn(...args: any[]) {
  if (import.meta.env.DEV) console.warn('[YouTubePlayer]', ...args);
}

function logError(...args: any[]) {
  if (import.meta.env.DEV) console.error('[YouTubePlayer]', ...args);
}

class YouTubePlayerService {
  private player: any = null;
  private containerEl: HTMLDivElement | null = null;
  private listeners = new Set<YTPlayerEventHandler>();
  private currentSongId: string | null = null;
  private volume = 0.7;
  private currentLoadSong: Song | null = null;

  // API loading state
  private _apiLoadingStarted = false;
  private isReady = false;
  private loadTimedOut = false;

  // Ready promise — resets on failure so next initialize() can retry
  private readyPromise: Promise<boolean> | null = null;
  private readyResolver: ((value: boolean) => void) | null = null;

  // Player-ready promise — resolves when the YT.Player instance fires onReady
  private playerReadyPromise: Promise<void> | null = null;
  private playerReadyResolver: (() => void) | null = null;

  // Retry config (audioService handles outer retries, these are internal)
  private retryCount = 0;
  private maxRetries = 3;
  // Pending internal-retry timer. Tracked so stop()/load()/destroy() can
  // cancel it — a stale retry must never restart a video for a session that
  // has already moved on.
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  // Stream cache — tracks confirmed working youtubeIds for fast replay
  private streamCache = new Set<string>();

  // Init attempts
  private initAttempts = 0;
  private maxInitAttempts = 5;
  private initPromise: Promise<void> | null = null;

  constructor() {
    // DEFERRED: Don't load YouTube API on import — only on first play.
  }

  // ── API Loading ──────────────────────────────────────────

  private ensureAPI(): void {
    if (this._apiLoadingStarted && this.isReady) return;
    if (!this._apiLoadingStarted) {
      this._apiLoadingStarted = true;
      this.loadAPI();
    }
  }

  private loadAPI(): void {
    if (window.YT && window.YT.Player) {
      this.isReady = true;
      this.readyResolver?.(true);
      return;
    }

    if (typeof document === 'undefined' || !document.head) {
      logWarn('document not ready, deferring YouTube API load');
      setTimeout(() => this.loadAPI(), 1000);
      return;
    }

    // Check if another script already added the tag (e.g. preloadService in past)
    const existing = document.querySelector('script[src*="youtube.com/iframe_api"]');
    if (existing) {
      log('YouTube IFrame API script already present, waiting for YT.Player');
      this.waitForYTPlayer();
      return;
    }

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.onerror = () => {
      logError('Failed to load YouTube IFrame API script');
      this.loadTimedOut = true;
      this.readyResolver?.(false);
    };

    const timeout = setTimeout(() => {
      if (!this.isReady) {
        logWarn('YouTube IFrame API load timed out after 10s');
        this.loadTimedOut = true;
        this.readyResolver?.(false);
      }
    }, 10000);

    tag.onload = () => {
      this.waitForYTPlayer(timeout);
    };
    document.head.appendChild(tag);
  }

  private waitForYTPlayer(existingTimeout?: ReturnType<typeof setTimeout>): void {
    const timeout = existingTimeout || setTimeout(() => {
      if (!this.isReady) {
        logWarn('YouTube IFrame API initialization timed out');
        this.loadTimedOut = true;
        this.readyResolver?.(false);
      }
    }, 10000);

    const check = setInterval(() => {
      if (window.YT && window.YT.Player) {
        clearInterval(check);
        clearTimeout(timeout);
        this.isReady = true;
        log('YouTube IFrame API ready');
        this.readyResolver?.(true);
      }
    }, 100);
  }

  // ── Container ────────────────────────────────────────────

  private ensureContainer(): HTMLDivElement {
    if (!this.containerEl) {
      if (!document.body) {
        throw new Error('document.body not ready');
      }
      this.containerEl = document.createElement('div');
      this.containerEl.id = 'yt-player-container';
      this.containerEl.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-9999;overflow:hidden;';
      document.body.appendChild(this.containerEl);
    }
    return this.containerEl;
  }

  // ── Initialize ───────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.player) {
      log('initialize() — player already exists, returning');
      return;
    }

    // Mutex: if a call is in progress, return the existing promise
    if (this.initPromise) {
      log('initialize() — init already in progress, waiting');
      return this.initPromise;
    }

    this.initPromise = this._doInitialize();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async _doInitialize(): Promise<void> {
    this.initAttempts++;
    if (this.initAttempts > this.maxInitAttempts) {
      logError('initialize() — max init attempts exceeded');
      throw new Error('YouTube player failed to initialize after max attempts');
    }

    // Reset state for a fresh attempt
    this.loadTimedOut = false;
    this.isReady = false;
    this.readyPromise = new Promise<boolean>((resolve) => {
      this.readyResolver = resolve;
    });

    this.ensureAPI();
    await this.readyPromise;

    if (this.loadTimedOut || !window.YT || !window.YT.Player) {
      logError('initialize() — YouTube IFrame API FAILED to load');
      throw new Error('YouTube IFrame API failed to load');
    }

    const container = this.ensureContainer();
    // On Capacitor, page origin is https://localhost but YouTube needs a valid
    // origin for CORS. Use the actual origin — it works with YouTube embeds.
    const origin = window.location.origin || 'https://localhost';

    // Create player-ready promise BEFORE constructing the player
    this.playerReadyPromise = new Promise<void>((resolve) => {
      this.playerReadyResolver = resolve;
    });

    this.player = new window.YT.Player(container, {
      height: '1',
      width: '1',
      playerVars: {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        fs: 0,
        iv_load_policy: 3,
        modestbranding: 1,
        rel: 0,
        showinfo: 0,
        origin,
      },
      events: {
        onReady: () => {
          log('✓ YouTube player instance onReady fired');
          this.playerReadyResolver?.();
        },
        onStateChange: (e: any) => this.handleStateChange(e),
        onError: (e: any) => this.handleError(e),
      },
    });

    log('YouTube player instance created');

    // Wait for the player to actually be ready before returning
    const readyTimeout = new Promise<boolean>((resolve) => {
      setTimeout(() => {
        if (this.player && typeof this.player.getPlayerState === 'function') {
          resolve(true);
        } else {
          resolve(false);
        }
      }, 3000);
    });

    await Promise.race([this.playerReadyPromise, readyTimeout]);
    log('initialize() — player fully ready');
  }

  // ── State Handling ───────────────────────────────────────

  private handleStateChange(e: any): void {
    const YT = window.YT;
    if (!YT) return;

    const stateNames: Record<number, string> = {
      [-1]: 'UNSTARTED',
      [0]: 'ENDED',
      [1]: 'PLAYING',
      [2]: 'PAUSED',
      [3]: 'BUFFERING',
      [5]: 'VIDEO_CUED',
    };
    const stateName = stateNames[e.data] || `UNKNOWN(${e.data})`;
    log('STATE CHANGE:', stateName);

    switch (e.data) {
      case YT.PlayerState.PLAYING:
        this.emit('play');
        break;
      case YT.PlayerState.PAUSED:
        this.emit('pause');
        break;
      case YT.PlayerState.ENDED:
        this.emit('ended');
        break;
      case YT.PlayerState.BUFFERING:
        this.emit('waiting');
        break;
    }
  }

  private handleError(e: any): void {
    const errorCode = e.data;
    logError('Error code:', errorCode);

    const errorMessages: Record<number, string> = {
      2: 'Invalid video ID',
      5: 'HTML5 player error',
      100: 'Video not found or removed',
      101: 'Video not embeddable',
      103: 'Cannot embed this video',
      150: 'Video not available in your region',
    };
    const message = errorMessages[errorCode] || `Playback error (${errorCode})`;

    // Retry on transient errors (2 = invalid params could be timing, 5 = html5 error)
    if ((errorCode === 2 || errorCode === 5) && this.retryCount < this.maxRetries && this.currentLoadSong) {
      this.retryCount++;
      // Bounded exponential backoff with jitter
      const BASE_RETRY_DELAY_MS = 1_000;
      const MAX_RETRY_DELAY_MS = 10_000;
      const delay = Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, this.retryCount - 1), MAX_RETRY_DELAY_MS);
      const jitter = Math.random() * 500;
      log(`Retryable error ${errorCode}, retrying... attempt ${this.retryCount}/${this.maxRetries} in ${Math.round(delay + jitter)}ms`);
      // Capture the identity of the session that FAILED — the timer must only
      // ever retry THIS video. Reading currentLoadSong at fire time could
      // restart a NEWER track from 0 (stale promise/timer race).
      const retrySongId = this.currentSongId;
      const retryYtId = this.currentLoadSong.youtubeId;
      this.cancelRetryTimer();
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        if (this.currentSongId !== retrySongId || retrySongId === null) return; // superseded
        if (this.player && this.player.loadVideoById) {
          try {
            this.player.loadVideoById(retryYtId);
          } catch (err) {
            logError('Retry loadVideoById failed:', err);
            this.emit('error', message);
          }
        }
      }, delay + jitter);
      return;
    }

    this.emit('error', message);
  }

  private cancelRetryTimer(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  // ── Load / Play / Pause ──────────────────────────────────

  async load(song: Song): Promise<void> {
    log('▶ load() — calling initialize()...');
    await this.initialize();

    if (!song.youtubeId) throw new Error('No YouTube ID');

    // A new load supersedes any pending internal retry of the previous video.
    this.cancelRetryTimer();
    this.currentSongId = song.id;
    this.currentLoadSong = song;
    this.retryCount = 0;

    log('load() — loadVideoById:', { youtubeId: song.youtubeId, title: song.title });

    if (this.player && this.player.loadVideoById) {
      try {
        this.player.loadVideoById(song.youtubeId);
      } catch (err) {
        logError('loadVideoById FAILED:', err);
        throw Object.assign(new Error('Failed to load YouTube video'), { cause: err });
      }
    } else {
      throw new Error('YouTube player not initialized');
    }

    try { this.player.setVolume(this.volume * 100); } catch (e) { logError('setVolume FAILED:', e); }
  }

  async play(): Promise<void> {
    if (!this.player || !this.player.playVideo) {
      await this.initialize();
    }

    if (this.player && this.player.playVideo) {
      try {
        this.player.playVideo();
      } catch (e) {
        logError('playVideo() FAILED:', e);
      }
    }
  }

  pause(): void {
    if (this.player && this.player.pauseVideo) {
      try { this.player.pauseVideo(); } catch (e) { logError('pauseVideo() FAILED:', e); }
    }
  }

  seek(seconds: number): void {
    if (this.player && this.player.seekTo) {
      try { this.player.seekTo(seconds, true); } catch (e) { logError('Seek error:', e); }
    }
  }

  setVolume(vol: number): void {
    this.volume = vol;
    if (this.player && this.player.setVolume) {
      try { this.player.setVolume(vol * 100); } catch (e) { logError('setVolume FAILED:', e); }
    }
  }

  getCurrentTime(): number {
    if (this.player && this.player.getCurrentTime) {
      try { return this.player.getCurrentTime() || 0; } catch { return 0; }
    }
    return 0;
  }

  getDuration(): number {
    if (this.player && this.player.getDuration) {
      try { return this.player.getDuration() || 0; } catch { return 0; }
    }
    return 0;
  }

  getIsPlaying(): boolean {
    if (this.player && this.player.getPlayerState) {
      return this.player.getPlayerState() === window.YT?.PlayerState?.PLAYING;
    }
    return false;
  }

  stop(): void {
    this.cancelRetryTimer();
    if (this.player && this.player.stopVideo) {
      try { this.player.stopVideo(); } catch (e) { logError('stopVideo() FAILED:', e); }
    }
    this.currentSongId = null;
    this.currentLoadSong = null;
  }

  destroy(): void {
    this.stop();
    this.listeners.clear();
    if (this.containerEl) {
      this.containerEl.remove();
      this.containerEl = null;
    }
    this.player = null;
    this.initAttempts = 0;
    this.isReady = false;
    this._apiLoadingStarted = false;
    this.loadTimedOut = false;
    this.readyPromise = null;
    this.readyResolver = null;
    this.playerReadyPromise = null;
    this.playerReadyResolver = null;
    this.initPromise = null;
  }

  getCurrentSongId(): string | null {
    return this.currentSongId;
  }

  // ── Stream Cache ─────────────────────────────────────────

  markStreamWorking(youtubeId: string): void {
    this.streamCache.add(youtubeId);
  }

  isStreamCached(youtubeId: string): boolean {
    return this.streamCache.has(youtubeId);
  }

  // ── Subscribe / Emit ─────────────────────────────────────

  subscribe(callback: YTPlayerEventHandler): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private emit(event: YTPlayerEventType, data?: any): void {
    this.listeners.forEach(cb => {
      try { cb(event, data); } catch (e) { logError('Listener error:', e); }
    });
  }
}

export const youtubePlayerService = new YouTubePlayerService();
