import { create } from 'zustand';
import { Song } from '../types/music';
import { useQueueStore } from './queueStore';
import { useDownloadsStore } from './downloadsStore';
import { audioService } from '../services/audioServiceInstance';
import { mediaSessionService } from '../services/mediaSessionService';
import { playbackPersistenceService } from '../services/playbackPersistenceService';
import { backgroundPlaybackService } from '../services/backgroundPlaybackService';
import { backgroundAudio } from '../services/backgroundAudio';
import { useHistoryStore } from './historyStore';
import { preloadNextSongs, prewarmOnFirstInteraction, warmNextTrackServerCache, cancelNextTrackPreload } from '../services/preloadService';
import { registerLocalCopyResolver } from '../providers/resolve';
import { findVerifiedReplacement } from '../services/smartReplaceService';
import { resolvePlayableSong, sourceKey, stripStaleBlobUrl, isDownloadedSong } from '../services/musicSource';
import { showToast } from '../utils/toast';
import { logger } from '../utils/logger';
import { deferIdle } from '../utils/idle';

// Offline playback bridge: resolution (and the engine's stream-failure
// recovery) can ask the download system for a track's stored local copy.
// Imported from providers/resolve directly — no barrel side effects.
registerLocalCopyResolver((track) => {
  try {
    const key = track.externalId || track.id;
    return key ? useDownloadsStore.getState().getBlobUrl(key) : null;
  } catch {
    return null;
  }
});

const LOADING_TIMEOUT_MS = 15_000;
let loadingTimeoutId: ReturnType<typeof setTimeout> | null = null;
let initPromise: Promise<void> | null = null;

function startLoadingTimeout() {
  if (loadingTimeoutId) clearTimeout(loadingTimeoutId);
  loadingTimeoutId = setTimeout(() => {
    const { isLoading } = useAudioStore.getState();
    if (isLoading) {
      logger.warn('[AudioStore] Loading timeout — forcing isLoading=false');
      useAudioStore.setState({ isLoading: false, isPlaying: false, error: 'Loading timed out' });
    }
    loadingTimeoutId = null;
  }, LOADING_TIMEOUT_MS);
}

function clearLoadingTimeout() {
  if (loadingTimeoutId) {
    clearTimeout(loadingTimeoutId);
    loadingTimeoutId = null;
  }
}

export interface AudioStore {
  currentSong: Song | null;
  isPlaying: boolean;
  volume: number;
  isLoading: boolean;
  error: string | null;
  progress: number;
  duration: number;
  favorites: string[];

  loadSong: (song: Song, playlist: Song[], index: number, preserveShuffle?: boolean) => void;
  retry: () => void;
  play: () => void;
  pause: () => void;
  togglePlayPause: () => void;
  nextSong: () => void;
  previousSong: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  toggleFavorite: (songId: string) => void;
  restoreFromPersistence: () => void;
}

function loadFavorites(): string[] {
  try {
    return (JSON.parse(localStorage.getItem('favorites') || '[]') as string[])
      .filter(Boolean)
      .map(id => id.startsWith('t-') ? id.slice(2) : id);
  } catch {
    return [];
  }
}
function saveFavorites(favs: string[]) {
  try { localStorage.setItem('favorites', JSON.stringify(favs)); } catch {}
}

function loadVolume(): number {
  try {
    const v = localStorage.getItem('volume');
    if (v !== null) {
      const parsed = parseFloat(v);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) return parsed;
    }
  } catch { }
  return 0.7;
}

function saveVolume(vol: number) {
  try { localStorage.setItem('volume', String(vol)); } catch { }
}

/**
 * Resolve a song's audio URL from downloads if available.
 * Delegates to the unified source abstraction — downloaded songs play from
 * their local blob, stale blob: URLs are dropped, online songs pass through.
 */
function resolveDownloadUrl(song: Song): Song {
  return resolvePlayableSong(song);
}

/**
 * Resolve an entire queue array, injecting blob URLs for any downloaded songs.
 * After an app restart `blobUrlCache` is empty, so we call getBlobUrl() which
 * creates ObjectURLs on-demand from the persisted IndexedDB blobs.
 * Uses a Map for O(1) lookups to avoid repeated linear scans.
 */
function resolveQueueDownloads(queue: Song[]): Song[] {
  const downloadsStore = useDownloadsStore.getState();
  const resolvedMap = new Map<string, string>();
  let resolved = false;
  const result = queue.map(song => {
    const key = sourceKey(song);
    // Check cache first (fast path)
    const cached = resolvedMap.get(key);
    if (cached) {
      resolved = true;
      return { ...song, audioUrl: cached };
    }
    // getBlobUrl() creates the ObjectURL on-demand from IndexedDB blob data
    const blobUrl = downloadsStore.getBlobUrl(key);
    if (blobUrl) {
      resolvedMap.set(key, blobUrl);
      resolved = true;
      return { ...song, audioUrl: blobUrl };
    }
    // Stale blob: URL with no backing download — drop it (see resolvePlayableSong).
    const stripped = stripStaleBlobUrl(song);
    if (stripped !== song) {
      resolved = true;
      return stripped;
    }
    return song;
  });
  return resolved ? result : queue;
}

function persistPlaybackState() {
  const audioState = useAudioStore.getState();
  const queueState = useQueueStore.getState();
  playbackPersistenceService.saveImmediate({
    currentSong: audioState.currentSong,
    queue: queueState.queue,
    currentIndex: queueState.currentIndex,
    progress: audioService.getCurrentTime(),
    duration: audioService.getDuration(),
    volume: audioState.volume,
    isShuffled: queueState.isShuffled,
    repeatMode: queueState.repeatMode,
    originalQueue: queueState.originalQueue,
  });
}

// Single-registration guard for EVERY global listener (native media actions,
// interruption/reconnect/background, persist interval, queue subscription).
// Registration must happen exactly once — duplicate native media-action
// listeners cause double play/pause and double next/previous transitions.
let globalListenersRegistered = false;
let lastMediaUpdate = 0;
let lastProgressUpdate = 0;
let lastProgressPersist = 0;
const PROGRESS_THROTTLE_MS = 250;
const MAX_CONSECUTIVE_FAILURES = 5;
let consecutivePlayFailures = 0;
let nextSongRetryTimeout: ReturnType<typeof setTimeout> | null = null;
let isNextSongPending = false;
let isPreviousSongPending = false;
// ── Smart replacement state ──
// Exactly ONE replacement attempt per failed playback command: the command
// sequence of the failed play is consumed by the attempt, so a second
// failure in the same command (e.g. the replacement itself fails) can never
// retrigger replacement — it falls straight through to the bounded
// auto-skip. Never retry forever.
let smartReplaceBusy = false;
let smartReplaceConsumedSeq = -1;
let pendingResumePosition: number | null = null;
let lastHistorySongId: string | null = null;
let volumePersistTimer: ReturnType<typeof setTimeout> | null = null;
let advanceChain: Promise<void> = Promise.resolve();
let serviceRequestedPlay = false;
// Monotonic command sequence — every authoritative transport transition
// (song click, next, previous, retry, resume) claims a new number. Async
// work that outlives its command re-checks the sequence before touching
// state, so a stale operation can never overwrite a newer command. This is
// the deterministic replacement for arbitrary setTimeout delays.
let commandSeq = 0;
// Playback sessions whose 'ended' event was already consumed — the same
// ended track can never trigger two next-transitions.
let lastHandledEndedSession = -1;
// ── Crossfade trigger state ──
// The automatic fade claims exactly ONE playback session. A manual next, a
// failed prepare, or a completed fade all consume the claim — the same end
// window can never trigger the crossfade twice.
let crossfadeClaimedSession = -1;
let isCrossfadePreparing = false;

function scheduleVolumePersist(vol: number) {
  if (volumePersistTimer) clearTimeout(volumePersistTimer);
  volumePersistTimer = setTimeout(() => {
    saveVolume(vol);
    volumePersistTimer = null;
  }, 300);
}

function chainAdvance(fn: () => Promise<void>): Promise<void> {
  const next = advanceChain.then(fn, fn);
  // Reset after the chained promise settles — not immediately — to prevent
  // a second chainAdvance call from slipping in before the first one's
  // promise handler has been installed.
  advanceChain = next.then(() => {}, () => {});
  return next;
}

function syncMediaSessionEnded() {
  try { mediaSessionService.updatePlaybackState(false, 0, 0); } catch {}
  try { backgroundAudio.updatePlaybackState({ isPlaying: false, position: 0, duration: 0 }).catch(() => {}); } catch {}
}

/**
 * Reconcile JS state with the native foreground engine after returning to
 * the foreground (or after any temporary JS disconnect). Engine events that
 * fired while JS was unreachable are lost on the bridge — this re-reads the
 * authoritative native state deterministically:
 *   - native still owns playback → re-sync / adopt (UI follows the engine)
 *   - a track ENDED while disconnected → continue the queue exactly once
 */
async function reconcileNativeState(): Promise<void> {
  if (typeof window === 'undefined' || !(window as any).Capacitor) return;
  try {
    const playbackIdBefore = audioService.getCurrentPlaybackId();
    const st = await backgroundAudio.getPlaybackState();
    // A user command COMPLETED while the state was being fetched — it owns
    // playback now; a stale native snapshot must not overwrite it.
    if (audioService.getCurrentPlaybackId() !== playbackIdBefore) return;
    const store = useAudioStore.getState();
    // A play resolution is in flight — it owns the transition; adopting or
    // advancing underneath it would invalidate or double-skip it.
    if (store.isLoading) return;
    if (st.nativeActive) {
      const positionSec = Math.max(0, (st.position || 0) / 1000);
      if (audioService.isNativeEngineActive()) {
        // Already mirroring — plain position/state sync.
        audioService.syncExternalPosition(positionSec);
        useAudioStore.setState({ isPlaying: st.isPlaying, progress: positionSec });
        return;
      }
      // A non-native engine (or nothing) owns JS state while the native
      // player is live. Only adopt if JS is idle — never stomp on an active
      // HTML session.
      if (store.isPlaying) return;
      const current = store.currentSong;
      if (!current) return;
      const durationSec = st.duration > 0 ? st.duration / 1000 : (current.duration || 0);
      audioService.adoptNativePlayback(current, { positionSec, durationSec, isPlaying: st.isPlaying, generation: st.generation });
      useAudioStore.setState({ isPlaying: st.isPlaying, progress: positionSec, duration: durationSec });
      return;
    }
    if (st.endedPending && store.currentSong) {
      if (store.isPlaying) {
        // Stale flag — something is actively playing; just clear it so it can
        // never fire over a deliberate user action.
        backgroundAudio.acknowledgeEnded().catch(() => {});
        return;
      }
      // A track completed while JS was disconnected — take over queue duty
      // exactly once. consumeNativeEnded() makes a late duplicate 'ended'
      // notification for this completion a no-op in the engine listener.
      audioService.consumeNativeEnded();
      backgroundAudio.acknowledgeEnded().catch(() => {});
      store.nextSong();
    }
  } catch {}
}

function clearNextSongRetry() {
  if (nextSongRetryTimeout) {
    clearTimeout(nextSongRetryTimeout);
    nextSongRetryTimeout = null;
  }
}

function initAudioServiceHandler() {
  // Use initPromise pattern to make init atomic — prevents double-subscription
  // from concurrent loadSong calls and across HMR reloads.
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (globalListenersRegistered) return;
    globalListenersRegistered = true;

    audioService.subscribe((event, data) => {
      const state = useAudioStore.getState();

      switch (event) {
        case 'play': {
          // Stale-session guard: events from a superseded playback session
          // (an old track) must never rewrite the current track's state.
          if (data?.playbackId != null && data.playbackId !== audioService.getCurrentPlaybackId()) break;
          clearNextSongRetry();
          if (data?.song) {
            consecutivePlayFailures = 0;
          }
          const newSong = data?.song ?? state.currentSong;
          useAudioStore.setState({
            isPlaying: true,
            isLoading: false,
            currentSong: newSong,
            duration: audioService.getDuration(),
            error: null,
          });
          if (data?.song) {
            try { mediaSessionService.updateMetadata(data.song); } catch {}
            try { mediaSessionService.updatePlaybackState(true, audioService.getCurrentTime(), audioService.getDuration()); } catch {}
            try { backgroundAudio.updateMetadata({
              title: data.song.title,
              artist: data.song.artist,
              album: data.song.album || 'MusicApp',
              albumArt: data.song.coverArt,
            }).catch(() => {}); } catch {}
            try { backgroundAudio.updatePlaybackState({
              isPlaying: true,
              position: audioService.getCurrentTime(),
              duration: audioService.getDuration(),
            }).catch(() => {}); } catch {}
            if (data?.song) {
              const songId = data.song.id || '';
              if (songId !== lastHistorySongId) {
                lastHistorySongId = songId;
                useHistoryStore.getState().addSong(data.song);
              }
              const qs = useQueueStore.getState();
              const resolvedQueue = resolveQueueDownloads(qs.queue);
              // count: 1 — each preloaded stream spawns a yt-dlp process on
              // the 1-CPU server; 3 concurrent extractions starve search.
              preloadNextSongs(resolvedQueue, qs.currentIndex, { count: 1 }).catch(() => {});
              // Server-side warm for *exactly* the next track — single slot,
              // PRELOAD priority so PLAY jumps ahead, no audible player.
              try {
                const nextForWarm = (qs as any).peekNextSong ? (qs as any).peekNextSong() : (resolvedQueue[qs.currentIndex + 1] || null);
                void warmNextTrackServerCache(nextForWarm, { isDownloaded: isDownloadedSong });
              } catch {}
            }
          }
          break;
        }
        case 'loaded': {
          // NOTE: deliberately NO preloading here. Preloading during 'loaded'
          // spawns concurrent yt-dlp extractions on the 1-CPU Render server,
          // starving search/stream/download (the v2.5.54 regression).
          // Preloading happens once playback starts ('play' below).
          break;
        }
        case 'playing': {
          clearNextSongRetry();
          consecutivePlayFailures = 0;
          useAudioStore.setState({ isPlaying: true, isLoading: false });
          break;
        }
        case 'pause':
          clearLoadingTimeout();
          useAudioStore.setState({ isPlaying: false, isLoading: false });
          try { mediaSessionService.updatePlaybackState(false, audioService.getCurrentTime(), audioService.getDuration()); } catch {}
          break;
        case 'ended': {
          // Each playback session's 'ended' is consumed EXACTLY once — an
          // ended track can never trigger two next-transitions, and an old
          // track ending after a newer one started is ignored entirely.
          // Every event is bound to a session — tagged by the engine, or
          // bound to the CURRENT session when a caller omitted the tag — so
          // the dedupe applies uniformly and an untagged duplicate can never
          // slip through.
          const session = typeof data?.playbackId === 'number'
            ? data.playbackId
            : audioService.getCurrentPlaybackId();
          if (session === lastHandledEndedSession) break;
          if (session !== audioService.getCurrentPlaybackId()) break;
          lastHandledEndedSession = session;
          // A FAILURE also ends via this event (error set just before).
          // First try the BOUNDED smart-replacement gate (one verified
          // alternative source per failed command); everything it cannot
          // handle routes to the bounded auto-skip — never replay a failed
          // track on repeat-one and never loop an all-failing queue.
          const failed = useAudioStore.getState().error != null;
          if (failed) {
            maybeSmartReplaceThenSkip();
            break;
          }
          const repeatMode = useQueueStore.getState().repeatMode;
          if (repeatMode === 'one') {
            const currentSong = useAudioStore.getState().currentSong;
            if (currentSong) {
              const queue = useQueueStore.getState().queue;
              const idx = useQueueStore.getState().currentIndex;
              audioService.play(currentSong, queue, idx).catch((err) => {
                logger.error('[AudioStore] repeat-one play() failed:', err);
                clearLoadingTimeout();
                useAudioStore.setState({ isLoading: false, isPlaying: false, error: 'Playback failed' });
                autoSkipNextSong();
              });
            }
          } else {
            useAudioStore.getState().nextSong();
          }
          break;
        }
        case 'progress': {
          if (typeof data !== 'number') return;
          // Crossfade trigger — evaluated on EVERY engine tick and must not
          // be blocked by the UI progress throttle; it is internally gated
          // to run once per playback session. The window can open at any
          // moment, and a dropped tick would delay the fade preparation.
          maybeTriggerCrossfade(data);
          const now = Date.now();
          if (now - lastProgressUpdate < PROGRESS_THROTTLE_MS) return;
          lastProgressUpdate = now;
          useAudioStore.setState({ progress: data });
          if (now - lastMediaUpdate > 1000) {
            lastMediaUpdate = now;
            try { mediaSessionService.updatePlaybackState(
              useAudioStore.getState().isPlaying,
              data,
              audioService.getDuration(),
            ); } catch {}
            try { backgroundAudio.updatePlaybackState({
              isPlaying: useAudioStore.getState().isPlaying,
              position: data,
              duration: audioService.getDuration(),
            }).catch(() => {}); } catch {}
          }
          if (now - lastProgressPersist > 5_000) {
            lastProgressPersist = now;
            persistPlaybackState();
          }
          break;
        }
        case 'loaded': {
          if (data?.playbackId != null && data.playbackId !== audioService.getCurrentPlaybackId()) break;
          const newSong = data?.song ?? state.currentSong;
          useAudioStore.setState({
            currentSong: newSong,
            duration: audioService.getDuration(),
            error: null,
          });
          if (data?.song) {
            try { mediaSessionService.updateMetadata(data.song); } catch {}
          }
          break;
        }
        case 'error':
          logger.error('[AudioStore] Playback error:', data);
          clearLoadingTimeout();
          useAudioStore.setState({
            error: typeof data === 'string' ? data : 'Playback error',
            isLoading: false,
            // Playback has failed — never leave the UI showing a fake PLAYING
            // state. The 'play'/'playing' events will restore it on recovery.
            isPlaying: false,
          });
          break;
        case 'waiting':
          useAudioStore.setState({ isLoading: true });
          startLoadingTimeout();
          break;
        case 'canplay':
          clearLoadingTimeout();
          useAudioStore.setState({ isLoading: false });
          break;
      }
    });

    // ── Native media actions — THE single registration site. The native
    // MediaSession (Bluetooth, lock screen, notification, system controls)
    // funnels every transport command through this one listener.
    try { backgroundAudio.onMediaAction((event) => {
        const store = useAudioStore.getState();
        switch (event.action) {
          case 'play':
            if (!store.currentSong) {
              serviceRequestedPlay = true;
              return;
            }
            if (store.isPlaying || store.isLoading) return;
            store.play();
            break;
          case 'pause':
          case 'stop':
            serviceRequestedPlay = false;
            store.pause();
            break;
          case 'next':
            store.nextSong();
            break;
          case 'previous':
            store.previousSong();
            break;
          case 'seek': {
            // Native MediaSession seek positions are MILLISECONDS and the
            // native player has already applied the seek — when the native
            // engine owns playback only mirror the position, never seek again.
            if (typeof event.position !== 'number' || !Number.isFinite(event.position)) break;
            const seconds = event.position / 1000;
            if (audioService.isNativeEngineActive()) {
              audioService.syncExternalPosition(seconds);
              useAudioStore.setState({ progress: seconds });
            } else {
              store.seek(seconds);
            }
            break;
          }
          // 'ended' / 'error' are consumed by AudioService's native listener
          // and re-emitted through the audioService event channel — handling
          // them here too would process every completion twice.
        }
      }).catch(() => {}); } catch {}

    try {
      backgroundPlaybackService.onInterruption((type) => {
        if (type === 'headphone-unplug' || type === 'bluetooth-disconnect') {
          useAudioStore.getState().pause();
        }
      });
    } catch {}

    try {
      backgroundPlaybackService.onReconnect(() => {
        const state = useAudioStore.getState();
        if (state.currentSong && !state.isPlaying) {
          audioService.resume().catch(() => {});
        }
      });
    } catch {}

    try {
      backgroundPlaybackService.onBackgroundChange((isBackground) => {
        if (isBackground) {
          // WebView timers stop in the background — a half-finished ramp
          // would freeze with both elements audible. Complete it instantly.
          try { if (audioService.isCrossfading()) audioService.finishCrossfadeNow(); } catch {}
          // Flush the debounced queue write synchronously — the WebView may
          // be suspended before the 500ms timer fires, and a queue mutation
          // from the last moment must not be lost across the transition.
          try { useQueueStore.getState().flushPersist(); } catch {}
          persistPlaybackState();
        } else {
          // Foreground return — engine events may have been lost during the
          // disconnect; re-read the authoritative native state.
          void reconcileNativeState();
        }
      });
    } catch {}

    // ── Network recovery: if playback parked in an ERROR state (bounded
    // retries exhausted while offline), retry the current track the moment
    // connectivity returns. Never fires on intentional pause or while a
    // transition is in flight.
    try {
      if (typeof window !== 'undefined') {
        window.addEventListener('online', () => {
          const s = useAudioStore.getState();
          if (s.error && s.currentSong && !s.isPlaying && !s.isLoading) {
            s.retry();
          }
        });
      }
    } catch {}

    // ── Persist every 10s while playing
    const persistIntervalId = setInterval(() => {
      try {
        const state = useAudioStore.getState();
        if (state.isPlaying && state.currentSong) {
          persistPlaybackState();
        }
      } catch {}
    }, 10_000); // Persist every 10s while playing (was 30s)
    if ((globalThis as any).__audioPersistInterval) {
      clearInterval((globalThis as any).__audioPersistInterval);
    }
    (globalThis as any).__audioPersistInterval = persistIntervalId;

    // ── Queue store subscription for media session actions
    useQueueStore.subscribe((state) => {
      try {
        mediaSessionService.updateActions(
          state.currentIndex < state.queue.length - 1,
          state.currentIndex > 0,
        );
      } catch {}
    });

    // ── Next-track preload lifecycle ──
    // Exactly one background warm at a time, cancelled when the queue or
    // current track changes (stale next), on multi-skip, or on destroy.
    let lastNextTrackId: string | null = null;
    useQueueStore.subscribe((state) => {
      try {
        const next = (state as any).peekNextSong ? (state as any).peekNextSong() : (state.queue[state.currentIndex + 1] || null);
        const nid = next?.id || null;
        if (nid !== lastNextTrackId) {
          lastNextTrackId = nid;
          // Queue reshaped (add/remove/reorder/shuffle) — old next is stale.
          // The play-path will re-warm the correct next; just cancel here.
          try { cancelNextTrackPreload(); } catch {}
        }
      } catch {}
    });
    // Destroy / background teardown — ensure no leaked fetch keeps slot busy.
    try {
      if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', () => { try { cancelNextTrackPreload(); } catch {} });
        // HMR dispose (Vite) — cancelled when store module is replaced.
        if ((import.meta as any).hot) {
          (import.meta as any).hot.dispose(() => { try { cancelNextTrackPreload(); } catch {} });
        }
      }
    } catch {}
  })();
}

// Guard against double-init on HMR — wrapped in try/catch so module-level failures
// don't crash the entire app in Capacitor WebView.
// DEFERRED: All service inits run after first paint via requestIdleCallback.
if (!(globalThis as any).__audioStoreInitialized) {
  (globalThis as any).__audioStoreInitialized = true;

  deferIdle(() => {
    try { prewarmOnFirstInteraction(); } catch {}

    try {
      mediaSessionService.init({
        onPlay: () => useAudioStore.getState().play(),
        onPause: () => useAudioStore.getState().pause(),
        onNext: () => useAudioStore.getState().nextSong(),
        onPrevious: () => useAudioStore.getState().previousSong(),
        onSeekForward: () => {
          useAudioStore.getState().seek(Math.min(audioService.getCurrentTime() + 10, audioService.getDuration()));
        },
        onSeekBackward: () => {
          useAudioStore.getState().seek(Math.max(audioService.getCurrentTime() - 10, 0));
        },
        onSeekTo: (time: number) => {
          useAudioStore.getState().seek(time);
        },
        onStop: () => useAudioStore.getState().pause(),
      });
    } catch {}

    try { backgroundPlaybackService.init(); } catch {}

    // All global listener registrations live in initAudioServiceHandler — it
    // is the ONE registration site, guarded against double-init.
    try {
      initAudioServiceHandler();
    } catch {}
  });
}

/**
 * Smart-replacement gate for a failed track. Makes exactly ONE bounded
 * attempt to swap in a verified alternative source (same song, different
 * stream) while preserving the failed song's metadata. Every outcome that
 * cannot replace the stream routes to the bounded auto-skip, so one failed
 * track can never stall or loop the queue. A user command issued while the
 * attempt is in flight owns the player — the attempt then aborts silently.
 */
function maybeSmartReplaceThenSkip(): void {
  const failedSong = useAudioStore.getState().currentSong;
  if (!failedSong) return;
  // One attempt per failed command, never concurrent attempts.
  if (smartReplaceBusy || commandSeq === smartReplaceConsumedSeq) {
    autoSkipNextSong();
    return;
  }
  smartReplaceBusy = true;
  smartReplaceConsumedSeq = commandSeq;
  const seq = commandSeq;
  void (async () => {
    try {
      const result = await findVerifiedReplacement(failedSong);
      if (seq !== commandSeq) return; // superseded by a user command
      if (result.status === 'replaced' && result.replacement) {
        const qs = useQueueStore.getState();
        const resolvedQueue = resolveQueueDownloads(qs.queue);
        clearLoadingTimeout();
        // Same queue slot — only the stream source changed; title/artist/
        // album are preserved by the replacement service.
        useAudioStore.setState({
          currentSong: result.replacement,
          progress: 0,
          isLoading: true,
          error: null,
        });
        startLoadingTimeout();
        showToast('Stream failed — switched to an alternate source', 'info');
        audioService.play(result.replacement, resolvedQueue, qs.currentIndex).catch(err => {
          if (seq !== commandSeq) return; // superseded by a newer command
          const msg = err instanceof Error ? err.message : 'Playback failed';
          logger.error('[AudioStore] smart-replace play() failed:', msg);
          clearLoadingTimeout();
          useAudioStore.setState({ error: msg, isLoading: false, isPlaying: false });
          autoSkipNextSong();
        });
        return;
      }
      autoSkipNextSong();
    } catch (err) {
      logger.error('[AudioStore] smart replacement error:', err);
      if (seq === commandSeq) autoSkipNextSong();
    } finally {
      smartReplaceBusy = false;
    }
  })();
}

function autoSkipNextSong() {
  clearNextSongRetry();
  const state = useAudioStore.getState();
  if (!state.currentSong) return;
  if (isNextSongPending) return;  // Prevent duplicate next-song transitions
  
  consecutivePlayFailures++;
  
  if (consecutivePlayFailures >= MAX_CONSECUTIVE_FAILURES) {
    logger.error('[AudioStore] Too many consecutive failures, stopping auto-skip');
    useAudioStore.setState({
      error: 'Multiple songs failed to play. Check your connection.',
      isLoading: false,
      isPlaying: false,
    });
    return;
  }
  
  const backoff = Math.min(500 * Math.pow(2, consecutivePlayFailures - 1), 2000);
  nextSongRetryTimeout = setTimeout(() => {
    nextSongRetryTimeout = null;
    useAudioStore.getState().nextSong();
  }, backoff);
}

/**
 * The authoritative next/previous transition pipeline — shared by both
 * directions so the resolve/play/failure paths can never drift apart.
 *
 * Handles: single-flight guard (one transition of this direction at a
 * time), command-sequence claiming at EXECUTION time, the queue move, and
 * starting playback of the moved-to track with the standard failure
 * recovery (auto-skip). `onNoSong` runs when the queue has no valid move
 * target (end-of-queue / one-track edge cases) — each direction finishes
 * the no-target tail slightly differently.
 */
function chainQueueTransition(opts: {
  isPending: () => boolean;
  setPending: (v: boolean) => void;
  /** Perform the queue move (nextSong/previousSong on the queue store). */
  move: () => Promise<Song | null>;
  /** Error-log label (nextSong/previousSong). */
  label: string;
  /** Runs when the queue has no valid move target. */
  onNoSong: () => void;
}): Promise<void> | undefined {
  const { isPending, setPending, move, label, onNoSong } = opts;

  if (isPending()) return; // exactly one transition of this kind at a time
  // User is skipping — stale next-track warm for the old next is now wrong.
  try { cancelNextTrackPreload(); } catch {}
  setPending(true);
  clearNextSongRetry();
  pendingResumePosition = null;
  return chainAdvance(async () => {
    // Claim the command sequence at EXECUTION time, not issue time: this
    // invalidates any older in-flight command (stale next / clicked-then-
    // superseded load) while keeping a queued next/previous pair both
    // authoritative — each executes exactly once, in order.
    const seq = ++commandSeq;
    try {
      const song = await move();
      // A newer command (song click / previous / another next) completed
      // while the queue transition was in flight — it owns playback now.
      if (seq !== commandSeq) return;
      if (song) {
        const resolved = resolveDownloadUrl(song);
        // Read queue + index synchronously right after the move set them
        const qs = useQueueStore.getState();
        const resolvedQueue = resolveQueueDownloads(qs.queue);
        useAudioStore.setState({
          currentSong: resolved,
          progress: 0,
          isLoading: true,
          duration: resolved.duration,
          error: null,
        });
        startLoadingTimeout();
        audioService.play(resolved, resolvedQueue, qs.currentIndex).catch(err => {
          if (seq !== commandSeq) return; // superseded by a newer command
          const msg = err instanceof Error ? err.message : 'Playback failed';
          logger.error(`[AudioStore] ${label} play() failed:`, msg);
          clearLoadingTimeout();
          useAudioStore.setState({ error: msg, isLoading: false, isPlaying: false });
          autoSkipNextSong();
        });
      } else {
        onNoSong();
      }
    } finally {
      setPending(false);
    }
  });
}

/**
 * Crossfade trigger — evaluated on every progress update. Claims the current
 * playback session the moment the fade window opens, then prepares the next
 * track's stream. EVERY gate failure is a silent return: crossfade is a
 * pure enhancement and must never disturb the normal ended-path advance.
 */
function maybeTriggerCrossfade(progress: number): void {
  const qs = useQueueStore.getState();
  if (!qs.crossfadeEnabled) return;
  // Repeat-one replays the current track on natural completion — no fade.
  if (qs.repeatMode === 'one') return;
  const session = audioService.getCurrentPlaybackId();
  if (crossfadeClaimedSession === session) return; // one trigger per session
  if (isCrossfadePreparing) return;
  if (audioService.getCrossfadePhase() !== 'idle') return;

  const st = useAudioStore.getState();
  if (!st.isPlaying || st.isLoading || st.error) return;
  // HTML engine only — native/iframe engines cannot participate.
  if (!audioService.isHtmlEngineActive()) return;
  // Background playback runs on the OS side; the WebView's timers and
  // autoplay context cannot be trusted there.
  try { if (backgroundPlaybackService.getIsBackground()) return; } catch {}

  const duration = audioService.getDuration();
  const fade = qs.crossfadeDurationSec;
  if (!isFinite(duration) || duration <= 0) return;
  if (duration <= fade * 2) return;        // track too short to fade safely
  if (duration - progress > fade) return;  // not yet inside the fade window

  // A manual next/previous is already in flight — it owns the transition.
  if (isNextSongPending || isPreviousSongPending) return;

  const target = qs.peekNextSong();
  if (!target || target.id === st.currentSong?.id) return;

  // CLAIM the session before any async work — from this point the window
  // can never retrigger, no matter how many progress ticks arrive.
  crossfadeClaimedSession = session;
  isCrossfadePreparing = true;
  void runCrossfade(target, session, fade);
}

/**
 * Prepare the incoming stream, then commit the queue transition through the
 * SAME authoritative chain as manual next. The queue is committed only AFTER
 * the stream is ready — a failed prepare leaves the queue untouched and the
 * track simply ends into the normal advance path.
 */
async function runCrossfade(target: Song, session: number, fade: number): Promise<void> {
  try {
    const ok = await audioService.prepareCrossfadeIn(resolveDownloadUrl(target));
    // The session we prepared against must still be live and no user
    // transition may have taken over while the stream was buffering.
    if (!ok || audioService.getCurrentPlaybackId() !== session || isNextSongPending || isPreviousSongPending) {
      audioService.cancelCrossfade();
      return;
    }
    await chainAdvance(async () => {
      // A queued manual next/previous outranks the automatic fade — yield
      // the chain to it instead of advancing twice.
      if (isNextSongPending || isPreviousSongPending || audioService.getCurrentPlaybackId() !== session) {
        audioService.cancelCrossfade();
        return;
      }
      const seq = ++commandSeq;
      // Preselect `target`: under shuffle this locks the commit to the track
      // already buffered in the incoming element.
      const committed = await useQueueStore.getState().nextSong(target);
      if (seq !== commandSeq || !committed || committed.id !== target.id) {
        // A newer command owns the player, or the queue no longer agrees
        // with the prepared stream — discard the fade silently.
        audioService.cancelCrossfade();
        return;
      }
      const started = audioService.startCrossfadeIn(fade);
      if (!started) {
        // Hand-off impossible (engine changed underneath) — fall back to a
        // normal play of the committed track so the queue never stalls.
        audioService.cancelCrossfade();
        const queueState = useQueueStore.getState();
        const resolved = resolveDownloadUrl(committed);
        useAudioStore.setState({
          currentSong: resolved,
          progress: 0,
          isLoading: true,
          duration: resolved.duration,
          error: null,
        });
        startLoadingTimeout();
        audioService.play(resolved, resolveQueueDownloads(queueState.queue), queueState.currentIndex).catch(err => {
          if (seq !== commandSeq) return;
          const msg = err instanceof Error ? err.message : 'Playback failed';
          logger.error('[AudioStore] crossfade fallback play() failed:', msg);
          clearLoadingTimeout();
          useAudioStore.setState({ error: msg, isLoading: false, isPlaying: false });
          autoSkipNextSong();
        });
        return;
      }
      useAudioStore.setState({ progress: 0, isLoading: false, error: null });
    });
  } finally {
    isCrossfadePreparing = false;
  }
}

export const useAudioStore = create<AudioStore>((set, get) => ({
  currentSong: null,
  isPlaying: false,
  volume: 0.7,
  isLoading: false,
  error: null,
  progress: 0,
  duration: 0,
  favorites: [],

  loadSong: (song: Song, playlist: Song[], index: number, preserveShuffle = false) => {
    clearNextSongRetry();
    try { cancelNextTrackPreload(); } catch {}

    // Boundary validation: a malformed track must produce a controlled
    // error — never a crash, a broken queue item, or a fake PLAYING state.
    if (!song || typeof song.id !== 'string' || !song.id.trim()) {
      logger.error('[AudioStore] loadSong rejected a track with no playable id:', song);
      clearLoadingTimeout();
      set({ error: 'This track cannot be played — it has no playable id', isLoading: false, isPlaying: false });
      return;
    }

    const { currentSong, isPlaying, isLoading } = get();

    // Rapid double-click guard: re-clicking the track that is already loading
    // must not restart playback or rewrite the queue mid-resolution.
    if (currentSong?.id === song.id && isLoading) return;

    // A different song was chosen — any restored resume position no longer applies.
    if (currentSong?.id !== song.id) pendingResumePosition = null;

    if (currentSong?.id === song.id) {
      if (isPlaying) {
        audioService.pause();
        set({ isPlaying: false });
        return;
      }
      if (audioService.isLoaded()) {
        // A rejected resume means the engine behind isLoaded() is gone (e.g.
        // native service recreated) — fall back to a full queue rebuild.
        audioService.resume().catch(() => useAudioStore.getState().play());
        return;
      }
      // Song was restored from persistence after a process restart but no audio
      // is actually loaded — fall through to a full play() below.
    }

    // Song click is THE authoritative transition — it claims a new command
    // sequence so any in-flight async work from a previous command becomes
    // stale and is discarded instead of overwriting this click. The increment
    // sits AFTER the dedup/toggle guards so a blocked re-click never
    // invalidates the play that is legitimately in flight.
    const seq = ++commandSeq;

    // Ensure global listeners are wired up (may not have run yet if deferred)
    if (!globalListenersRegistered) {
      try { initAudioServiceHandler(); } catch {}
    }

    const resumeAt = currentSong?.id === song.id ? pendingResumePosition : null;
    if (resumeAt !== null) pendingResumePosition = null;
    const resolvedSong = resolveDownloadUrl(song);
    const resolvedQueue = resolveQueueDownloads(playlist);

    const qs = useQueueStore.getState();
    qs.setQueue(resolvedQueue, index, preserveShuffle);

    set({
      currentSong: resolvedSong,
      isLoading: true,
      error: null,
      duration: Number.isFinite(resolvedSong.duration) ? resolvedSong.duration : 0,
      progress: 0,
    });
    startLoadingTimeout();
    
    audioService.play(resolvedSong, resolvedQueue, index, resumeAt ?? undefined).catch(err => {
      if (seq !== commandSeq) return; // a newer command owns the player now
      const msg = err instanceof Error ? err.message : 'Playback failed';
      logger.error('[AudioStore] loadSong play() failed:', msg);
      clearLoadingTimeout();
      set({ error: msg, isLoading: false, isPlaying: false });
      // A REJECTED play() never emits 'ended', so the bounded auto-skip must
      // happen here — otherwise the queue stalls on the failed track.
      autoSkipNextSong();
    });
  },

  retry: () => {
    clearNextSongRetry();
    const { currentSong } = get();
    if (!currentSong) return;
    const seq = ++commandSeq;
    pendingResumePosition = null;
    const qs = useQueueStore.getState();
    const queue = qs.queue.length > 0 ? qs.queue : [currentSong];
    const index = Math.min(qs.currentIndex, queue.length - 1);
    const resolvedQueue = resolveQueueDownloads(queue);
    const song = resolvedQueue[index] || resolveDownloadUrl(currentSong);
    if (!song) return;
    set({ currentSong: song, isLoading: true, error: null, progress: 0 });
    startLoadingTimeout();
    audioService.pause();
    audioService.play(song, resolvedQueue, index).catch(err => {
      if (seq !== commandSeq) return; // superseded by a newer command
      const msg = err instanceof Error ? err.message : 'Playback failed';
      logger.error('[AudioStore] retry play() failed:', msg);
      clearLoadingTimeout();
      set({ error: msg, isLoading: false, isPlaying: false });
      autoSkipNextSong();
    });
  },

  play: () => {
    const { currentSong } = get();
    if (!currentSong) return;
    if (!audioService.isLoaded()) {
      // Restored session (e.g. after process recreation) — no audio loaded yet.
      // Rebuild playback from the persisted queue and resume the saved position.
      const seq = ++commandSeq;
      const qs = useQueueStore.getState();
      const queue = qs.queue.length > 0 ? qs.queue : [currentSong];
      const resolvedQueue = resolveQueueDownloads(queue);
      const resumeAt = pendingResumePosition;
      pendingResumePosition = null;
      set({ isLoading: true, error: null });
      startLoadingTimeout();
      audioService.play(resolvedQueue[qs.currentIndex] || currentSong, resolvedQueue, qs.currentIndex, resumeAt ?? undefined).catch(err => {
        if (seq !== commandSeq) return; // superseded by a newer command
        const msg = err instanceof Error ? err.message : 'Playback failed';
        logger.error('[AudioStore] play() restore failed:', msg);
        clearLoadingTimeout();
        set({ error: msg, isLoading: false, isPlaying: false });
        autoSkipNextSong();
      });
      return;
    }
    // A rejected resume means the engine is gone (native service recreated
    // while paused) — rebuild playback from the queue instead of dying.
    audioService.resume().catch(() => useAudioStore.getState().play());
  },

  pause: () => {
    audioService.pause();
  },

  togglePlayPause: () => {
    const { isPlaying, currentSong } = get();
    if (!currentSong) return;
    if (isPlaying) {
      audioService.pause();
    } else if (audioService.isLoaded()) {
      audioService.resume().catch(() => useAudioStore.getState().play());
    } else {
      get().play();
    }
  },

  nextSong: () => chainQueueTransition({
    isPending: () => isNextSongPending,
    setPending: (v) => { isNextSongPending = v; },
    move: () => useQueueStore.getState().nextSong(),
    label: 'nextSong',
    onNoSong: () => {
      // End of queue — stop playback and flush the media session state.
      clearNextSongRetry();
      clearLoadingTimeout();
      useAudioStore.setState({ isPlaying: false, progress: 0, isLoading: false });
      syncMediaSessionEnded();
    },
  }),

  previousSong: () => chainQueueTransition({
    isPending: () => isPreviousSongPending,
    setPending: (v) => { isPreviousSongPending = v; },
    move: () => useQueueStore.getState().previousSong(),
    label: 'previousSong',
    onNoSong: () => {
      // Queue boundary — just clear the loading flag; playback keeps going.
      clearLoadingTimeout();
      useAudioStore.setState({ isLoading: false });
    },
  }),

  seek: (time: number) => {
    pendingResumePosition = null;
    audioService.seek(time);
    set({ progress: time });
  },

  setVolume: (volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume));
    audioService.setVolume(clamped);
    set({ volume: clamped });
    scheduleVolumePersist(clamped);
  },

  toggleShuffle: () => {
    useQueueStore.getState().toggleShuffle();
  },

  cycleRepeat: () => {
    useQueueStore.getState().cycleRepeat();
  },

  toggleFavorite: (songId: string) => {
    const { favorites } = get();
    const newFavs = favorites.includes(songId)
      ? favorites.filter(id => id !== songId)
      : [...favorites, songId];
    set({ favorites: newFavs });
    saveFavorites(newFavs);
  },

  restoreFromPersistence: () => {
    const saved = playbackPersistenceService.load();
    if (!saved || !saved.currentSong) return;

    const vol = saved.volume ?? 0.7;
    audioService.setVolume(vol);

    const qs = useQueueStore.getState();
    if (saved.queue.length > 0) {
      qs.restoreQueue({
        queue: saved.queue,
        currentIndex: saved.currentIndex || 0,
        repeatMode: saved.repeatMode || 'off',
        isShuffled: !!saved.isShuffled,
        originalQueue: saved.originalQueue || [],
        autoplayEnabled: useQueueStore.getState().autoplayEnabled,
      });
    }

    // Restore the song + position so the player UI reflects reality after a
    // process restart. Audio is NOT loaded yet — the next play action re-loads
    // it and resumes from this position.
    const dur = saved.duration && saved.duration > 0
      ? saved.duration
      : (saved.currentSong.duration || 0);
    const resumeAt = saved.progress && saved.progress > 3 && saved.progress < (dur > 0 ? dur - 2 : 0)
      ? saved.progress
      : null;
    pendingResumePosition = resumeAt;

    const resolved = resolveDownloadUrl(saved.currentSong);
    set({
      volume: vol,
      currentSong: resolved,
      duration: dur,
      progress: resumeAt ?? 0,
      isPlaying: false,
      isLoading: false,
      error: null,
    });

    // If the foreground service requested playback before state was restored
    // (process recreation), auto-resume now that state is available.
    if (serviceRequestedPlay) {
      serviceRequestedPlay = false;
      const store = useAudioStore.getState();
      if (store.currentSong) {
        store.play();
      }
    }

    // If the native engine is still alive (WebView/Activity was recreated
    // while the foreground service kept playing), adopt its state instead of
    // resetting the UI to stopped. Playback itself is never interrupted.
    void (async () => {
      try {
        const playbackIdBefore = audioService.getCurrentPlaybackId();
        const nativeState = await backgroundAudio.getPlaybackState();
        // The user started something while this async check was in flight —
        // that command owns playback now; never stomp it with a stale
        // snapshot (adoption would invalidate its stream resolution).
        if (audioService.getCurrentPlaybackId() !== playbackIdBefore) return;
        const st = useAudioStore.getState();
        if (st.isPlaying || st.isLoading) return;
        if (!nativeState.nativeActive) {
          // A track may have ENDED while the WebView was destroyed — the
          // 'ended' notification never arrived. Continue the queue exactly
          // once so queue continuation survives JS disconnects.
          if (nativeState.endedPending && st.currentSong) {
            audioService.consumeNativeEnded();
            backgroundAudio.acknowledgeEnded().catch(() => {});
            useAudioStore.getState().nextSong();
          }
          return;
        }
        const current = st.currentSong;
        if (!current) return;
        const positionSec = Math.max(0, (nativeState.position || 0) / 1000);
        const durationSec = nativeState.duration > 0 ? nativeState.duration / 1000 : (current.duration || 0);
        pendingResumePosition = null;
        audioService.adoptNativePlayback(current, { positionSec, durationSec, isPlaying: nativeState.isPlaying, generation: nativeState.generation });
        useAudioStore.setState({ isPlaying: nativeState.isPlaying, progress: positionSec, duration: durationSec });
      } catch {}
    })();
  },
}));

if (typeof window !== 'undefined') {
  deferIdle(() => {
    try {
      const favorites = loadFavorites();
      const volume = loadVolume();
      useAudioStore.setState({ favorites, volume });
      audioService.setVolume(volume);
    } catch {}
  });
}

if (import.meta.env.DEV) {
  try {
    useAudioStore.subscribe((state, prev) => {
      const changes: string[] = [];
      if (state.isPlaying !== prev.isPlaying) changes.push(`isPlaying: ${prev.isPlaying} → ${state.isPlaying}`);
      if (state.isLoading !== prev.isLoading) changes.push(`isLoading: ${prev.isLoading} → ${state.isLoading}`);
      if (state.error !== prev.error) changes.push(`error: ${state.error || 'null'}`);
      if (state.currentSong?.id !== prev.currentSong?.id) changes.push(`song: ${prev.currentSong?.title || 'none'} → ${state.currentSong?.title || 'none'}`);
      if (changes.length > 0) {
        logger.debug('[AudioStore] State:', changes.join(', '));
      }
    });
  } catch {}
}
