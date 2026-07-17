import { Song } from '../types/music';
import { backgroundPlaybackService } from './backgroundPlaybackService';
import { equalizerService } from './equalizerService';
import { api } from '../config/api';
import { backgroundAudio } from './backgroundAudio';
import { youtubePlayerService } from './youtubePlayerService';

function isBlobUrl(url: string): boolean {
  return url.startsWith('blob:');
}

function isNativePlatform(): boolean {
  return !!(window as any).Capacitor;
}

interface AudioState {
  currentSong: Song | null;
  isPlaying: boolean;
  duration: number;
  currentTime: number;
  volume: number;
  isLoading: boolean;
  error: string | null;
}

type AudioEventType = 'play' | 'pause' | 'ended' | 'progress' | 'loaded' | 'error' | 'timeupdate' | 'waiting' | 'canplay' | 'playing';

type AudioEventHandler = (event: AudioEventType, data?: any) => void;

export class AudioService {
  private htmlAudio: HTMLAudioElement | null = null;
  private useYoutubePlayer = false;
  private ytUnsubscribe: (() => void) | null = null;
  
  private state: AudioState = {
    currentSong: null,
    isPlaying: false,
    duration: 0,
    currentTime: 0,
    volume: 0.7,
    isLoading: false,
    error: null,
  };

  private listeners = new Set<AudioEventHandler>();
  private pendingPlayPromise: Promise<void> | null = null;
  private playbackTransitionLock = false;
  private currentPlaybackId = 0;
  private lastProgressNotify = 0;
  private maxRetries = 3;
  private abortController: AbortController | null = null;
  private isDestroyed = false;

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
      
      this.setState({ 
        currentSong: song, 
        isLoading: true, 
        error: null, 
        duration: song.duration, 
        currentTime: 0,
        isPlaying: false 
      });
      
      this.emit('loaded', { song, playlist, index: startIndex });
      
      const audio = this.getHtmlAudio();
      
      let streamUrl: string;
      if (song.audioUrl && isBlobUrl(song.audioUrl)) {
        streamUrl = song.audioUrl;
        this.useYoutubePlayer = false;
      } else if (song.youtubeId) {
        this.useYoutubePlayer = true;
      } else {
        this.setState({ error: 'No audio source for this song', isLoading: false });
        this.emit('error', 'No audio source for this song');
        return;
      }

      if (this.useYoutubePlayer) {
        await this.playWithYouTubePlayer(song, playbackId);
      } else {
        await this.playWithHtmlAudio(audio, streamUrl, song, playbackId);
      }
    } finally {
      this.pendingPlayPromise = null;
      if (this.currentPlaybackId === playbackId) {
        this.playbackTransitionLock = false;
      }
    }
  }

  private stopCurrentPlayback(): void {
    this.stopProgressTracking();
    this.stopHtmlAudio();
    this.stopYouTubePlayer();
  }

  private async playWithYouTubePlayer(song: Song, playbackId: number): Promise<void> {
    try {
      this.stopHtmlAudio();
      this.stopYouTubePlayer();

      this.ytUnsubscribe = youtubePlayerService.subscribe((event, data) => {
        if (this.isDestroyed || this.currentPlaybackId !== playbackId) return;

        switch (event) {
          case 'play':
            if (!this.state.isPlaying) {
              this.setState({ isPlaying: true, isLoading: false, error: null });
              this.startProgressTracking();
              this.emit('play', { song });
              if (isNativePlatform()) {
                backgroundAudio.startService({ title: song.title, artist: song.artist }).catch(() => {});
              }
            }
            break;
          case 'pause':
            if (this.state.isPlaying) {
              this.setState({ isPlaying: false });
              this.stopProgressTracking();
              this.emit('pause');
            }
            break;
          case 'ended':
            this.setState({ isPlaying: false, currentTime: 0 });
            this.stopProgressTracking();
            this.emit('ended');
            break;
          case 'timeupdate':
            this.state.currentTime = data || 0;
            this.state.duration = youtubePlayerService.getDuration() || this.state.duration;
            const now = Date.now();
            if (now - this.lastProgressNotify >= 500) {
              this.lastProgressNotify = now;
              this.emit('progress', this.state.currentTime);
              this.emit('timeupdate', this.state.currentTime);
            }
            break;
          case 'error':
            this.setState({ error: `Playback error: ${data}`, isLoading: false, isPlaying: false });
            this.emit('error', `Playback error: ${data}`);
            break;
        }
      });

      await youtubePlayerService.load(song);
      this.setState({ isLoading: false, duration: song.duration });
      this.emit('loaded', { song });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'YouTube player failed';
      this.setState({ error: `Cannot play "${song.title}": ${msg}`, isLoading: false, isPlaying: false });
      this.emit('error', `Cannot play "${song.title}": ${msg}`);
      this.emit('ended');
    }
  }

  private async playWithHtmlAudio(audio: HTMLAudioElement, streamUrl: string, song: Song, playbackId: number): Promise<void> {
    this.stopYouTubePlayer();
    audio.src = streamUrl;
    audio.volume = this.state.volume;

    await equalizerService.resume();

    let lastError: any = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (this.isDestroyed || this.currentPlaybackId !== playbackId) return;

      try {
        audio.load();
        this.pendingPlayPromise = audio.play();
        await this.pendingPlayPromise;

        if (this.isDestroyed || this.currentPlaybackId !== playbackId) return;

        this.setState({ isPlaying: true, isLoading: false });
        this.emit('play', { song });

        if (isNativePlatform()) {
          backgroundAudio.startService({ title: song.title, artist: song.artist }).catch(() => {});
        }
        return;
      } catch (err) {
        lastError = err;
        console.error(`[AudioService] Playback attempt ${attempt + 1} failed:`, err);

        if (err instanceof DOMException && err.name === 'AbortError') return;

        if (attempt < this.maxRetries) {
          audio.src = '';
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }

    const msg = lastError instanceof Error ? lastError.message : 'Playback failed';
    this.setState({ error: `Cannot play "${song.title}": ${msg}`, isLoading: false, isPlaying: false });
    this.emit('error', `Cannot play "${song.title}": ${msg}`);
    this.emit('ended');
  }

  private stopYouTubePlayer(): void {
    if (this.ytUnsubscribe) {
      this.ytUnsubscribe();
      this.ytUnsubscribe = null;
    }
    youtubePlayerService.stop();
  }

  private stopHtmlAudio(): void {
    if (this.htmlAudio) {
      this.htmlAudio.pause();
      this.htmlAudio.currentTime = 0;
      this.htmlAudio.src = '';
    }
  }

  private clearAllTimers(): void {
  }

  private startProgressTracking(): void {
    this.lastProgressNotify = 0;
  }

  private stopProgressTracking(): void {
  }

  pause(): void {
    if (this.useYoutubePlayer) {
      youtubePlayerService.pause();
    } else if (this.htmlAudio && this.state.isPlaying) {
      this.htmlAudio.pause();
    }
    if (this.state.isPlaying) {
      this.setState({ isPlaying: false });
      this.stopProgressTracking();
      this.emit('pause');
      if (isNativePlatform()) {
        backgroundAudio.stopService().catch(() => {});
      }
    }
  }

  resume(): void {
    if (!this.state.isPlaying || !this.state.currentSong) return;

    if (this.useYoutubePlayer) {
      youtubePlayerService.play();
    } else if (this.htmlAudio) {
      equalizerService.resume().then(() => {
        this.htmlAudio?.play().catch(() => {});
      });
    }

    this.setState({ isPlaying: true });
    this.startProgressTracking();
    this.emit('play', { song: this.state.currentSong });
    if (isNativePlatform()) {
      backgroundAudio.startService({ title: this.state.currentSong.title, artist: this.state.currentSong.artist }).catch(() => {});
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
    if (isNativePlatform()) {
      backgroundAudio.stopService().catch(() => {});
    }
  }

  seek(seconds: number): void {
    const clamped = Math.max(0, Math.min(seconds, this.useYoutubePlayer ? this.getDuration() : this.state.duration));
    this.state.currentTime = clamped;
    if (this.useYoutubePlayer) {
      youtubePlayerService.seek(clamped);
    } else if (this.htmlAudio) {
      this.htmlAudio.currentTime = clamped;
    }
  }

  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.state.volume = clamped;
    if (this.useYoutubePlayer) {
      youtubePlayerService.setVolume(clamped);
    } else if (this.htmlAudio) {
      this.htmlAudio.volume = clamped;
    }
  }

  getCurrentTime(): number {
    if (this.useYoutubePlayer) {
      return youtubePlayerService.getCurrentTime();
    }
    return this.state.currentTime;
  }

  getDuration(): number {
    if (this.useYoutubePlayer) {
      return youtubePlayerService.getDuration();
    }
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

  destroy(): void {
    this.isDestroyed = true;
    this.abortController?.abort();
    this.clearAllTimers();
    this.stopCurrentPlayback();
    
    this.detachHtmlAudioListeners();
    this.stopYouTubePlayer();
    youtubePlayerService.destroy();
    
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
      isLoading: false,
      error: null,
    };
    this.currentPlaybackId = 0;
    this.playbackTransitionLock = false;
  }
}