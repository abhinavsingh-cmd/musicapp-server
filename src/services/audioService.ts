import { Song } from '../types/music';
import { backgroundPlaybackService } from './backgroundPlaybackService';
import { equalizerService } from './equalizerService';
import { backgroundAudio } from './backgroundAudio';
import { youtubePlayerService } from './youtubePlayerService';
import { showToast } from '../utils/toast';
import { getPreloadedElement } from './preloadService';
import { metricsCollector } from './metricsCollector';

function isNativePlatform(): boolean {
  return !!(window as any).Capacitor;
}

const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

function isValidYouTubeId(id: string | undefined): id is string {
  return typeof id === 'string' && YT_ID_RE.test(id);
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

function log(...args: any[]) {
  if (import.meta.env.DEV) console.log('[AudioService]', ...args);
}

function logError(...args: any[]) {
  if (import.meta.env.DEV) console.error('[AudioService]', ...args);
}

function logPerf(label: string, startMark: string) {
  if (import.meta.env.DEV) {
    const endMark = `${startMark}_end`;
    performance.mark(endMark);
    performance.measure(label, startMark, endMark);
    const m = performance.getEntriesByName(label).pop();
    if (m) console.log(`[Perf] ${label}: ${m.duration.toFixed(0)}ms`);
    performance.clearMarks(startMark);
    performance.clearMarks(endMark);
    performance.clearMeasures(label);
  }
}

// --- Network preconnect (injected once) ---
let preconnectDone = false;
function preconnectYouTube() {
  if (preconnectDone) return;
  preconnectDone = true;
  const domains = [
    'https://www.youtube.com',
    'https://i.ytimg.com',
    'https://s.ytimg.com',
    'https://www.google.com',
  ];
  for (const href of domains) {
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = href;
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  }
  // Also prefetch the YouTube IFrame API script
  const prefetch = document.createElement('link');
  prefetch.rel = 'preload';
  prefetch.as = 'script';
  prefetch.href = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(prefetch);
}

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
  private currentPlaybackId = 0;
  private lastProgressNotify = 0;
  private consecutiveFailures = 0;
  private progressInterval: ReturnType<typeof setInterval> | null = null;
  private streamStartTime = 0;
  private waitingStartTime = 0;

  private async getHtmlAudio(): Promise<HTMLAudioElement> {
    if (!this.htmlAudio) {
      log('Creating new HTMLAudioElement');
      this.htmlAudio = new Audio();
      this.htmlAudio.preload = 'auto';
      // NOTE: Do NOT set crossOrigin here. It can cause CORS tainting with
      // blob URLs on some WebViews, preventing MediaElementAudioSourceNode
      // from producing output. Cross-origin URLs are handled by the server.
      backgroundPlaybackService.registerAudioElement(this.htmlAudio);
      this.attachHtmlAudioListeners();
      // Init equalizer — await it so we know the AudioContext state before playback
      await equalizerService.init(this.htmlAudio);
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
    log('EVENT: ended');
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
    }
  };

  private handleError = (): void => {
    const error = this.htmlAudio?.error;
    const message = error?.message || 'Playback error';
    logError('EVENT: error', { code: error?.code, message });
    this.setState({ error: message, isLoading: false, isPlaying: false });
    this.emit('error', message);
  };

  private handleWaiting = (): void => {
    this.waitingStartTime = performance.now();
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
      this.emit('play', { song: this.state.currentSong });

      // Push stream latency metric
      if (this.streamStartTime > 0 && this.state.currentSong) {
        metricsCollector.pushStreamLatency({
          songId: this.state.currentSong.id,
          duration: performance.now() - this.streamStartTime,
          timestamp: Date.now(),
        });
      }

      // Push buffer recovery metric if we were buffering
      if (this.waitingStartTime > 0 && this.state.currentSong) {
        metricsCollector.pushBufferSample({
          songId: this.state.currentSong.id,
          bufferDuration: performance.now() - this.waitingStartTime,
          timestamp: Date.now(),
        });
        this.waitingStartTime = 0;
      }
    }
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
      const dur = this.htmlAudio.duration;
      if (dur && isFinite(dur)) {
        this.state.duration = dur;
      }
      log('EVENT: loadedmetadata', { duration: dur });
      this.emit('loaded', { song: this.state.currentSong });
    }
  };

  /**
   * Wait for the audio element to reach readyState >= 3 (HAVE_FUTURE_DATA).
   * Returns true if canplay fired, false on timeout or error.
   */
  private waitForCanPlay(audio: HTMLAudioElement, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (audio.readyState >= 3) {
        resolve(true);
        return;
      }
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        audio.removeEventListener('canplay', onReady);
        audio.removeEventListener('canplaythrough', onReady);
        audio.removeEventListener('error', onError);
        clearTimeout(timer);
      };
      const onReady = () => { cleanup(); resolve(true); };
      const onError = () => { cleanup(); resolve(false); };
      const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
      audio.addEventListener('canplay', onReady, { once: true });
      audio.addEventListener('canplaythrough', onReady, { once: true });
      audio.addEventListener('error', onError, { once: true });
    });
  }

  /**
   * Emit error + ended events and show a toast. Centralizes failure handling.
   */
  private emitPlaybackError(song: Song, message: string): void {
    logError('✗ PLAYBACK FAILED:', { title: song.title, message });
    this.consecutiveFailures++;
    this.setState({ error: message, isLoading: false, isPlaying: false });
    this.emit('error', message);
    this.emit('ended');
    showToast('Unable to play this song.', 'error');
  }

  private setState(partial: Partial<AudioState>): void {
    this.state = { ...this.state, ...partial };
  }

  private emit(event: AudioEventType, data?: any): void {
    this.listeners.forEach(cb => {
      try { cb(event, data); } catch { /* listener error */ }
    });
  }

  subscribe(callback: AudioEventHandler): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  getState(): Readonly<AudioState> {
    return this.state;
  }

  /**
   * Main entry point: play a song.
   * Pipeline:
   *  1. Abort previous playback immediately
   *  2. Detect path (audioUrl → HTML audio, youtubeId → YouTube IFrame)
   *  3. Load + play with timeout
   *  4. Emit events for store
   */
  async play(song: Song, playlist: Song[] = [], startIndex: number = 0): Promise<void> {
    const markId = `play_${song.id}_${Date.now()}`;
    performance.mark(markId);
    this.streamStartTime = performance.now();
    log('▶ play() called:', { title: song.title, youtubeId: song.youtubeId || 'NONE' });
    
    const playbackId = ++this.currentPlaybackId;
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
    
    // --- Path detection ---
    if (song.audioUrl && song.audioUrl.trim()) {
      // PATH 1: Direct audio (downloaded songs, blob URLs)
      log('PATH 1: HTML audio via audioUrl');
      this.useYoutubePlayer = false;
      this.playHtmlAudio(song, playbackId, markId);
      return;
    }
    
    if (song.youtubeId && isValidYouTubeId(song.youtubeId)) {
      // PATH 2: YouTube — go straight to IFrame API (server stream is broken on Render)
      log('PATH 2: YouTube IFrame (direct)', { youtubeId: song.youtubeId });
      preconnectYouTube();
      this.useYoutubePlayer = true;
      this.playYouTube(song, playbackId, markId);
      return;
    }
    
    // No source
    logError('NO AUDIO SOURCE for:', song.title);
    this.setState({ error: 'No audio source available', isLoading: false });
    this.emit('error', 'No audio source available');
    this.emit('ended');
  }

  /**
   * HTML Audio playback (audioUrl songs).
   * Key: reuse existing HTMLAudioElement, don't destroy/recreate.
   * Pipeline: reset → init equalizer (ensure AudioContext running) → set src → wait canplay → play → retry.
   */
  private async playHtmlAudio(song: Song, playbackId: number, markId: string): Promise<void> {
    const MAX_RETRIES = 3;
    const CANPLAY_TIMEOUT_MS = 3_000;

    this.stopYouTubePlayer();

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (this.currentPlaybackId !== playbackId) return;

      const audio = await this.getHtmlAudio();

      log(`▶ playHtmlAudio attempt ${attempt}/${MAX_RETRIES}:`, {
        title: song.title,
        src: song.audioUrl ? `${song.audioUrl.substring(0, 80)}` : 'EMPTY',
        volume: this.state.volume,
      });

      // If this song was preloaded, adopt the preloaded data into the main element
      const preloaded = getPreloadedElement(song);
      if (preloaded && preloaded !== audio) {
        log('Adopting preloaded audio element data');
        try {
          preloaded.pause();
        } catch {}
      }

      // Reset the element
      audio.pause();
      audio.removeAttribute('src');
      try { audio.load(); } catch {}

      // CRITICAL: Init/resume the equalizer's AudioContext BEFORE assigning src.
      // If the AudioContext is suspended when createMediaElementSource() runs,
      // the source node captures the audio element but routes through a dead path —
      // time advances, events fire, but NO SOUND is heard.
      // Skip re-init if equalizer is already connected to this element and AudioContext is running.
      if (!equalizerService.isReady || equalizerService.audioContextState !== 'running') {
        try {
          await equalizerService.init(audio);
          log('AudioContext state after init:', equalizerService.audioContextState);
        } catch (err) {
          logError('equalizer init failed:', err);
        }
      } else {
        log('Equalizer already ready, skipping re-init');
      }

      // Assign source AFTER equalizer is ready
      audio.src = song.audioUrl!;

      // Verify volume is not zero
      if (audio.volume === 0 || Number.isNaN(audio.volume)) {
        const safe = this.state.volume || 0.7;
        log(`⚠ Volume was ${audio.volume}, resetting to ${safe}`);
        audio.volume = safe;
      } else {
        audio.volume = this.state.volume;
      }

      // Verify not muted
      if (audio.muted) {
        log('⚠ Audio was muted — unmuting');
        audio.muted = false;
      }

      // Verify playbackRate
      if (audio.playbackRate !== 1) {
        log(`⚠ playbackRate was ${audio.playbackRate} — resetting to 1`);
        audio.playbackRate = 1;
      }

      log('Source assigned. Waiting for canplay...', {
        src: audio.src?.substring(0, 80),
        volume: audio.volume,
        muted: audio.muted,
        playbackRate: audio.playbackRate,
        readyState: audio.readyState,
        eqState: equalizerService.audioContextState,
      });

      const canplayOk = await this.waitForCanPlay(audio, CANPLAY_TIMEOUT_MS);

      if (this.currentPlaybackId !== playbackId) return;

      if (!canplayOk) {
        logError(`⏱ canplay timeout on attempt ${attempt}/${MAX_RETRIES}`);
        if (attempt < MAX_RETRIES) {
          log('Retrying...');
          continue;
        }
        this.emitPlaybackError(song, `Unable to play "${song.title}" — loading timed out`);
        return;
      }

      log('canplay ✓ — calling play()...', {
        currentTime: audio.currentTime,
        duration: audio.duration,
        readyState: audio.readyState,
        networkState: audio.networkState,
        paused: audio.paused,
        volume: audio.volume,
        muted: audio.muted,
        playbackRate: audio.playbackRate,
        eqState: equalizerService.audioContextState,
        eqReady: equalizerService.isReady,
      });

      try {
        await audio.play();

        if (this.currentPlaybackId !== playbackId) return;

        // CRITICAL: After play() succeeds, verify audio is actually audible.
        // On some WebViews, the AudioContext can silently suspend even after resume().
        // If so, try one more resume to unblock audio output.
        if (equalizerService.audioContextState !== 'running') {
          log('⚠ AudioContext NOT running after play() — attempting emergency resume');
          await equalizerService.resume();
          log('AudioContext state after emergency resume:', equalizerService.audioContextState);
        }

        log('✓ Playing successfully');
        logPerf('HTML_Audio_Playing', markId);
        this.consecutiveFailures = 0;

        if (isNativePlatform()) {
          backgroundAudio.startService({ title: song.title, artist: song.artist }).catch(() => {});
        }
        return;
      } catch (err) {
        if (this.currentPlaybackId !== playbackId) return;
        const errName = err instanceof Error ? err.name : '';
        const errMsg = err instanceof Error ? err.message : String(err);
        logError(`✗ play() failed attempt ${attempt}/${MAX_RETRIES}:`, { name: errName, message: errMsg });

        if (errName === 'NotSupportedError' || errName === 'EncodingError') {
          this.emitPlaybackError(song, `Unable to play "${song.title}" — format not supported`);
          return;
        }

        if (attempt < MAX_RETRIES) {
          log('Retrying...');
          continue;
        }

        this.emitPlaybackError(song, `Unable to play "${song.title}": ${errMsg}`);
        return;
      }
    }

    if (this.currentPlaybackId === playbackId) {
      this.emitPlaybackError(song, `Unable to play "${song.title}"`);
    }
  }

  /**
   * YouTube IFrame playback with retry loop.
   * Pipeline:
   *  1. Stop any current playback
   *  2. Subscribe to player events
   *  3. Load video — if it fails, destroy player and retry (up to 3x)
   *  4. On success, mark stream working and emit loaded
   */
  private async playYouTube(song: Song, playbackId: number, markId: string): Promise<void> {
    const MAX_YT_RETRIES = 3;

    this.stopHtmlAudio();

    let bufferingTimer: ReturnType<typeof setTimeout> | null = null;
    const startBufferingTimeout = () => {
      if (bufferingTimer) clearTimeout(bufferingTimer);
      bufferingTimer = setTimeout(() => {
        if (this.currentPlaybackId !== playbackId) return;
        logError('YouTube buffering timeout (>30s) — skipping');
        showToast('Skipping — stream took too long to load.', 'error');
        this.emit('ended');
      }, 30_000);
    };
    const clearBufferingTimeout = () => {
      if (bufferingTimer) { clearTimeout(bufferingTimer); bufferingTimer = null; }
    };

    for (let attempt = 1; attempt <= MAX_YT_RETRIES; attempt++) {
      if (this.currentPlaybackId !== playbackId) return;

      try {
        this.stopYouTubePlayer();

        log(`▶ playYouTube attempt ${attempt}/${MAX_YT_RETRIES}:`, { title: song.title, youtubeId: song.youtubeId });

        const attemptMark = `ytAPI_${song.id}_${attempt}`;
        performance.mark(attemptMark);

        this.ytUnsubscribe = youtubePlayerService.subscribe((event, data) => {
          if (this.currentPlaybackId !== playbackId) return;

          switch (event) {
            case 'play':
              clearBufferingTimeout();
              if (!this.state.isPlaying) {
                logPerf('YouTube_Playing', attemptMark);
                this.setState({ isPlaying: true, isLoading: false, error: null });
                this.consecutiveFailures = 0;
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
              clearBufferingTimeout();
              this.setState({ isPlaying: false, currentTime: 0 });
              this.stopProgressTracking();
              this.emit('ended');
              break;
            case 'waiting':
              log('YouTube buffering...');
              startBufferingTimeout();
              this.emit('waiting');
              break;
            case 'error': {
              logError('YouTube player error:', data);
              clearBufferingTimeout();
              this.consecutiveFailures++;
              this.setState({ error: `Playback error: ${data}`, isLoading: false, isPlaying: false });
              this.emit('error', `Playback error: ${data}`);
              // Non-retryable errors: skip immediately
              const nonRetryable = typeof data === 'number' && [100, 101, 103, 150].includes(data);
              if (nonRetryable || this.consecutiveFailures >= 2) {
                this.emit('ended');
              }
              break;
            }
          }
        });

        await youtubePlayerService.load(song);

        if (this.currentPlaybackId !== playbackId) return;

        // Stream confirmed working — mark for future fast loads
        if (song.youtubeId) youtubePlayerService.markStreamWorking(song.youtubeId);

        logPerf('YouTube_Loaded', markId);
        this.setState({ isLoading: false, duration: song.duration });
        this.emit('loaded', { song });
        return; // Success — exit retry loop
      } catch (err) {
        if (this.currentPlaybackId !== playbackId) return;

        const msg = err instanceof Error ? err.message : 'YouTube player failed';
        logError(`✗ playYouTube attempt ${attempt}/${MAX_YT_RETRIES} FAILED:`, msg);

        if (attempt < MAX_YT_RETRIES) {
          log(`Retrying in ${500 * attempt}ms...`);
          // Destroy player to force fresh initialization on next attempt
          this.stopYouTubePlayer();
          youtubePlayerService.destroy();
          await new Promise(r => setTimeout(r, 500 * attempt));
          continue;
        }

        // All retries exhausted
        clearBufferingTimeout();
        this.emitPlaybackError(song, `Cannot play "${song.title}": ${msg}`);
      }
    }
    clearBufferingTimeout();
  }

  private stopCurrentPlayback(): void {
    this.stopProgressTracking();
    this.stopHtmlAudio();
    this.stopYouTubePlayer();
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
      // Don't destroy — just stop. The element stays alive for reuse.
      // Only clear source if we're switching to YouTube
      if (this.useYoutubePlayer) {
        try { this.htmlAudio.currentTime = 0; } catch {}
        this.htmlAudio.removeAttribute('src');
        try { this.htmlAudio.load(); } catch {}
      }
    }
  }

  private startProgressTracking(): void {
    this.stopProgressTracking();
    this.lastProgressNotify = 0;
    if (this.useYoutubePlayer) {
      this.progressInterval = setInterval(() => {
        if (!this.state.isPlaying) return;
        const ytTime = youtubePlayerService.getCurrentTime();
        if (ytTime > 0) {
          this.state.currentTime = ytTime;
          this.state.duration = youtubePlayerService.getDuration() || this.state.duration;
          const now = Date.now();
          if (now - this.lastProgressNotify >= 500) {
            this.lastProgressNotify = now;
            this.emit('progress', this.state.currentTime);
          }
        }
      }, 500);
    }
  }

  private stopProgressTracking(): void {
    if (this.progressInterval !== null) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  pause(): void {
    if (this.useYoutubePlayer) {
      youtubePlayerService.pause();
    } else if (this.htmlAudio) {
      this.htmlAudio.pause();
    }
    if (this.state.isPlaying) {
      this.setState({ isPlaying: false });
      this.stopProgressTracking();
      this.emit('pause');
      // Keep the foreground service and paused notification alive so Android
      // lock-screen, Bluetooth, and notification controls can resume playback.
      if (isNativePlatform()) {
        backgroundAudio.updatePlaybackState({
          isPlaying: false,
          position: this.getCurrentTime(),
        }).catch(() => {});
      }
    }
  }

  async resume(): Promise<void> {
    if (!this.state.currentSong || this.state.isPlaying) return;

    if (this.useYoutubePlayer) {
      youtubePlayerService.play();
      return;
    }

    if (this.htmlAudio && this.htmlAudio.src) {
      const playbackId = this.currentPlaybackId;
      log('resume() — verifying audio state...');

      // Init/resume equalizer AudioContext (blocks output if suspended)
      try {
        await equalizerService.init(this.htmlAudio);
      } catch {}
      if (this.currentPlaybackId !== playbackId) return;

      // Verify volume
      if (this.htmlAudio.volume === 0 || Number.isNaN(this.htmlAudio.volume)) {
        this.htmlAudio.volume = this.state.volume || 0.7;
      }

      // Verify not muted
      if (this.htmlAudio.muted) {
        this.htmlAudio.muted = false;
      }

      // Verify playbackRate
      if (this.htmlAudio.playbackRate !== 1) {
        this.htmlAudio.playbackRate = 1;
      }

      // Wait for canplay if audio isn't ready
      if (this.htmlAudio.readyState < 3) {
        log('resume() — waiting for canplay...');
        await this.waitForCanPlay(this.htmlAudio, 3_000);
      }
      if (this.currentPlaybackId !== playbackId) return;

      log('resume() — calling play()', {
        src: this.htmlAudio.src?.substring(0, 80),
        volume: this.htmlAudio.volume,
        muted: this.htmlAudio.muted,
        readyState: this.htmlAudio.readyState,
        eqState: equalizerService.audioContextState,
      });

      try {
        await this.htmlAudio.play();
        if (this.currentPlaybackId !== playbackId) return;
        this.consecutiveFailures = 0;
        this.setState({ isPlaying: true, error: null });
        this.startProgressTracking();
        this.emit('play', { song: this.state.currentSong });
        if (isNativePlatform()) {
          backgroundAudio.startService({ title: this.state.currentSong.title, artist: this.state.currentSong.artist }).catch(() => {});
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Resume failed';
        const errName = err instanceof Error ? err.name : '';
        logError('resume FAILED:', { name: errName, message: msg });
        this.consecutiveFailures++;
        this.setState({ isPlaying: false, error: msg });
        this.emit('error', msg);
        showToast('Unable to play this song.', 'error');
      }
    }
  }

  stop(): void {
    this.currentPlaybackId++;
    this.stopCurrentPlayback();
    this.setState({ 
      isPlaying: false, currentTime: 0, currentSong: null,
      isLoading: false, error: null
    });
    if (isNativePlatform()) {
      backgroundAudio.stopService().catch(() => {});
    }
  }

  seek(seconds: number): void {
    const maxDur = this.useYoutubePlayer ? this.getDuration() : this.state.duration;
    const clamped = Math.max(0, Math.min(seconds, maxDur || 0));
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
    if (this.useYoutubePlayer) return youtubePlayerService.getCurrentTime();
    return this.state.currentTime;
  }

  getDuration(): number {
    if (this.useYoutubePlayer) return youtubePlayerService.getDuration();
    return this.state.duration;
  }

  getIsPlaying(): boolean { return this.state.isPlaying; }
  getCurrentSong(): Song | null { return this.state.currentSong; }
  getVolume(): number { return this.state.volume; }
  getConsecutiveFailures(): number { return this.consecutiveFailures; }
  resetConsecutiveFailures(): void { this.consecutiveFailures = 0; }

  destroy(): void {
    this.currentPlaybackId++;
    this.stopCurrentPlayback();
    equalizerService.destroy();
    if (this.htmlAudio) {
      this.detachHtmlAudioListeners();
      backgroundPlaybackService.unregisterAudioElement(this.htmlAudio);
      this.htmlAudio = null;
    }
    this.listeners.clear();
    this.state = {
      currentSong: null, isPlaying: false, duration: 0,
      currentTime: 0, volume: 0.7, isLoading: false, error: null,
    };
    this.currentPlaybackId = 0;
    this.consecutiveFailures = 0;
  }
}
