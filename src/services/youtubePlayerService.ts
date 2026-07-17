import { Song } from '../types/music';

type YTPlayerEventType = 'play' | 'pause' | 'ended' | 'progress' | 'error' | 'timeupdate' | 'ready';
type YTPlayerEventHandler = (event: YTPlayerEventType, data?: any) => void;

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

class YouTubePlayerService {
  private player: any = null;
  private containerEl: HTMLDivElement | null = null;
  private listeners = new Set<YTPlayerEventHandler>();
  private ready = false;
  private readyPromise: Promise<void>;
  private readyResolver: (() => void) | null = null;
  private progressInterval: number | null = null;
  private currentSongId: string | null = null;
  private volume = 0.7;
  private hasInteracted = false;
  private muted = true;

  constructor() {
    this.readyPromise = new Promise((resolve) => {
      this.readyResolver = resolve;
    });
    this.loadAPI();
  }

  private loadAPI(): void {
    if (window.YT && window.YT.Player) {
      this.ready = true;
      this.readyResolver?.();
      return;
    }

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.onload = () => {
      const check = setInterval(() => {
        if (window.YT && window.YT.Player) {
          clearInterval(check);
          this.ready = true;
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
        onReady: () => {},
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
        this.muted = false;
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
    console.error('[YouTubePlayer] Error:', e.data);
    this.emit('error', `YouTube player error: ${e.data}`);
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
      try { cb(event, data); } catch (e) { console.error('[YouTubePlayer] Listener error:', e); }
    });
  }

  async load(song: Song): Promise<void> {
    await this.initialize();

    if (!song.youtubeId) throw new Error('No YouTube ID');

    this.currentSongId = song.id;

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
        console.error('[YouTubePlayer] Play error:', e);
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
