import { Song } from '../types/music';
import { backgroundPlaybackService } from './backgroundPlaybackService';
import { audioEffectsService } from './audioEffectsService';
import { backgroundAudio } from './backgroundAudio';
import { youtubePlayerService } from './youtubePlayerService';
import { showToast } from '../utils/toast';
import { metricsCollector } from './metricsCollector';
import {
  resolvePlayableSource,
  resolveLocalCopy,
  playableToEngineParams,
  toTrack,
  toSong,
  providerRegistry,
  type Track,
} from '../providers';

function isNativePlatform(): boolean {
  return !!(window as any).Capacitor;
}

function isLocalSrc(url: string): boolean {
  return url.startsWith('blob:') || url.startsWith('file:') || url.startsWith('data:');
}

// A mid-stream buffer stall on the HTML engine is bounded exactly like the
// YouTube engine's buffering timeout: a throttled/403'd direct stream can
// starve the <audio> element (endless 'waiting') without ever firing
// 'error' — without this guard the player would spin forever instead of
// recovering through the session's single bounded recovery (fresh stream
// resolution → embedded IFrame fallback).
const HTML_STALL_TIMEOUT_MS = 30_000;

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

/**
 * The ONE engine that currently owns playback. Exactly one of the three
 * backends is ever active — claimEngine() is the single chokepoint that
 * enforces this structurally instead of by convention.
 */
type EngineId = 'none' | 'native' | 'html' | 'youtube';

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

// --- Network warmup is provider-owned ---
// Providers expose an optional `preconnect()` hook (YouTube: video/thumbnail
// CDN preconnect + IFrame API script prefetch). The engine invokes it via
// the registry below without knowing which provider it is warming.

export class AudioService {
  private htmlAudio: HTMLAudioElement | null = null;
  private useYoutubePlayer = false;
  private ytUnsubscribe: (() => void) | null = null;

  // ── Native engine state (Android MediaPlayer inside MusicForegroundService) ──
  // Exactly one engine is active at a time, selected per track by source type:
  //   native  → remote http(s) streams on Android (survives WebView teardown)
  //   html    → web platform, blob:/file: downloads, EQ-processed audio
  //   youtube → iframe-only tracks with no direct stream
  private useNativePlayer = false;
  private nativeActiveCache = false;
  private nativeListenerReady = false;
  private nativeRetryCount = 0;
  private nativeTrack: Track | null = null;
  private nativeParams: { mode: 'html'; src: string; isLocalFile: boolean; expiresInMs?: number } | null = null;
  // Single source of truth for engine ownership — every engine start goes
  // through claimEngine(), which deterministically releases any other engine
  // first. Two engines can never be active simultaneously.
  private activeEngine: EngineId = 'none';
  
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
  private htmlStallTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingStartTime = 0;
  private reEntryLock = false;
  // Session ids bind engine/element callbacks to the playback session that
  // installed them. Events from a superseded session (an OLD track) are
  // dropped deterministically — a stale callback can never mutate the
  // current track's state.
  private htmlSessionId = 0;
  // The playback session that already consumed its ONE mid-stream recovery
  // attempt. Mid-playback stream failures re-resolve exactly once per
  // session — a second failure fails the track instead of looping.
  private htmlRecoverySession = -1;
  private nativeSessionId = 0;
  // Native session generation reported by the service for the current play —
  // lifecycle events ('ended') are tagged with it so a late completion for an
  // OLD track can never advance the queue of the NEW one.
  private nativeGeneration = -1;
  // The native session whose completion has already been consumed (live event
  // or endedPending recovery). A duplicate 'ended' for the same session is
  // dropped deterministically — no timers, no luck.
  private lastNativeEndedSession = -1;
  // The html session whose completion already fired. A duplicate 'ended' on
  // the SAME element/session is dropped deterministically — mirroring the
  // native dedupe so both engines have identical completion semantics.
  private lastHtmlEndedSession = -1;

  // ── Crossfade (HTML engine only) ──
  // The incoming track lives in a SECOND element owned by this SAME service —
  // never a second playback engine. Phases:
  //   idle → prepared (stream buffered, silent) → fading (volume ramps live)
  // promote swaps the element references so the incoming track becomes THE
  // htmlAudio. The outgoing element's listeners are detached at fade start,
  // so its late 'ended' can never double-advance the queue.
  private crossfadeAudio: HTMLAudioElement | null = null;
  private crossfadeSong: Song | null = null;
  private crossfadePhase: 'idle' | 'prepared' | 'fading' = 'idle';
  private crossfadeRampTimer: ReturnType<typeof setInterval> | null = null;

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
    if (this.htmlStallTimer) {
      clearTimeout(this.htmlStallTimer);
      this.htmlStallTimer = null;
    }
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
    if (this.htmlSessionId !== this.currentPlaybackId) return; // stale element
    if (this.lastHtmlEndedSession === this.htmlSessionId) return; // duplicate
    this.lastHtmlEndedSession = this.htmlSessionId;
    log('EVENT: ended');
    this.setState({ isPlaying: false, currentTime: 0 });
    this.stopProgressTracking();
    this.emitEnded();
  };

  private handleTimeUpdate = (): void => {
    if (!this.htmlAudio) return;
    if (this.htmlSessionId !== this.currentPlaybackId) return; // stale element
    this.state.currentTime = this.htmlAudio.currentTime || 0;
    this.state.duration = this.htmlAudio.duration || this.state.duration;
    const now = Date.now();
    if (now - this.lastProgressNotify >= 500) {
      this.lastProgressNotify = now;
      this.emit('progress', this.state.currentTime);
    }
  };

  private handleError = (): void => {
    if (this.htmlSessionId !== this.currentPlaybackId) return; // stale element
    const error = this.htmlAudio?.error;
    const message = error?.message || 'Playback error';
    logError('EVENT: error', { code: error?.code, message });
    if (this.state.isPlaying) {
      // A MID-STREAM failure (expired proxy URL, dropped connection): attempt
      // one bounded recovery (local copy first), then fail only THIS track.
      void this.recoverHtmlStream(message);
      return;
    }
    // STARTUP failure of a LOCAL file — the downloaded blob is corrupted or
    // the persisted blob: URL is dead. One bounded attempt to fall back to a
    // fresh remote stream before failing the track. (The attempt budget is
    // shared with mid-stream recovery — one recovery per session, ever.)
    const src = this.htmlAudio?.currentSrc || this.htmlAudio?.src || '';
    if (this.state.currentSong && isLocalSrc(src) && this.htmlRecoverySession !== this.currentPlaybackId) {
      void this.recoverHtmlStream(message);
      return;
    }
    // Startup errors on remote streams are owned by the playHtmlAudio
    // attempt loop and fall through.
    this.setState({ error: message, isLoading: false, isPlaying: false });
    this.emit('error', message);
  };

  /**
   * Bounded mid-stream recovery for the HTML engine — the offline/online
   * bridge. Exactly ONE recovery attempt per playback session:
   *   - REMOTE stream failed: a downloaded local copy wins first (it needs
   *     no network at all); otherwise force a fresh remote resolution and
   *     resume from the current position.
   *   - LOCAL file failed (corrupted/stale blob): strip the dead URL and
   *     force a fresh remote resolution — the failed copy can never be
   *     handed back (localFallback: false).
   * When nothing recovers, the failure is isolated to this track
   * (emitPlaybackError advances the queue).
   */
  private async recoverHtmlStream(message: string): Promise<void> {
    const song = this.state.currentSong;
    const playbackId = this.currentPlaybackId;
    const src = this.htmlAudio?.currentSrc || this.htmlAudio?.src || '';

    if (song && src && this.htmlRecoverySession !== playbackId) {
      this.htmlRecoverySession = playbackId;
      const position = this.state.currentTime;
      const wasLocal = isLocalSrc(src);
      log('HTML stream failed — one bounded recovery attempt:', { message, wasLocal });
      const track = toTrack(song);

      let playable: ReturnType<typeof resolveLocalCopy> = null;
      if (!wasLocal) {
        // Online stream died — prefer the local copy without any network.
        playable = resolveLocalCopy(track);
      }
      if (!playable) {
        // Corrupted/stale local files are stripped so resolution goes remote;
        // the failed copy is never offered back to the engine.
        const target = wasLocal ? { ...track, streamUrl: undefined } : track;
        playable = await resolvePlayableSource(target, { force: true, localFallback: !wasLocal });
      }
      if (this.currentPlaybackId !== playbackId) return; // superseded
      if (playable) {
        const fresh = playableToEngineParams(playable);
        if (fresh.mode === 'html') {
          this.pendingStartTime = position;
          await this.playHtmlAudio(song, track, fresh, playbackId, `html_recovery_${playbackId}`, true);
          return;
        }
      }
    }

    if (this.currentPlaybackId !== playbackId) return; // superseded
    if (song) {
      // Recovery impossible — fail this track only; the store advances.
      this.emitPlaybackError(song, `Unable to play "${song.title}" — stream failed`);
    } else {
      this.setState({ error: message, isLoading: false, isPlaying: false });
      this.emit('error', message);
    }
  }

  private handleWaiting = (): void => {
    if (this.htmlSessionId !== this.currentPlaybackId) return; // stale element
    this.waitingStartTime = performance.now();
    // Bounded mid-stream stall guard — one timer per stall episode. When it
    // fires, route through the session's SINGLE bounded recovery (fresh
    // resolution → IFrame fallback); a second stall on the same session
    // fails the track so the queue advances instead of looping.
    if (!this.htmlStallTimer) {
      this.htmlStallTimer = setTimeout(() => {
        this.htmlStallTimer = null;
        if (this.htmlSessionId !== this.currentPlaybackId) return; // stale
        if (!this.state.isPlaying && !this.state.isLoading) return; // user paused / dead
        log('HTML stream stalled >30s — attempting one bounded recovery');
        void this.recoverHtmlStream('Stream stalled (buffering timeout)');
      }, HTML_STALL_TIMEOUT_MS);
    }
    this.emit('waiting');
  };

  private handleCanPlay = (): void => {
    if (this.htmlSessionId !== this.currentPlaybackId) return; // stale element
    this.emit('canplay');
  };

  private handlePlaying = (): void => {
    if (this.htmlSessionId !== this.currentPlaybackId) return; // stale element
    // The stream genuinely resumed — disarm the stall guard.
    if (this.htmlStallTimer) {
      clearTimeout(this.htmlStallTimer);
      this.htmlStallTimer = null;
    }
    if (!this.state.isPlaying) {
      this.setState({ isPlaying: true, isLoading: false, error: null });
      this.startProgressTracking();
      this.emit('playing');
      this.emit('play', { song: this.state.currentSong, playbackId: this.currentPlaybackId });
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
    if (this.htmlSessionId !== this.currentPlaybackId) return; // stale element
    // A deliberate pause must not be mistaken for a stall.
    if (this.htmlStallTimer) {
      clearTimeout(this.htmlStallTimer);
      this.htmlStallTimer = null;
    }
    if (this.state.isPlaying) {
      this.setState({ isPlaying: false });
      this.stopProgressTracking();
      this.emit('pause');
    }
  };

  private handleLoadedMetadata = (): void => {
    if (this.htmlSessionId !== this.currentPlaybackId) return; // stale element
    if (this.htmlAudio) {
      const dur = this.htmlAudio.duration;
      if (dur && isFinite(dur)) {
        this.state.duration = dur;
      }
      log('EVENT: loadedmetadata', { duration: dur });
      this.emit('loaded', { song: this.state.currentSong, playbackId: this.currentPlaybackId });
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

  /**
   * 'ended' is ALWAYS tagged with the playback session that ended.
   * Consumers process each session exactly once — this is what guarantees an
   * ended track can never trigger two next-transitions.
   */
  private emitEnded(): void {
    this.emit('ended', { playbackId: this.currentPlaybackId });
  }

  private emitPlaybackError(song: Song, message: string): void {
    logError('✗ PLAYBACK FAILED:', { title: song.title, message });
    this.consecutiveFailures++;
    this.setState({ error: message, isLoading: false, isPlaying: false });
    this.emit('error', message);
    this.emitEnded();
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

  /** Monotonic playback session id — consumers use it to drop stale events. */
  getCurrentPlaybackId(): number {
    return this.currentPlaybackId;
  }

  async play(song: Song, playlist: Song[] = [], startIndex: number = 0, startTime?: number): Promise<void> {
    if (!song || typeof song.id !== 'string' || !song.id.trim()) {
      logError('play() called with a track that has no playable id:', song);
      // Reject loudly instead of silently returning: a silent return leaves
      // the caller stuck in isLoading with no error surfaced. Every caller
      // catches this and converts it into a controlled error state.
      throw new Error('This track cannot be played — it has no playable id');
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
    // An explicit play() supersedes any crossfade — finish a fade in progress
    // (promote the incoming element) or discard a prepared one BEFORE minting
    // the new session id, so the guards below see a stable playback id.
    if (this.crossfadePhase === 'fading') this.finishCrossfadeNow();
    else if (this.crossfadePhase !== 'idle') this.cancelCrossfade();
    const playbackId = ++this.currentPlaybackId;
    // Normalize once — everything downstream consumes the provider-agnostic
    // Track and PlayableSource shapes; the original Song is only used for
    // events and state so store/UI consumers see no change.
    const track = toTrack(song);
    try {
      const markId = `play_${song.id}_${Date.now()}`;
      this.streamStartTime = performance.now();
      this.pendingStartTime = startTime && isFinite(startTime) && startTime > 0 ? startTime : 0;
      log('▶ play() called:', { title: song.title, provider: track.provider, externalId: track.externalId || 'NONE', startTime: this.pendingStartTime });

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
      this.emit('loaded', { song, playlist, index: startIndex, playbackId });

      // Resolve a playable source through the track's provider. The engine
      // never inspects provider ids or endpoints — only the normalized
      // PlayableSource shape.
      const playable = await resolvePlayableSource(track);
      if (this.currentPlaybackId !== playbackId) return;

      if (!playable) {
        logError('NO AUDIO SOURCE for:', song.title);
        this.setState({ error: 'No audio source available', isLoading: false });
        this.emit('error', 'No audio source available');
        this.emitEnded();
        return;
      }

      const params = playableToEngineParams(playable);
      if (params.mode === 'iframe') {
        log('No direct stream — using embedded player (provider:', track.provider + ')');
        providerRegistry.get(track.provider)?.preconnect?.();
        this.useYoutubePlayer = true;
        try {
          await this.playYouTube(song, track, params.videoId, playbackId, markId);
        } catch (ytErr) {
          logError('Embedded player also failed:', ytErr);
          if (this.currentPlaybackId === playbackId) {
            this.emitPlaybackError(song, `Unable to play "${song.title}" — no audio source available`);
          }
        }
        return;
      }

      if (params.mode === 'html' && this.canUseNativeEngine(params.src, params.isLocalFile)) {
        this.useYoutubePlayer = false;
        await this.playNative(song, track, params, playbackId, markId);
        return;
      }

      this.useYoutubePlayer = false;
      await this.playHtmlAudio(song, track, params, playbackId, markId);
    } catch (err) {
      logError('_playInternal UNEXPECTED ERROR:', err);
      if (this.currentPlaybackId === playbackId) {
        const msg = err instanceof Error ? err.message : 'Playback failed';
        this.setState({ error: msg, isLoading: false, isPlaying: false });
        this.emit('error', msg);
        this.emitEnded();
      }
    }
  }

  /** The native Android MediaPlayer can only take over real remote streams —
   *  never blob:/file: downloads (native cannot read WebView object URLs) and
   *  never on the web platform. */
  private canUseNativeEngine(src: string, isLocalFile: boolean): boolean {
    return isNativePlatform() && !isLocalFile && /^https?:\/\//i.test(src);
  }

  /**
   * Play through the native Android MediaPlayer owned by MusicForegroundService.
   * This is the authoritative engine for remote streams on Android: audio keeps
   * rendering when the WebView is backgrounded, locked, or destroyed.
   */
  private async playNative(
    song: Song,
    track: Track,
    params: { mode: 'html'; src: string; isLocalFile: boolean; expiresInMs?: number },
    playbackId: number,
    markId: string,
  ): Promise<void> {
    // Single ownership chokepoint — releases any html/youtube session before
    // the native MediaPlayer takes over (no-op if native already owns it).
    this.claimEngine('native');
    this.ensureNativeListener();
    this.useYoutubePlayer = false;
    this.useNativePlayer = true;
    this.nativeActiveCache = true;
    this.nativeRetryCount = 0;
    this.nativeTrack = track;
    this.nativeParams = params;
    this.nativeSessionId = playbackId;

    log('▶ playNative — routing to Android MediaPlayer:', { title: song.title, src: params.src.substring(0, 80) });

    const startPositionMs = this.pendingStartTime > 0 ? Math.round(this.pendingStartTime * 1000) : 0;
    const result = await backgroundAudio.playAudioUrl({
      audioUrl: params.src,
      title: song.title,
      artist: song.artist,
      album: song.album || 'MusicApp',
      albumArt: song.coverArt,
      startPositionMs,
      volume: this.state.volume,
    });
    if (this.currentPlaybackId !== playbackId) return;
    this.pendingStartTime = 0;

    if (!result.started) {
      logError('Native engine unavailable — falling back to WebView audio');
      this.releaseEngine('native');
      this.useNativePlayer = false;
      this.nativeActiveCache = false;
      await this.playHtmlAudio(song, track, params, playbackId, markId);
      return;
    }

    // Remember the native generation of THIS session so later lifecycle
    // events can be matched against the play that produced them.
    this.nativeGeneration = typeof result.generation === 'number' ? result.generation : -1;
    this.lastNativeEndedSession = -1;

    // Native buffers asynchronously — the poll in startProgressTracking emits
    // 'play'/'playing' once the native player reports isPlaying=true.
    this.setState({ isLoading: true, error: null });
    this.startProgressTracking();
  }

  /**
   * Subscribe once to native media actions, consuming ONLY playback-lifecycle
   * events (ended/error). Transport actions are owned by the audioStore — one
   * handler per concern, so no action is ever processed twice.
   */
  private ensureNativeListener(): void {
    if (this.nativeListenerReady) return;
    this.nativeListenerReady = true;
    backgroundAudio.onMediaAction((event) => {
      if (!this.useNativePlayer) return;
      if (event.action === 'ended') {
        if (this.nativeSessionId !== this.currentPlaybackId) return; // stale engine event
        // Generation guard: a completion delivered after a NEWER play started
        // belongs to the replaced track — dropping it here prevents a double
        // queue advance (the same completion may also arrive via endedPending).
        if (typeof event.generation === 'number' && this.nativeGeneration >= 0 && event.generation !== this.nativeGeneration) return;
        // Dedupe guard: this session's completion was already consumed —
        // either by an earlier live event or by consumeNativeEnded() when the
        // endedPending recovery path took over queue duty.
        if (this.lastNativeEndedSession === this.nativeSessionId) return;
        this.lastNativeEndedSession = this.nativeSessionId;
        // The completion was consumed live — clear the native pending flag so
        // a later reconnect check never advances the queue a second time.
        backgroundAudio.acknowledgeEnded().catch(() => {});
        this.setState({ isPlaying: false, currentTime: 0 });
        this.stopProgressTracking();
        this.emitEnded();
      } else if (event.action === 'error') {
        void this.handleNativeStreamError();
      }
    }).catch(() => { this.nativeListenerReady = false; });
  }

  /**
   * Native stream failure recovery: re-resolve through the existing provider
   * path (bounded — no infinite retry loops), then give up with a normal
   * playback error so the store advances only when recovery genuinely failed.
   */
  private async handleNativeStreamError(): Promise<void> {
    const song = this.state.currentSong;
    const track = this.nativeTrack;
    const playbackId = this.currentPlaybackId;
    if (!song || !this.useNativePlayer) return;

    if (track && this.nativeParams && this.nativeRetryCount < 2) {
      this.nativeRetryCount++;
      log(`Native stream failed — re-resolving (attempt ${this.nativeRetryCount}/2)`);
      let fresh = await this.reExtractFreshParams(track, this.nativeParams);
      if (!fresh) {
        const playable = await resolvePlayableSource(track, { force: true });
        if (playable) {
          const p = playableToEngineParams(playable);
          if (p.mode === 'html') fresh = p;
        }
      }
      if (fresh && this.currentPlaybackId === playbackId && this.useNativePlayer) {
        this.nativeParams = fresh;
        const res = await backgroundAudio.playAudioUrl({
          audioUrl: fresh.src,
          title: song.title,
          artist: song.artist,
          album: song.album || 'MusicApp',
          albumArt: song.coverArt,
          volume: this.state.volume,
        });
        if (this.currentPlaybackId !== playbackId) return;
        if (res.started) {
          this.nativeGeneration = typeof res.generation === 'number' ? res.generation : -1;
          return;
        }
      }
    }

    this.nativeRetryCount = 0;
    if (this.currentPlaybackId === playbackId && this.useNativePlayer) {
      this.emitPlaybackError(song, `Unable to play "${song.title}" — stream failed`);
    }
  }

  /** Poll native playback state — pure UI sync. Playback itself never depends
   *  on this timer: when the WebView is gone the native player keeps going. */
  private async pollNativeState(): Promise<void> {
    if (!this.useNativePlayer) return;
    const st = await backgroundAudio.getPlaybackState();
    if (!this.useNativePlayer) return;
    if (!st.nativeActive) {
      // Native engine is gone (completed / explicit stop / service killed) —
      // stop mirroring so isLoaded() reports false and the store can rebuild.
      this.nativeActiveCache = false;
      this.stopProgressTracking();
      return;
    }
    this.nativeActiveCache = true;
    this.state.currentTime = (st.position || 0) / 1000;
    if (st.duration > 0) this.state.duration = st.duration / 1000;

    if (st.isPlaying && !this.state.isPlaying) {
      this.setState({ isPlaying: true, isLoading: false, error: null });
      this.consecutiveFailures = 0;
      this.emit('playing');
      this.emit('play', { song: this.state.currentSong, playbackId: this.currentPlaybackId });
    }

    const now = Date.now();
    if (now - this.lastProgressNotify >= 500) {
      this.lastProgressNotify = now;
      this.emit('progress', this.state.currentTime);
    }
  }

  private async playHtmlAudio(
    song: Song,
    track: Track,
    initialParams: { mode: 'html'; src: string; isLocalFile: boolean; expiresInMs?: number },
    playbackId: number,
    markId: string,
    isRecovery = false,
  ): Promise<void> {
    const MAX_RETRIES = 3;
    // Proxy/extracted URLs need more time to start streaming than local files
    const CANPLAY_TIMEOUT_MS = initialParams.src.includes('/proxy-audio') ? 10_000 : 8_000;

    // Single ownership chokepoint: whatever engine owned the previous track
    // is released before this one claims playback.
    this.claimEngine('html');
    // Bind element events to THIS session — stale events from the previous
    // track are dropped by the element listeners.
    this.htmlSessionId = playbackId;
    // Fresh playback session (or a recovered attempt): a stale stall timer
    // from a previous stream must not fire into this one.
    if (this.htmlStallTimer) {
      clearTimeout(this.htmlStallTimer);
      this.htmlStallTimer = null;
    }

    let params = initialParams;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (this.currentPlaybackId !== playbackId) return;

      const audio = await this.getHtmlAudio();

      log(`▶ playHtmlAudio attempt ${attempt}/${MAX_RETRIES}:`, {
        title: song.title,
        src: params.src ? `${params.src.substring(0, 80)}` : 'EMPTY',
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
      audio.src = params.src;

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
      // A concurrent recovery claimed this session while we were waiting
      // (e.g. a corrupted local file erroring at startup) — it now owns
      // playback; this attempt loop must stop competing with it.
      if (!isRecovery && this.htmlRecoverySession === playbackId) return;

      if (!canplayOk) {
        logError(`⏱ canplay timeout on attempt ${attempt}/${MAX_RETRIES}`);
        if (attempt < MAX_RETRIES) {
          log('Retrying...');
          // The stream URL is likely stale/expired (403/416 upstream) — force a
          // fresh resolution so the next attempt doesn't reuse the bad URL.
          const fresh = await this.reExtractFreshParams(track, params);
          if (fresh) params = fresh;
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
          const fresh = await this.reExtractFreshParams(track, params);
          if (fresh) params = fresh;
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
   * Force a fresh playable source for a failed play attempt. The cached proxy
   * URL may reference an expired/nerfed Googlevideo URL (403/416) — asking the
   * provider to re-resolve bypasses any cached stream. Only non-local proxy
   * streams are re-resolved (local files never expire).
   */
  private async reExtractFreshParams(
    track: Track,
    current: { mode: 'html'; src: string; isLocalFile: boolean; expiresInMs?: number },
  ): Promise<{ mode: 'html'; src: string; isLocalFile: boolean; expiresInMs?: number } | null> {
    if (current.isLocalFile || !current.src.includes('/proxy-audio')) return null;
    const playable = await resolvePlayableSource(track, { force: true });
    if (!playable) return null;
    const fresh = playableToEngineParams(playable);
    return fresh.mode === 'html' ? fresh : null;
  }

  private async playYouTube(
    song: Song,
    track: Track,
    videoId: string,
    playbackId: number,
    markId: string,
  ): Promise<void> {
    const MAX_YT_RETRIES = 3;

    // Single ownership chokepoint against two engines playing at once.
    this.claimEngine('youtube');

    let bufferingTimer: ReturnType<typeof setTimeout> | null = null;
    const startBufferingTimeout = () => {
      if (bufferingTimer) clearTimeout(bufferingTimer);
      bufferingTimer = setTimeout(() => {
        if (this.currentPlaybackId !== playbackId) return;
        logError('YouTube buffering timeout (>30s) — skipping');
        showToast('Skipping — stream took too long to load.', 'error');
        this.emitEnded();
      }, 30_000);
    };
    const clearBufferingTimeout = () => {
      if (bufferingTimer) { clearTimeout(bufferingTimer); bufferingTimer = null; }
    };

    for (let attempt = 1; attempt <= MAX_YT_RETRIES; attempt++) {
      if (this.currentPlaybackId !== playbackId) return;

      try {
        this.stopYouTubePlayer();
        // The stop above released ownership mid-session — re-claim it so the
        // invariant holds across retry attempts.
        this.claimEngine('youtube');

        log(`▶ playYouTube attempt ${attempt}/${MAX_YT_RETRIES}:`, { title: song.title, videoId });

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
                this.emit('play', { song, playbackId: this.currentPlaybackId });
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
              this.emitEnded();
              break;
            case 'waiting':
              log('YouTube buffering...');
              startBufferingTimeout();
              this.emit('waiting');
              break;
            case 'error': {
              logError('YouTube player error:', data);
              clearBufferingTimeout();
              // By the time an error reaches us the embedded player has
              // exhausted its own bounded internal retries — treat it as
              // terminal for THIS track only. emitPlaybackError marks the
              // track failed and emits ended, which advances the queue
              // through the store's bounded auto-skip path.
              this.emitPlaybackError(
                song,
                `Unable to play "${song.title}" — ${typeof data === 'string' ? data : 'embed error'}`,
              );
              break;
            }
          }
        });

        await youtubePlayerService.load(toSong(track));

        if (this.currentPlaybackId !== playbackId) return;

        youtubePlayerService.markStreamWorking(videoId);

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
        this.emit('loaded', { song, playbackId: this.currentPlaybackId });
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
        // Fallback: ask the provider to re-resolve a direct stream (e.g. fresh
        // extraction) now that the embedded player failed.
        log('Embedded player failed — attempting fresh stream resolution via provider...');
        const fresh = await resolvePlayableSource(track, { force: true });
        if (fresh && this.currentPlaybackId === playbackId) {
          const freshParams = playableToEngineParams(fresh);
          if (freshParams.mode === 'html') {
            log('Provider stream fallback succeeded — playing as HTML audio:', freshParams.src.substring(0, 80));
            this.useYoutubePlayer = false;
            await this.playHtmlAudio(song, track, freshParams, playbackId, markId);
            return;
          }
        }
        this.emitPlaybackError(song, `Cannot play "${song.title}": ${msg}`);
      }
    }
    clearBufferingTimeout();
  }

  private stopCurrentPlayback(): void {
    this.stopProgressTracking();
    this.teardownCrossfadeElement();
    this.stopHtmlAudio();
    this.stopYouTubePlayer();
    this.stopNativePlayback();
    this.activeEngine = 'none';
  }

  /**
   * THE single engine-ownership chokepoint. Starting an engine releases every
   * other engine first — structurally guaranteeing exactly one authoritative
   * playback engine at any moment, regardless of call order or races.
   */
  private claimEngine(engine: Exclude<EngineId, 'none'>): void {
    if (this.activeEngine !== 'none' && this.activeEngine !== engine) {
      if (this.activeEngine === 'native') this.stopNativePlayback();
      else if (this.activeEngine === 'youtube') this.stopYouTubePlayer();
      else this.stopHtmlAudio();
    }
    this.activeEngine = engine;
  }

  /** Clear ownership when the owning engine is released. */
  private releaseEngine(engine: Exclude<EngineId, 'none'>): void {
    if (this.activeEngine === engine) this.activeEngine = 'none';
  }

  private stopNativePlayback(): void {
    if (!this.useNativePlayer && !this.nativeActiveCache) return;
    this.releaseEngine('native');
    this.useNativePlayer = false;
    this.nativeActiveCache = false;
    this.nativeTrack = null;
    this.nativeParams = null;
    this.nativeGeneration = -1;
    backgroundAudio.stopAudio().catch(() => {});
  }

  /**
   * Mark the current native session's completion as ALREADY consumed. Called
   * by the endedPending recovery paths (reconnect/restore) so a duplicate
   * 'ended' notification for the same completion — delivered late, after the
   * queue has already been advanced — is dropped by the listener guard.
   */
  consumeNativeEnded(): void {
    if (this.useNativePlayer) {
      this.lastNativeEndedSession = this.nativeSessionId;
    }
  }

  private stopYouTubePlayer(): void {
    this.releaseEngine('youtube');
    if (this.ytUnsubscribe) {
      this.ytUnsubscribe();
      this.ytUnsubscribe = null;
    }
    youtubePlayerService.stop();
  }

  private stopHtmlAudio(): void {
    this.releaseEngine('html');
    if (this.htmlAudio) {
      this.htmlAudio.pause();
      try { this.htmlAudio.currentTime = 0; } catch {}
      this.htmlAudio.removeAttribute('src');
      try { this.htmlAudio.load(); } catch {}
    }
  }

  // ─────────────────────────── Crossfade (HTML engine only) ───────────────────────────

  /** True when the html <audio> engine owns playback (the only crossfade-capable engine). */
  isHtmlEngineActive(): boolean {
    return this.activeEngine === 'html' && !this.useNativePlayer && !this.useYoutubePlayer && !!this.htmlAudio;
  }

  /** True while the volume ramps between outgoing and incoming are live. */
  isCrossfading(): boolean {
    return this.crossfadePhase === 'fading';
  }

  getCrossfadePhase(): 'idle' | 'prepared' | 'fading' {
    return this.crossfadePhase;
  }

  /**
   * Buffer the next track's stream in a second element under THIS service.
   * Returns true only when the stream is ready to fade in. Every failure
   * mode returns false silently — the normal ended-path then advances the
   * queue exactly as if crossfade were disabled.
   */
  async prepareCrossfadeIn(song: Song): Promise<boolean> {
    // Strictly single-flight: an in-progress prepare/fade is never re-entered.
    if (this.crossfadePhase !== 'idle') return false;
    if (!this.isHtmlEngineActive()) return false;
    if (!song || typeof song.id !== 'string' || !song.id.trim()) return false;
    try {
      const track = toTrack(song);
      const playable = await resolvePlayableSource(track);
      // The session may have been superseded while resolving — abandon.
      if (this.crossfadePhase !== 'idle' || !this.isHtmlEngineActive()) return false;
      if (!playable) return false;
      const params = playableToEngineParams(playable);
      // Iframe-only tracks and native-engine streams cannot participate.
      if (params.mode !== 'html') return false;
      if (this.canUseNativeEngine(params.src, params.isLocalFile)) return false;

      const el = new Audio();
      el.preload = 'auto';
      el.volume = 0; // silent until the fade ramps begin
      el.src = params.src;
      const ok = await this.waitForCanPlay(el, 8_000);
      if (!ok || this.crossfadePhase !== 'idle' || !this.isHtmlEngineActive()) {
        el.removeAttribute('src');
        try { el.load(); } catch {}
        return false;
      }
      this.crossfadeAudio = el;
      this.crossfadeSong = song;
      this.crossfadePhase = 'prepared';
      log('Crossfade prepared:', song.title);
      return true;
    } catch (err) {
      logError('Crossfade prepare failed:', err);
      return false;
    }
  }

  /**
   * THE hand-off: the prepared incoming element becomes the authoritative
   * session NOW. The playback id is bumped and the outgoing element's
   * listeners are detached at this instant — after this point the old track's
   * 'ended' can never reach the store, so a crossfade can never double-advance
   * the queue (manual next and natural ended are structurally exclusive).
   * Returns false (and cleans up) when the hand-off is impossible.
   */
  startCrossfadeIn(fadeSec: number): boolean {
    if (this.crossfadePhase !== 'prepared' || !this.crossfadeAudio || !this.crossfadeSong) return false;
    if (!this.isHtmlEngineActive() || !this.htmlAudio) {
      this.cancelCrossfade();
      return false;
    }
    const outgoing = this.htmlAudio;
    const incoming = this.crossfadeAudio;
    const song = this.crossfadeSong;
    // Captured for rollback if the incoming play() is rejected by autoplay policy.
    const prevSong = this.state.currentSong;
    const prevDuration = this.state.duration;
    const prevTime = this.state.currentTime;
    const outgoingSession = this.htmlSessionId;

    const newSession = ++this.currentPlaybackId;
    this.detachHtmlAudioListeners(); // outgoing can never emit again
    this.htmlSessionId = newSession;
    this.crossfadePhase = 'fading';

    this.setState({
      currentSong: song,
      duration: incoming.duration && isFinite(incoming.duration) ? incoming.duration : song.duration,
      currentTime: 0,
      isLoading: false,
      error: null,
    });

    const fadeMs = Math.max(500, Math.round(fadeSec * 1000));
    const startedAt = Date.now();
    incoming.volume = 0;

    incoming.play().then(() => {
      if (this.currentPlaybackId !== newSession) return; // superseded
      this.consecutiveFailures = 0;
      this.setState({ isPlaying: true });
      this.emit('play', { song, playbackId: newSession });
    }).catch(() => {
      // Autoplay rejected — roll back to the outgoing track so playback
      // continues seamlessly without a crossfade; its natural ended still
      // advances the queue through the normal path.
      if (this.currentPlaybackId !== newSession) return; // a newer command owns teardown
      this.teardownCrossfadeElement();
      // Full session rollback — the outgoing track is live again exactly as
      // before the fade, so its natural 'ended' must still reach the store.
      this.currentPlaybackId = outgoingSession;
      this.htmlSessionId = outgoingSession;
      this.attachHtmlAudioListeners();
      this.setState({ currentSong: prevSong, duration: prevDuration, currentTime: prevTime });
      logError('Crossfade play() rejected — rolled back to outgoing track');
    });

    // Volume ramps — BOTH elements follow the live master volume so a volume
    // change mid-fade applies to the blend, not just one side.
    this.crossfadeRampTimer = setInterval(() => {
      if (this.crossfadePhase !== 'fading') return;
      const t = Math.min(1, (Date.now() - startedAt) / fadeMs);
      const base = this.state.volume;
      outgoing.volume = base * (1 - t);
      incoming.volume = base * t;
      // Progress follows the incoming track during the fade.
      this.state.currentTime = incoming.currentTime || 0;
      if (incoming.duration && isFinite(incoming.duration)) this.state.duration = incoming.duration;
      const now = Date.now();
      if (now - this.lastProgressNotify >= 500) {
        this.lastProgressNotify = now;
        this.emit('progress', this.state.currentTime);
      }
      if (t >= 1) this.promoteCrossfade();
    }, 100);

    log('Crossfade started:', { title: song.title, fadeMs });
    return true;
  }

  /**
   * Complete the fade instantly: promote the incoming element to THE html
   * element of this service. Called by pause/seek/play when they interrupt a
   * fade — a half-finished crossfade must never survive a user command.
   */
  finishCrossfadeNow(): void {
    if (this.crossfadePhase === 'fading') this.promoteCrossfade();
    else if (this.crossfadePhase === 'prepared') this.teardownCrossfadeElement();
  }

  /** Silently discard a prepared/fading crossfade without promoting. */
  cancelCrossfade(): void {
    this.teardownCrossfadeElement();
  }

  /** Swap the incoming element into the htmlAudio slot and release the outgoing one. */
  private promoteCrossfade(): void {
    if (this.crossfadeRampTimer !== null) {
      clearInterval(this.crossfadeRampTimer);
      this.crossfadeRampTimer = null;
    }
    const incoming = this.crossfadeAudio;
    if (!incoming) {
      this.crossfadePhase = 'idle';
      return;
    }
    const outgoing = this.htmlAudio;
    if (outgoing) {
      // Listeners were detached at fade start — silence and release it.
      try { backgroundPlaybackService.unregisterAudioElement(outgoing); } catch {}
      outgoing.pause();
      outgoing.removeAttribute('src');
      try { outgoing.load(); } catch {}
    }
    this.htmlAudio = incoming;
    this.crossfadeAudio = null;
    this.crossfadeSong = null;
    this.crossfadePhase = 'idle';
    this.attachHtmlAudioListeners();
    try { backgroundPlaybackService.registerAudioElement(incoming); } catch {}
    incoming.volume = this.state.volume;
    // The element changed — the EQ must re-bind its single media source to it.
    audioEffectsService.init(incoming).catch(() => {});
    this.setState({ isPlaying: !incoming.paused });
    log('Crossfade promoted — incoming element is now the html engine');
  }

  /** Stop and dispose the incoming element in ANY phase. */
  private teardownCrossfadeElement(): void {
    if (this.crossfadeRampTimer !== null) {
      clearInterval(this.crossfadeRampTimer);
      this.crossfadeRampTimer = null;
    }
    const el = this.crossfadeAudio;
    this.crossfadeAudio = null;
    this.crossfadeSong = null;
    this.crossfadePhase = 'idle';
    if (el) {
      // Unregister BEFORE clearing the source so the resulting 'emptied'
      // event is never mistaken for an audio-route interruption.
      try { backgroundPlaybackService.unregisterAudioElement(el); } catch {}
      el.pause();
      el.removeAttribute('src');
      try { el.load(); } catch {}
    }
  }

  private startProgressTracking(): void {
    this.stopProgressTracking();
    this.lastProgressNotify = 0;
    if (this.useNativePlayer) {
      this.progressInterval = setInterval(() => { void this.pollNativeState(); }, 500);
      return;
    }
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
    // Pause never leaves a half-finished crossfade: complete a fade instantly
    // (then pause the promoted track) or discard a prepared-but-not-started
    // one (its stream will be re-prepared on the next trigger window).
    if (this.crossfadePhase === 'fading') this.finishCrossfadeNow();
    else if (this.crossfadePhase === 'prepared') this.cancelCrossfade();
    // A user pause while a play is still resolving must win the race against
    // the async play pipeline — invalidate the in-flight playback id.
    if (this.state.isLoading) this.currentPlaybackId++;
    if (this.useNativePlayer) {
      backgroundAudio.pauseAudio().catch(() => {});
    } else if (this.useYoutubePlayer) {
      youtubePlayerService.pause();
    } else if (this.htmlAudio) {
      this.htmlAudio.pause();
    }
    if (this.state.isPlaying || this.state.isLoading) {
      this.setState({ isPlaying: false, isLoading: false });
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

    if (this.useNativePlayer) {
      const st = await backgroundAudio.getPlaybackState();
      if (!st.nativeActive) {
        // Native engine lost (service killed/recreated while paused). Throw
        // instead of silently returning: callers rebuild playback from the
        // queue — a silent return leaves the play button permanently dead.
        this.releaseEngine('native');
        this.useNativePlayer = false;
        this.nativeActiveCache = false;
        throw new Error('Native playback is no longer available');
      }
      await backgroundAudio.resumeAudio();
      this.setState({ isPlaying: true, error: null });
      this.startProgressTracking();
      // Tagged with the session id like every other 'play' emission so the
      // store's stale-session filter applies uniformly.
      this.emit('play', { song: this.state.currentSong, playbackId: this.currentPlaybackId });
      return;
    }

    if (this.useYoutubePlayer) {
      youtubePlayerService.play();
      return;
    }

    if (this.htmlAudio && this.htmlAudio.src) {
      const playbackId = this.currentPlaybackId;
      // Resume continues the current session — rebind element events to it so
      // a pause-during-load (which bumped the id) doesn't orphan the element.
      this.htmlSessionId = playbackId;
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
        this.emit('play', { song: this.state.currentSong, playbackId: this.currentPlaybackId });
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
    this.activeEngine = 'none';
    this.setState({ 
      isPlaying: false, currentTime: 0, currentSong: null,
      isLoading: false, error: null
    });
    if (isNativePlatform()) {
      try { backgroundAudio.stopService().catch(() => {}); } catch {}
    }
  }

  seek(seconds: number): void {
    // Same invariant as pause(): a seek resolves any crossfade first so the
    // command always acts on exactly one authoritative element.
    if (this.crossfadePhase === 'fading') this.finishCrossfadeNow();
    else if (this.crossfadePhase === 'prepared') this.cancelCrossfade();
    const maxDur = this.useYoutubePlayer ? this.getDuration() : this.state.duration;
    const clamped = Math.max(0, Math.min(seconds, maxDur || 0));
    this.state.currentTime = clamped;
    if (this.useNativePlayer) {
      // Native player seeks in MILLISECONDS.
      backgroundAudio.seekAudio({ position: Math.round(clamped * 1000) }).catch(() => {});
    } else if (this.useYoutubePlayer) {
      youtubePlayerService.seek(clamped);
    } else if (this.htmlAudio) {
      this.htmlAudio.currentTime = clamped;
    }
  }

  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.state.volume = clamped;
    if (this.useNativePlayer) {
      backgroundAudio.setVolume({ volume: clamped }).catch(() => {});
    } else if (this.useYoutubePlayer) {
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
    if (this.useNativePlayer) return this.nativeActiveCache;
    if (this.useYoutubePlayer) {
      return youtubePlayerService.getCurrentSongId() !== null;
    }
    return !!(this.htmlAudio && this.htmlAudio.src && this.htmlAudio.readyState > 0);
  }

  /** True while the native Android MediaPlayer owns playback. */
  isNativeEngineActive(): boolean {
    return this.useNativePlayer;
  }

  /** Mirror an externally-applied native seek (MediaSession/lock screen) into
   *  JS state WITHOUT issuing a second seek command to the engine. */
  syncExternalPosition(seconds: number): void {
    if (!this.useNativePlayer) return;
    this.state.currentTime = Math.max(0, seconds);
    this.emit('progress', this.state.currentTime);
  }

  /**
   * Adopt an already-running native playback session (WebView/Activity was
   *   recreated while the foreground service kept playing). The native player
   *   is NOT touched — JS only re-attaches state mirroring.
   */
  adoptNativePlayback(song: Song, opts: { positionSec: number; durationSec: number; isPlaying: boolean; generation?: number }): void {
    this.currentPlaybackId++;
    // Claim native ownership — releases any html/youtube engine still holding
    // a session from before the WebView recreation.
    this.claimEngine('native');
    this.ensureNativeListener();
    this.useYoutubePlayer = false;
    this.useNativePlayer = true;
    this.nativeActiveCache = true;
    this.nativeRetryCount = 0;
    this.nativeSessionId = this.currentPlaybackId;
    // Bind this JS session to the native session being adopted so lifecycle
    // events can be generation-checked; unknown generation disables that check
    // (session guards still apply).
    this.nativeGeneration = typeof opts.generation === 'number' ? opts.generation : -1;
    this.lastNativeEndedSession = -1;
    this.setState({
      currentSong: song,
      isPlaying: opts.isPlaying,
      currentTime: opts.positionSec,
      duration: opts.durationSec > 0 ? opts.durationSec : song.duration,
      isLoading: false,
      error: null,
    });
    this.startProgressTracking();
    this.emit('loaded', { song, playbackId: this.currentPlaybackId });
  }
  getConsecutiveFailures(): number { return this.consecutiveFailures; }
  resetConsecutiveFailures(): void { this.consecutiveFailures = 0; }

  destroy(): void {
    this.currentPlaybackId++;
    this.stopProgressTracking();
    this.teardownCrossfadeElement();
    this.stopHtmlAudio();
    this.stopYouTubePlayer();
    // NOTE: native playback is intentionally NOT stopped here — the React /
    // WebView lifecycle must never destroy playback.
    this.activeEngine = 'none';
    this.useNativePlayer = false;
    this.nativeActiveCache = false;
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
