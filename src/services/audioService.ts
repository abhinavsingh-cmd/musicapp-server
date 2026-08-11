import { Song } from '../types/music';
import { backgroundPlaybackService } from './backgroundPlaybackService';
import { audioEffectsService } from './audioEffectsService';
import { backgroundAudio } from './backgroundAudio';
import { youtubePlayerService } from './youtubePlayerService';
import { extractAudioUrl, invalidateAudioUrl } from './youtubeAudioExtractor';
import { showToast } from '../utils/toast';
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
    // Never let performance instrumentation break playback: the start mark may
    // have been consumed/cleared by an earlier logPerf call (e.g. the parallel
    // YouTube path uses the same markId), which makes measure() throw.
    try {
      const endMark = `${startMark}_end`;
      performance.mark(endMark);
      if (performance.getEntriesByName(startMark).length > 0) {
        performance.measure(label, startMark, endMark);
        const m = performance.getEntriesByName(label).pop();
        if (m) console.log(`[Perf] ${label}: ${m.duration.toFixed(0)}ms`);
      }
      performance.clearMarks(startMark);
      performance.clearMarks(endMark);
      performance.clearMeasures(label);
    } catch {
      // ignore — perf logging is best-effort
    }
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
  private pendingStartTime = 0;
  private reEntryLock = false;

  private async getHtmlAudio(): Promise<HTMLAudioElement> {
    if (!this.htmlAudio) {
      log('Creating new HTMLAudioElement');
      this.htmlAudio = new Audio();
      this.htmlAudio.preload = 'auto';
      try { backgroundPlaybackService.registerAudioElement(this.htmlAudio); } catch {}
      this.attachHtmlAudioListeners();
      await audioEffectsService.init(this.htmlAudio);
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
      if (this.streamStartTime > 0 && this.state.currentSong) {
        metricsCollector.pushStreamLatency({
          songId: this.state.currentSong.id,
          duration: performance.now() - this.streamStartTime,
          timestamp: Date.now(),
        });
      }
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
      try { cb(event, data); } catch (e) { logError('Listener error:', e); }
    });
  }

  subscribe(callback: AudioEventHandler): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  getState(): Readonly<AudioState> {
    return this.state;
  }

  async play(song: Song, playlist: Song[] = [], startIndex: number = 0, startTime?: number): Promise<void> {
    if (!song || !song.id) {
      logError('play() called with null/undefined song');
      return;
    }
    // Re-entry guard: prevent concurrent play() for the same song. This breaks
    // the infinite loop: foreground service → notifyMediaAction("play") →
    // audioStore.play() → audioService.play() → startService → service → play…
    if (this.reEntryLock && this.state.currentSong?.id === song.id && (this.state.isPlaying || this.state.isLoading)) {
      log('play() re-entry blocked — song already playing/loading:', song.title);
      return;
    }
    this.reEntryLock = true;
    try {
      await this._playInternal(song, playlist, startIndex, startTime);
    } finally {
      this.reEntryLock = false;
    }
  }

  private async _playInternal(song: Song, playlist: Song[], startIndex: number, startTime?: number): Promise<void> {
    const playbackId = ++this.currentPlaybackId;
    try {
      const markId = `play_${song.id}_${Date.now()}`;
      this.streamStartTime = performance.now();
      this.pendingStartTime = startTime && isFinite(startTime) && startTime > 0 ? startTime : 0;
      log('▶ play() called:', { title: song.title, youtubeId: song.youtubeId || 'NONE', startTime: this.pendingStartTime });

      // Start foreground service FIRST — before any audio work — so the app
      // process is protected by Android from being killed during backgrounding.
      // Must await so the service is guaranteed running before audio starts.
      if (isNativePlatform()) {
        try {
          const result = await backgroundAudio.startService({ title: song.title, artist: song.artist });
          log('Foreground service started:', result);
        } catch (err) {
          logError('Failed to start foreground service:', err);
        }
      }

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

      if (song.audioUrl && song.audioUrl.trim()) {
        log('PATH 1: HTML audio via audioUrl');
        this.useYoutubePlayer = false;
        await this.playHtmlAudio(song, playbackId, markId);
        return;
      }

      if (song.youtubeId && isValidYouTubeId(song.youtubeId)) {
        log('Extracting audio URL for:', song.youtubeId);
        let extractionResult: string | null = null;
        try {
          extractionResult = await extractAudioUrl(song.youtubeId);
        } catch (err) {
          logError('Extraction failed:', err);
        }

        if (extractionResult && this.currentPlaybackId === playbackId) {
          log('✓ Extraction succeeded — playing as HTML audio');
          this.useYoutubePlayer = false;
          await this.playHtmlAudio({ ...song, audioUrl: extractionResult }, playbackId, markId);
          return;
        }

        if (this.currentPlaybackId !== playbackId) return;

        log('Extraction failed — falling back to YouTube IFrame');
        preconnectYouTube();
        this.useYoutubePlayer = true;
        try {
          await this.playYouTube(song, playbackId, markId);
        } catch (ytErr) {
          logError('YouTube IFrame also failed:', ytErr);
          if (this.currentPlaybackId === playbackId) {
            this.emitPlaybackError(song, `Unable to play "${song.title}" — no audio source available`);
          }
        }
        return;
      }

      logError('NO AUDIO SOURCE for:', song.title);
      this.setState({ error: 'No audio source available', isLoading: false });
      this.emit('error', 'No audio source available');
      this.emit('ended');
    } catch (err) {
      logError('_playInternal UNEXPECTED ERROR:', err);
      if (this.currentPlaybackId === playbackId) {
        const msg = err instanceof Error ? err.message : 'Playback failed';
        this.setState({ error: msg, isLoading: false, isPlaying: false });
        this.emit('error', msg);
        this.emit('ended');
      }
    }
  }

  private async playHtmlAudio(song: Song, playbackId: number, markId: string): Promise<void> {
    const MAX_RETRIES = 3;
    // Proxy/extracted URLs need more time to start streaming than local files
    const CANPLAY_TIMEOUT_MS = song.audioUrl?.includes('/proxy-audio') ? 10_000 : 8_000;

    this.stopYouTubePlayer();

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (this.currentPlaybackId !== playbackId) return;

      const audio = await this.getHtmlAudio();

      log(`▶ playHtmlAudio attempt ${attempt}/${MAX_RETRIES}:`, {
        title: song.title,
        src: song.audioUrl ? `${song.audioUrl.substring(0, 80)}` : 'EMPTY',
        volume: this.state.volume,
      });

      // CRITICAL: Always attempt to ensure AudioContext is running before equalizer init
      if (audioEffectsService.audioContextState !== 'running') {
        log('AudioContext not running, attempting to resume...');
        try {
          await audioEffectsService.resume();
          log('AudioContext resumed to:', audioEffectsService.audioContextState);
        } catch (err) {
          logError('AudioContext resume failed:', err);
          // Continue - audio may still play without equalizer
        }
      }

      // CRITICAL: If AudioContext is now running, ensure equalizer is initialized with this audio element
      // If equalizer is already initialized with a different audio element, it needs to be re-initialized
      if (audioEffectsService.audioContextState === 'running') {
        if (!audioEffectsService.isReady ||
            (audioEffectsService.getAudioElement() && audioEffectsService.getAudioElement() !== audio)) {
          log('Initializing/Re-initializing equalizer for new audio element');
          try {
            await audioEffectsService.init(audio);
            log('Equalizer initialized successfully, state:', audioEffectsService.audioContextState);
          } catch (err) {
            logError('Equalizer initialization failed:', err);
            // Continue - audio may still play without equalizer
          }
        } else {
          log('Equalizer already ready and configured for current audio element');
        }
      } else {
        log('AudioContext still not running, equalizer will not be available');
      }

      // If equalizer is ready and enabled, apply the current gains to ensure instant effect
      try {
        if (audioEffectsService.isReady && audioEffectsService.enabled) {
          const currentGains = audioEffectsService.gains;
          const eqFilters = audioEffectsService.getFilters();
          for (let i = 0; i < currentGains.length && i < eqFilters.length; i++) {
            if (Math.abs(eqFilters[i].gain.value - currentGains[i]) > 0.1) {
              eqFilters[i].gain.value = currentGains[i];
            }
          }
          log('Applied current equalizer gains for instant effect');
        }
      } catch (eqErr) {
        logError('Equalizer gain apply failed (non-fatal):', eqErr);
      }

      // Assign source AFTER equalizer is ready
      audio.src = song.audioUrl || '';

      if (audio.volume === 0 || Number.isNaN(audio.volume)) {
        const safe = this.state.volume || 0.7;
        log(`⚠ Volume was ${audio.volume}, resetting to ${safe}`);
        audio.volume = safe;
      } else {
        audio.volume = this.state.volume;
      }

      if (audio.muted) {
        log('⚠ Audio was muted — unmuting');
        audio.muted = false;
      }

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
        eqState: audioEffectsService.audioContextState,
      });

      const canplayOk = await this.waitForCanPlay(audio, CANPLAY_TIMEOUT_MS);

      if (this.currentPlaybackId !== playbackId) return;

      if (!canplayOk) {
        logError(`⏱ canplay timeout on attempt ${attempt}/${MAX_RETRIES}`);
        if (attempt < MAX_RETRIES) {
          log('Retrying...');
          // The stream URL is likely stale/expired (403/416 upstream) — force a
          // fresh extraction so the next attempt doesn't reuse the bad URL.
          const freshUrl = await this.reExtractFreshUrl(song);
          if (freshUrl) song.audioUrl = freshUrl;
          continue;
        }
        this.emitPlaybackError(song, `Unable to play "${song.title}" — loading timed out`);
        return;
      }

      log('canplay ✓ — calling play()...');

      if (this.pendingStartTime > 0) {
        try {
          const target = Math.min(this.pendingStartTime, audio.duration || this.pendingStartTime);
          audio.currentTime = target;
          log(`⏯ Resuming from saved position: ${target}s`);
        } catch (err) {
          logError('Failed to seek to saved position:', err);
        }
      }

      try {
        await audio.play();

        if (this.currentPlaybackId !== playbackId) return;
        this.pendingStartTime = 0;

        if (audioEffectsService.audioContextState !== 'running') {
          log('⚠ AudioContext NOT running after play() — attempting emergency resume');
          await audioEffectsService.resume();
          log('AudioContext state after emergency resume:', audioEffectsService.audioContextState);
        }

        log('✓ Playing successfully');
        logPerf('HTML_Audio_Playing', markId);
        this.consecutiveFailures = 0;

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
          const freshUrl = await this.reExtractFreshUrl(song);
          if (freshUrl) song.audioUrl = freshUrl;
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
   * Force a fresh stream URL for a failed play attempt. The cached proxy URL may
   * reference an expired/nerfed Googlevideo URL (403/416) — invalidating the
   * extractor cache makes the next extractAudioUrl() call fetch a new one.
   */
  private async reExtractFreshUrl(song: Song): Promise<string | null> {
    if (!song.youtubeId || !song.audioUrl?.includes('/proxy-audio')) return null;
    invalidateAudioUrl(song.youtubeId);
    return await extractAudioUrl(song.youtubeId).catch(() => null);
  }

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

        if (song.youtubeId) youtubePlayerService.markStreamWorking(song.youtubeId);

        if (this.pendingStartTime > 0) {
          try {
            youtubePlayerService.seek(this.pendingStartTime);
            log(`⏯ YouTube resuming from saved position: ${this.pendingStartTime}s`);
          } catch (err) {
            logError('Failed to seek YouTube player:', err);
          }
          this.pendingStartTime = 0;
        }

        logPerf('YouTube_Loaded', markId);
        this.setState({ isLoading: false, duration: song.duration });
        this.emit('loaded', { song });
        return;
      } catch (err) {
        if (this.currentPlaybackId !== playbackId) return;

        const msg = err instanceof Error ? err.message : 'YouTube player failed';
        logError(`✗ playYouTube attempt ${attempt}/${MAX_YT_RETRIES} FAILED:`, msg);

        if (attempt < MAX_YT_RETRIES) {
          log(`Retrying in ${500 * attempt}ms...`);
          this.stopYouTubePlayer();
          youtubePlayerService.destroy();
          await new Promise(r => setTimeout(r, 500 * attempt));
          continue;
        }

        clearBufferingTimeout();
        // Fallback: try Invidious audio extraction when YouTube IFrame fails
        log('YouTube IFrame failed — attempting Invidious audio extraction fallback...');
        try {
          const extractedUrl = await extractAudioUrl(song.youtubeId!);
          if (extractedUrl && this.currentPlaybackId === playbackId) {
            log('Invidious fallback succeeded — playing as HTML audio:', extractedUrl.substring(0, 80));
            this.useYoutubePlayer = false;
            this.playHtmlAudio({ ...song, audioUrl: extractedUrl }, playbackId, markId);
            return;
          }
        } catch (fallbackErr) {
          logError('Invidious fallback also failed:', fallbackErr);
        }
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
      try { this.htmlAudio.currentTime = 0; } catch {}
      this.htmlAudio.removeAttribute('src');
      try { this.htmlAudio.load(); } catch {}
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
      if (isNativePlatform()) {
        try { backgroundAudio.updatePlaybackState({
          isPlaying: false,
          position: this.getCurrentTime(),
          duration: this.getDuration(),
        }).catch(() => {}); } catch {}
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

      try {
        await audioEffectsService.init(this.htmlAudio);
      } catch {}
      if (this.currentPlaybackId !== playbackId) return;

      if (this.htmlAudio.volume === 0 || Number.isNaN(this.htmlAudio.volume)) {
        this.htmlAudio.volume = this.state.volume || 0.7;
      }

      if (this.htmlAudio.muted) {
        this.htmlAudio.muted = false;
      }

      if (this.htmlAudio.playbackRate !== 1) {
        this.htmlAudio.playbackRate = 1;
      }

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
        eqState: audioEffectsService.audioContextState,
      });

      try {
        await this.htmlAudio.play();
        if (this.currentPlaybackId !== playbackId) return;
        this.consecutiveFailures = 0;
        this.setState({ isPlaying: true, error: null });
        this.startProgressTracking();
        this.emit('play', { song: this.state.currentSong });
        if (isNativePlatform() && this.state.currentSong) {
          try {
            await backgroundAudio.startService({ title: this.state.currentSong.title, artist: this.state.currentSong.artist });
          } catch {}
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
      try { backgroundAudio.stopService().catch(() => {}); } catch {}
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
  /** True when an actual media source is loaded and playable. */
  isLoaded(): boolean {
    if (this.useYoutubePlayer) {
      return youtubePlayerService.getCurrentSongId() !== null;
    }
    return !!(this.htmlAudio && this.htmlAudio.src && this.htmlAudio.readyState > 0);
  }
  getConsecutiveFailures(): number { return this.consecutiveFailures; }
  resetConsecutiveFailures(): void { this.consecutiveFailures = 0; }

  destroy(): void {
    this.currentPlaybackId++;
    this.stopCurrentPlayback();
    audioEffectsService.destroy();
    if (this.htmlAudio) {
      this.detachHtmlAudioListeners();
      try { backgroundPlaybackService.unregisterAudioElement(this.htmlAudio); } catch {}
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

// Singleton exported from audioServiceInstance.ts — do NOT create another instance here.
