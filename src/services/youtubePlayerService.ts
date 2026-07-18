import { Song } from '../types/music';

type YTPlayerEventType = 'play' | 'pause' | 'ended' | 'progress' | 'error' | 'timeupdate' | 'ready';
type YTPlayerEventHandler = (event: YTPlayerEventType, data?: any) => void;

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

function log(...args: any[]) {
  console.log('[YouTubePlayer]', ...args);
}

function logError(...args: any[]) {
  console.error('[YouTubePlayer]', ...args);
}

class YouTubePlayerService {
  private player: any = null;
  private containerEl: HTMLDivElement | null = null;
  private listeners = new Set<YTPlayerEventHandler>();
  private readyPromise: Promise<void>;
  private readyResolver: (() => void) | null = null;
  private progressInterval: number | null = null;
  private currentSongId: string | null = null;
  private volume = 0.7;
  private retryCount = 0;
  private maxRetries = 1;
  private currentLoadSong: Song | null = null;

  constructor() {
    this.readyPromise = new Promise((resolve) => {
      this.readyResolver = resolve;
    });
    this.loadAPI();
  }

  private loadAPI(): void {
    if (window.YT && window.YT.Player) {
      this.readyResolver?.();
      return;
    }

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.onload = () => {
      const check = setInterval(() => {
        if (window.YT && window.YT.Player) {
          clearInterval(check);
          this.readyResolver?.();
        }
      }, 100);
    };
    document.head.appendChild(tag);
  }

  private ensureContainer(): HTMLDivElement {
    if (!this.containerEl) {
      this.containerEl = document.createElement('div');
      this.containerEl.id = 'yt-player-container';
      this.containerEl.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;';
      document.body.appendChild(this.containerEl);
    }
    return this.containerEl;
  }

  async initialize(): Promise<void> {
    if (this.player) return;
    await this.readyPromise;

    const container = this.ensureContainer();

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
        origin: window.location.origin,
      },
      events: {
        onReady: () => { log('YouTube player ready'); },
        onStateChange: (e: any) => this.handleStateChange(e),
        onError: (e: any) => this.handleError(e),
      },
    });
  }

  private handleStateChange(e: any): void {
    const YT = window.YT;
    if (!YT) return;

    switch (e.data) {
      case YT.PlayerState.PLAYING:
        this.startProgressTracking();
        this.emit('play');
        break;
      case YT.PlayerState.PAUSED:
        this.stopProgressTracking();
        this.emit('pause');
        break;
      case YT.PlayerState.ENDED:
        this.stopProgressTracking();
        this.emit('ended');
        break;
      case YT.PlayerState.BUFFERING:
        this.emit('progress', this.getCurrentTime());
        break;
    }
  }

  private handleError(e: any): void {
    const errorCode = e.data;
    logError('Error code:', errorCode);
    
    // YouTube error codes:
    // 2 = invalid parameter
    // 5 = HTML5 player error
    // 100 = video not found (private, removed)
    // 101/150 = not embeddable
    // 150 = same as 101
    
    if (errorCode === 2 || errorCode === 5) {
      // Retryable errors - try reloading the video
      if (this.retryCount < this.maxRetries && this.currentLoadSong) {
        this.retryCount++;
        log('Retryable error, retrying... attempt', this.retryCount);
        setTimeout(() => {
          if (this.currentLoadSong && this.player && this.player.loadVideoById) {
            this.player.loadVideoById(this.currentLoadSong.youtubeId);
          }
        }, 1000);
        return;
      }
    }
    
    // Fatal errors (100, 150) or max retries exceeded - emit error for auto-skip
    this.emit('error', errorCode);
  }

  private startProgressTracking(): void {
    this.stopProgressTracking();
    this.progressInterval = window.setInterval(() => {
      if (this.player && this.player.getCurrentTime) {
        const time = this.player.getCurrentTime() || 0;
        this.emit('progress', time);
        this.emit('timeupdate', time);
      }
    }, 250);
  }

  private stopProgressTracking(): void {
    if (this.progressInterval !== null) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  subscribe(callback: YTPlayerEventHandler): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private emit(event: YTPlayerEventType, data?: any): void {
    this.listeners.forEach(cb => {
      try { cb(event, data); } catch (e) { logError('Listener error:', e); }
    });
  }

  async load(song: Song): Promise<void> {
    await this.initialize();

    if (!song.youtubeId) throw new Error('No YouTube ID');

    log('Loading video:', song.youtubeId, song.title);
    this.currentSongId = song.id;
    this.currentLoadSong = song;
    this.retryCount = 0;

    if (this.player.loadVideoById) {
      this.player.loadVideoById(song.youtubeId);
    }

    this.player.setVolume(this.volume * 100);
  }

  async play(): Promise<void> {
    if (!this.player || !this.player.playVideo) {
      await this.initialize();
    }

    if (this.player && this.player.playVideo) {
      try {
        this.player.playVideo();
      } catch (e) {
        logError('Play error:', e);
      }
    }
  }

  pause(): void {
    if (this.player && this.player.pauseVideo) {
      this.player.pauseVideo();
    }
  }

  seek(seconds: number): void {
    if (this.player && this.player.seekTo) {
      this.player.seekTo(seconds, true);
    }
  }

  setVolume(vol: number): void {
    this.volume = vol;
    if (this.player && this.player.setVolume) {
      this.player.setVolume(vol * 100);
    }
  }

  getCurrentTime(): number {
    if (this.player && this.player.getCurrentTime) {
      return this.player.getCurrentTime() || 0;
    }
    return 0;
  }

  getDuration(): number {
    if (this.player && this.player.getDuration) {
      return this.player.getDuration() || 0;
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
    this.stopProgressTracking();
    if (this.player && this.player.stopVideo) {
      this.player.stopVideo();
    }
    this.currentSongId = null;
    this.currentLoadSong = null;
  }

  destroy(): void {
    this.stopProgressTracking();
    this.stop();
    this.listeners.clear();
    if (this.containerEl) {
      this.containerEl.remove();
      this.containerEl = null;
    }
    this.player = null;
  }

  getCurrentSongId(): string | null {
    return this.currentSongId;
  }
}

export const youtubePlayerService = new YouTubePlayerService();
