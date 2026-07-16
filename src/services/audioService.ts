import { Song } from '../types/music';
import { backgroundPlaybackService } from './backgroundPlaybackService';
import { equalizerService } from './equalizerService';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

let ytScriptLoaded = false;
let ytApiReady = false;
const ytReadyCallbacks: Array<() => void> = [];

function loadYTScript(): Promise<void> {
  return new Promise((resolve) => {
    if (ytApiReady) { resolve(); return; }
    if (ytScriptLoaded) { ytReadyCallbacks.push(resolve); return; }
    ytScriptLoaded = true;
    ytReadyCallbacks.push(resolve);

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);

    window.onYouTubeIframeAPIReady = () => {
      ytApiReady = true;
      ytReadyCallbacks.forEach(cb => cb());
      ytReadyCallbacks.length = 0;
    };
  });
}

function isBlobUrl(url: string): boolean {
  return url.startsWith('blob:');
}

type PlaybackMode = 'youtube' | 'offline';

interface AudioState {
  currentSong: Song | null;
  isPlaying: boolean;
  duration: number;
  currentTime: number;
  volume: number;
  playbackMode: PlaybackMode;
  isLoading: boolean;
  error: string | null;
}

type AudioEventType = 'play' | 'pause' | 'ended' | 'progress' | 'loaded' | 'error' | 'timeupdate' | 'waiting' | 'canplay' | 'playing';

type AudioEventHandler = (event: AudioEventType, data?: any) => void;

export class AudioService {
  private player: any = null;
  private playerDiv: HTMLDivElement | null = null;
  private htmlAudio: HTMLAudioElement | null = null;
  
  private state: AudioState = {
    currentSong: null,
    isPlaying: false,
    duration: 0,
    currentTime: 0,
    volume: 0.7,
    playbackMode: 'youtube',
    isLoading: false,
    error: null,
  };

  private listeners = new Set<AudioEventHandler>();
  private pendingPlayPromise: Promise<void> | null = null;
  private playbackTransitionLock = false;
  private currentPlaybackId = 0;
  private progressInterval: ReturnType<typeof setInterval> | null = null;
  private loadTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastProgressNotify = 0;
  private retryCount = 0;
  private maxRetries = 3;
  private abortController: AbortController | null = null;
  private isDestroyed = false;

  private ensurePlayerDiv(): HTMLDivElement {
    if (!this.playerDiv) {
      this.playerDiv = document.getElementById('yt-player-container') as HTMLDivElement;
    }
    return this.playerDiv!;
  }

  private getHtmlAudio(): HTMLAudioElement {
    if (!this.htmlAudio) {
      this.htmlAudio = new Audio();
      this.htmlAudio.preload = 'auto';
      backgroundPlaybackService.registerAudioElement(this.htmlAudio);
      this.attachHtmlAudioListeners();
      equalizerService.init(this.htmlAudio);
    }
    return this.htmlAudio;
  }

  private attachHtmlAudioListeners(): void {
    if (!this.htmlAudio) return;
    
    this.htmlAudio.addEventListener('ended', this.handleEnded);
    this.htmlAudio.addEventListener('timeupdate', this.handleTimeUpdate);
    this.htmlAudio.addEventListener('error', this.handleError);
    this.htmlAudio.addEventListener('waiting', this.handleWaiting);
    this.htmlAudio.addEventListener('canplay', this.handleCanPlay);
    this.htmlAudio.addEventListener('playing', this.handlePlaying);
    this.htmlAudio.addEventListener('pause', this.handlePause);
    this.htmlAudio.addEventListener('loadedmetadata', this.handleLoadedMetadata);
  }

  private detachHtmlAudioListeners(): void {
    if (!this.htmlAudio) return;
    
    this.htmlAudio.removeEventListener('ended', this.handleEnded);
    this.htmlAudio.removeEventListener('timeupdate', this.handleTimeUpdate);
    this.htmlAudio.removeEventListener('error', this.handleError);
    this.htmlAudio.removeEventListener('waiting', this.handleWaiting);
    this.htmlAudio.removeEventListener('canplay', this.handleCanPlay);
    this.htmlAudio.removeEventListener('playing', this.handlePlaying);
    this.htmlAudio.removeEventListener('pause', this.handlePause);
    this.htmlAudio.removeEventListener('loadedmetadata', this.handleLoadedMetadata);
  }

  private handleEnded = (): void => {
    this.setState({ isPlaying: false, currentTime: 0 });
    this.stopProgressTracking();
    this.emit('ended');
  };

  private handleTimeUpdate = (): void => {
    if (!this.htmlAudio) return;
    this.state.currentTime = this.htmlAudio.currentTime || 0;
    this.state.duration = this.htmlAudio.duration || this.state.duration;
    const now = Date.now();
    if (now - this.lastProgressNotify >= 500) {
      this.lastProgressNotify = now;
      this.emit('progress', this.state.currentTime);
      this.emit('timeupdate', this.state.currentTime);
    }
  };

  private handleError = (): void => {
    const error = this.htmlAudio?.error;
    const message = error?.message || 'Playback error';
    this.setState({ error: message, isLoading: false, isPlaying: false });
    this.emit('error', message);
  };

  private handleWaiting = (): void => {
    this.emit('waiting');
  };

  private handleCanPlay = (): void => {
    this.emit('canplay');
  };

  private handlePlaying = (): void => {
    if (!this.state.isPlaying) {
      this.setState({ isPlaying: true, isLoading: false, error: null });
      this.startProgressTracking();
      this.emit('playing');
    }
    this.emit('play', { song: this.state.currentSong });
  };

  private handlePause = (): void => {
    if (this.state.isPlaying) {
      this.setState({ isPlaying: false });
      this.stopProgressTracking();
      this.emit('pause');
    }
  };

  private handleLoadedMetadata = (): void => {
    if (this.htmlAudio) {
      this.state.duration = this.htmlAudio.duration || this.state.duration;
      this.emit('loaded', { song: this.state.currentSong });
    }
  };

  private setState(partial: Partial<AudioState>): void {
    this.state = { ...this.state, ...partial };
  }

  private emit(event: AudioEventType, data?: any): void {
    if (this.isDestroyed) return;
    this.listeners.forEach(cb => {
      try { cb(event, data); } catch (e) { console.error('Audio listener error:', e); }
    });
  }

  subscribe(callback: AudioEventHandler): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  getState(): Readonly<AudioState> {
    return this.state;
  }

  async play(song: Song, playlist: Song[] = [], startIndex: number = 0): Promise<void> {
    if (this.isDestroyed) return;
    
    const playbackId = ++this.currentPlaybackId;
    
    while (this.playbackTransitionLock) {
      await new Promise(r => setTimeout(r, 10));
      if (this.isDestroyed || this.currentPlaybackId !== playbackId) return;
    }
    
    if (this.isDestroyed || this.currentPlaybackId !== playbackId) return;
    
    this.playbackTransitionLock = true;
    
    try {
      this.abortController?.abort();
      this.abortController = new AbortController();
      
      this.clearAllTimers();
      this.stopCurrentPlayback();
      
      this.retryCount = 0;
      this.setState({ 
        currentSong: song, 
        isLoading: true, 
        error: null, 
        duration: song.duration, 
        currentTime: 0,
        isPlaying: false 
      });
      
      this.emit('loaded', { song, playlist, index: startIndex });
      
      if (song.audioUrl && isBlobUrl(song.audioUrl)) {
        await this.playOffline(song, playlist, startIndex, playbackId);
      } else {
        await this.playYoutube(song, playlist, startIndex, playbackId);
      }
    } catch (error) {
      if (!this.isDestroyed && this.currentPlaybackId === playbackId) {
        const message = error instanceof Error ? error.message : 'Playback failed';
        this.setState({ error: message, isLoading: false, isPlaying: false });
        this.emit('error', message);
      }
    } finally {
      if (this.currentPlaybackId === playbackId) {
        this.playbackTransitionLock = false;
      }
    }
  }

  private async playOffline(song: Song, playlist: Song[], startIndex: number, playbackId: number): Promise<void> {
    this.setState({ playbackMode: 'offline' });
    this.stopYtPlayer();
    
    const audio = this.getHtmlAudio();
    
    if (audio.src !== song.audioUrl) {
      audio.src = song.audioUrl;
      audio.load();
    }
    
    audio.volume = this.state.volume;
    
    this.pendingPlayPromise = audio.play();
    
    try {
      await this.pendingPlayPromise;
      
      if (this.isDestroyed || this.currentPlaybackId !== playbackId) return;
      
      this.setState({ isPlaying: true, isLoading: false });
      this.startProgressTracking();
      this.emit('play', { song, playlist, index: startIndex });
    } catch (error) {
      if (this.isDestroyed || this.currentPlaybackId !== playbackId) return;
      
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        await new Promise(r => setTimeout(r, 500));
        return this.playOffline(song, playlist, startIndex, playbackId);
      }
      
      this.setState({ isLoading: false, isPlaying: false });
      this.emit('error', 'Failed to play downloaded song');
    } finally {
      this.pendingPlayPromise = null;
    }
  }

  private async playYoutube(song: Song, playlist: Song[], startIndex: number, playbackId: number): Promise<void> {
    this.setState({ playbackMode: 'youtube' });
    this.stopHtmlAudio();
    
    if (!song.youtubeId) {
      this.setState({ error: 'No YouTube ID for this song', isLoading: false });
      this.emit('error', 'No YouTube ID for this song');
      return;
    }
    
    await loadYTScript();
    this.ensurePlayerDiv();
    
    if (!this.player) {
      await this.createYtPlayer(song, playlist, startIndex, playbackId);
    } else {
      await this.loadYtVideo(song, playlist, startIndex, playbackId);
    }
  }

  private createYtPlayer(song: Song, playlist: Song[], startIndex: number, playbackId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isDestroyed || this.currentPlaybackId !== playbackId) {
        reject(new Error('Playback cancelled'));
        return;
      }
      
      this.player = new window.YT.Player(this.ensurePlayerDiv(), {
        height: '0',
        width: '0',
        playerVars: {
          autoplay: 1,
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
          onReady: () => {
            if (this.isDestroyed || this.currentPlaybackId !== playbackId) {
              reject(new Error('Playback cancelled'));
              return;
            }
            this.state.currentSong = song;
            this.state.duration = song.duration;
            this.player.loadVideoById(song.youtubeId);
            this.startProgressTracking();
            this.emit('play', { song, playlist, index: startIndex });
            resolve();
            
            this.loadTimeout = setTimeout(() => {
              if (this.state.currentTime < 1 && this.state.isPlaying) {
                this.retryLoad(song, playlist, startIndex);
              }
            }, 8000);
          },
          onStateChange: (event: any) => {
            if (this.loadTimeout) { clearTimeout(this.loadTimeout); this.loadTimeout = null; }
            
            if (this.isDestroyed || this.currentPlaybackId !== playbackId) return;
            
            if (event.data === window.YT.PlayerState.ENDED) {
              this.setState({ isPlaying: false, currentTime: 0 });
              this.stopProgressTracking();
              this.emit('ended');
            } else if (event.data === window.YT.PlayerState.PLAYING) {
              this.setState({ isPlaying: true, isLoading: false });
              this.retryCount = 0;
              this.startProgressTracking();
            } else if (event.data === window.YT.PlayerState.PAUSED) {
              this.setState({ isPlaying: false });
              this.stopProgressTracking();
            } else if (event.data === window.YT.PlayerState.BUFFERING) {
              this.setState({ isLoading: true });
            } else if (event.data === window.YT.PlayerState.CUED) {
              this.setState({ isLoading: false });
            }
          },
          onError: (event: any) => {
            console.error('YouTube player error:', event.data);
            if (this.loadTimeout) { clearTimeout(this.loadTimeout); this.loadTimeout = null; }
            if (this.isDestroyed || this.currentPlaybackId !== playbackId) return;
            this.retryLoad(song, playlist, startIndex);
          },
        },
      });
    });
  }

  private loadYtVideo(song: Song, playlist: Song[], startIndex: number, playbackId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isDestroyed || this.currentPlaybackId !== playbackId) {
        reject(new Error('Playback cancelled'));
        return;
      }
      
      this.state.currentSong = song;
      this.state.duration = song.duration;
      this.setState({ isLoading: true, currentTime: 0 });
      this.stopProgressTracking();
      
      this.player.loadVideoById(song.youtubeId);
      this.startProgressTracking();
      this.emit('play', { song, playlist, index: startIndex });
      
      this.loadTimeout = setTimeout(() => {
        if (this.state.currentTime < 1 && this.state.isPlaying) {
          this.retryLoad(song, playlist, startIndex);
        }
      }, 8000);
      
      resolve();
    });
  }

  private retryLoad(song: Song, playlist: Song[], startIndex: number): void {
    if (this.retryCount >= this.maxRetries) {
      this.setState({ error: `Cannot play "${song.title}"`, isLoading: false, isPlaying: false });
      this.emit('error', `Cannot play "${song.title}"`);
      this.emit('ended');
      return;
    }
    this.retryCount++;
    console.log(`Retrying ${song.title} (attempt ${this.retryCount}/${this.maxRetries})`);
    
    if (this.state.playbackMode === 'youtube' && this.player) {
      try {
        this.player.loadVideoById(song.youtubeId);
      } catch {
        this.stopYtPlayer();
        this.player = null;
        this.play(song, playlist, startIndex);
      }
    }
  }

  private stopCurrentPlayback(): void {
    this.stopProgressTracking();
    this.stopHtmlAudio();
    this.stopYtPlayer();
  }

  private stopHtmlAudio(): void {
    if (this.htmlAudio) {
      this.htmlAudio.pause();
      this.htmlAudio.currentTime = 0;
      this.htmlAudio.src = '';
    }
  }

  private stopYtPlayer(): void {
    if (this.loadTimeout) { 
      clearTimeout(this.loadTimeout); 
      this.loadTimeout = null; 
    }
    if (this.player) {
      try { this.player.stopVideo(); } catch { }
      this.player.destroy();
      this.player = null;
    }
  }

  private clearAllTimers(): void {
    if (this.loadTimeout) { 
      clearTimeout(this.loadTimeout); 
      this.loadTimeout = null; 
    }
    this.stopProgressTracking();
  }

  private startProgressTracking(): void {
    this.stopProgressTracking();
    this.lastProgressNotify = 0;
    
    if (this.state.playbackMode === 'offline') return;
    
    this.progressInterval = setInterval(() => {
      if (this.state.playbackMode === 'youtube' && this.player && this.state.isPlaying) {
        try {
          this.state.currentTime = this.player.getCurrentTime() || 0;
          this.state.duration = this.player.getDuration() || this.state.duration;
        } catch { }
        const now = Date.now();
        if (now - this.lastProgressNotify >= 500) {
          this.lastProgressNotify = now;
          this.emit('progress', this.state.currentTime);
        }
      }
    }, 250);
  }

  private stopProgressTracking(): void {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  pause(): void {
    if (this.state.playbackMode === 'offline') {
      if (this.htmlAudio) {
        this.htmlAudio.pause();
        this.setState({ isPlaying: false });
        this.stopProgressTracking();
        this.emit('pause');
      }
      return;
    }
    if (this.player && this.state.isPlaying) {
      this.player.pauseVideo();
      this.setState({ isPlaying: false });
      this.stopProgressTracking();
      this.emit('pause');
    }
  }

  resume(): void {
    if (this.state.playbackMode === 'offline') {
      if (this.htmlAudio && !this.state.isPlaying && this.state.currentSong) {
        this.htmlAudio.play().catch(() => {});
        this.setState({ isPlaying: true });
        this.startProgressTracking();
        this.emit('play', { song: this.state.currentSong });
      }
      return;
    }
    if (this.player && !this.state.isPlaying && this.state.currentSong) {
      this.player.playVideo();
      this.setState({ isPlaying: true });
      this.startProgressTracking();
      this.emit('play', { song: this.state.currentSong });
    }
  }

  stop(): void {
    this.clearAllTimers();
    this.stopCurrentPlayback();
    this.setState({ 
      isPlaying: false, 
      currentTime: 0, 
      currentSong: null,
      isLoading: false,
      error: null
    });
    this.retryCount = 0;
  }

  seek(seconds: number): void {
    const clamped = Math.max(0, Math.min(seconds, this.state.duration));
    
    if (this.state.playbackMode === 'offline') {
      if (this.htmlAudio) {
        this.htmlAudio.currentTime = clamped;
        this.state.currentTime = clamped;
      }
      return;
    }
    if (this.player) {
      this.player.seekTo(clamped, true);
      this.state.currentTime = clamped;
    }
  }

  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.state.volume = clamped;
    
    if (this.state.playbackMode === 'offline' && this.htmlAudio) {
      this.htmlAudio.volume = clamped;
      return;
    }
    if (this.player) {
      this.player.setVolume(Math.round(clamped * 100));
    }
  }

  getCurrentTime(): number {
    return this.state.currentTime;
  }

  getDuration(): number {
    return this.state.duration;
  }

  getIsPlaying(): boolean {
    return this.state.isPlaying;
  }

  getCurrentSong(): Song | null {
    return this.state.currentSong;
  }

  getVolume(): number {
    return this.state.volume;
  }

  getPlaybackMode(): PlaybackMode {
    return this.state.playbackMode;
  }

  destroy(): void {
    this.isDestroyed = true;
    this.abortController?.abort();
    this.clearAllTimers();
    this.stopCurrentPlayback();
    
    this.detachHtmlAudioListeners();
    
    if (this.htmlAudio) {
      backgroundPlaybackService.unregisterAudioElement(this.htmlAudio);
      this.htmlAudio = null;
    }
    
    this.listeners.clear();
    this.state = {
      currentSong: null,
      isPlaying: false,
      duration: 0,
      currentTime: 0,
      volume: 0.7,
      playbackMode: 'youtube',
      isLoading: false,
      error: null,
    };
    this.currentPlaybackId = 0;
    this.playbackTransitionLock = false;
    this.retryCount = 0;
  }
}

export const audioService = new AudioService();