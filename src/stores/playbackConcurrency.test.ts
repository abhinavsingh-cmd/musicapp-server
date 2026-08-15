import { vi, describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Concurrency regression tests for the queue/player state machine.
// The engine is mocked — these tests verify the store's DETERMINISTIC
// transition rules: one authoritative transition per command, stale async
// work discarded, no double next, no duplicate queue entries.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  play: vi.fn((): Promise<void> => Promise.resolve()),
  pause: vi.fn(),
  resume: vi.fn((): Promise<void> => Promise.resolve()),
  isLoaded: vi.fn(() => false),
  playbackId: 0,
  subscribeHandlers: [] as Array<(event: string, data?: any) => void>,
  bgHandlers: [] as Array<(isBackground: boolean) => void>,
  nativeState: { nativeActive: false } as Record<string, unknown>,
  acknowledgeEnded: vi.fn(() => Promise.resolve()),
  consumeNativeEnded: vi.fn(),
  adoptNativePlayback: vi.fn(),
  syncExternalPosition: vi.fn(),
  // Resolves to the CURRENT mocks.nativeState at call time — must live inside
  // vi.hoisted so the mock factory captures a defined function.
  getPlaybackState: vi.fn(() => Promise.resolve(mocks.nativeState)),
  // Captured native media-action handler (Bluetooth / lock screen /
  // notification transport) so tests can inject media-button events.
  mediaActionHandlers: [] as Array<(event: { action: string; position?: number }) => void>,
  seek: vi.fn(),
  saveImmediate: vi.fn(),
  loadPersistence: vi.fn((): any => null),
  getRecommendations: vi.fn((): Promise<Song[]> => Promise.resolve([])),
  // ── Crossfade surface — a stateful fake of the service's fade phases so
  // store-level trigger/claim/yield rules can be tested deterministically.
  crossfadePhase: 'idle' as 'idle' | 'prepared' | 'fading',
  prepareCrossfadeIn: vi.fn((): Promise<boolean> => Promise.resolve(true)),
  startCrossfadeIn: vi.fn((): boolean => {
    mocks.crossfadePhase = 'fading';
    return true;
  }),
  cancelCrossfade: vi.fn(() => { mocks.crossfadePhase = 'idle'; }),
  finishCrossfadeNow: vi.fn(() => { mocks.crossfadePhase = 'idle'; }),
}));

vi.mock('../services/audioServiceInstance', () => ({
  audioService: {
    play: mocks.play,
    pause: mocks.pause,
    resume: mocks.resume,
    isLoaded: mocks.isLoaded,
    seek: mocks.seek,
    setVolume: vi.fn(),
    getDuration: vi.fn(() => 200),
    getCurrentTime: vi.fn(() => 0),
    isNativeEngineActive: vi.fn(() => false),
    syncExternalPosition: mocks.syncExternalPosition,
    adoptNativePlayback: mocks.adoptNativePlayback,
    getCurrentPlaybackId: vi.fn(() => mocks.playbackId),
    consumeNativeEnded: mocks.consumeNativeEnded,
    // Crossfade API — the store's progress-driven trigger leans on these.
    getCrossfadePhase: vi.fn(() => mocks.crossfadePhase),
    isCrossfading: vi.fn(() => mocks.crossfadePhase === 'fading'),
    isHtmlEngineActive: vi.fn(() => true),
    prepareCrossfadeIn: mocks.prepareCrossfadeIn,
    startCrossfadeIn: mocks.startCrossfadeIn,
    cancelCrossfade: mocks.cancelCrossfade,
    finishCrossfadeNow: mocks.finishCrossfadeNow,
    subscribe: vi.fn((cb: (event: string, data?: any) => void) => {
      mocks.subscribeHandlers.push(cb);
      return () => {};
    }),
  },
}));

vi.mock('../services/mediaSessionService', () => ({
  mediaSessionService: {
    init: vi.fn(),
    updateMetadata: vi.fn(),
    updatePlaybackState: vi.fn(),
    updateActions: vi.fn(),
  },
}));

vi.mock('../services/playbackPersistenceService', () => ({
  playbackPersistenceService: {
    load: mocks.loadPersistence,
    save: vi.fn(),
    saveImmediate: mocks.saveImmediate,
    clear: vi.fn(),
  },
}));

vi.mock('../services/backgroundPlaybackService', () => ({
  backgroundPlaybackService: {
    init: vi.fn(),
    registerAudioElement: vi.fn(),
    onInterruption: vi.fn(),
    onReconnect: vi.fn(),
    onBackgroundChange: vi.fn((cb: (isBackground: boolean) => void) => {
      mocks.bgHandlers.push(cb);
      return () => {};
    }),
    getIsBackground: vi.fn(() => false),
  },
}));

vi.mock('../services/backgroundAudio', () => ({
  backgroundAudio: {
    onMediaAction: vi.fn((cb: (event: { action: string; position?: number }) => void) => {
      mocks.mediaActionHandlers.push(cb);
      return Promise.resolve(() => {});
    }),
    startService: vi.fn(() => Promise.resolve()),
    updateMetadata: vi.fn(() => Promise.resolve()),
    updatePlaybackState: vi.fn(() => Promise.resolve()),
    getPlaybackState: mocks.getPlaybackState,
    acknowledgeEnded: mocks.acknowledgeEnded,
  },
}));

vi.mock('../services/preloadService', () => ({
  preloadNextSongs: vi.fn(() => Promise.resolve()),
  prewarmOnFirstInteraction: vi.fn(),
}));

vi.mock('./downloadsStore', () => ({
  useDownloadsStore: { getState: () => ({ getBlobUrl: () => null }) },
}));

vi.mock('./historyStore', () => ({
  useHistoryStore: { getState: () => ({ addSong: vi.fn() }) },
}));

// Autoplay recommendation path (dynamic imports inside ensureQueueSize) —
// no provider declares relatedTracks, so the recommendation service is the
// source tests control.
vi.mock('../providers/adapters', () => ({
  toTrack: (s: any) => ({ provider: s.provider || 'youtube', id: s.id, title: s.title }),
  toSong: (t: any) => t,
}));
vi.mock('../providers/registry', () => ({
  providerRegistry: { get: () => undefined },
}));
vi.mock('../providers', () => ({
  resolvePlayableSource: vi.fn(),
  playableToEngineParams: vi.fn(),
  // Smart-replacement layer consults search on failure — no candidates here.
  searchProviders: vi.fn(() => Promise.resolve([])),
  toTrack: (s: any) => s,
  toSong: (t: any) => t,
  providerRegistry: { get: () => undefined },
}));
vi.mock('../services/recommendationService', () => ({
  getRecommendations: mocks.getRecommendations,
}));

import { useAudioStore } from './audioStore';
import { useQueueStore } from './queueStore';
import type { Song } from '../types/music';

function makeSong(id: string, overrides: Partial<Song> = {}): Song {
  return {
    id,
    title: `Song ${id}`,
    artist: 'Artist',
    album: 'Album',
    duration: 200,
    genre: 'Pop',
    coverArt: '',
    audioUrl: '',
    youtubeId: id,
    provider: 'youtube',
    releaseYear: 2020,
    ...overrides,
  };
}

function resetStores() {
  useAudioStore.setState({
    currentSong: null,
    isPlaying: false,
    isLoading: false,
    error: null,
    progress: 0,
    duration: 0,
  });
  useQueueStore.setState({
    queue: [],
    currentIndex: 0,
    isShuffled: false,
    originalQueue: [],
    repeatMode: 'off',
    autoplayEnabled: false,
    isFetchingRecommendations: false,
    crossfadeEnabled: false,
    crossfadeDurationSec: 6,
  });
}

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

/** Deeper settle budget — dynamic imports cost several microtask hops each,
 *  and the autoplay/reload paths chain multiple of them. Some hops only
 *  resolve on an event-loop turn, so alternate microtask flushes with
 *  macrotask yields instead of arbitrary long waits. */
async function deepFlush() {
  for (let i = 0; i < 8; i++) {
    await flush();
    await new Promise((r) => setTimeout(r, 0));
  }
}

/** The single engine-event handler registered by the store. */
function engineHandler(): (event: string, data?: any) => void {
  expect(mocks.subscribeHandlers.length).toBeGreaterThan(0);
  return mocks.subscribeHandlers[0];
}

beforeEach(() => {
  mocks.play.mockClear();
  mocks.play.mockImplementation(() => Promise.resolve());
  mocks.pause.mockClear();
  mocks.isLoaded.mockReturnValue(false);
  mocks.playbackId = 0;
  mocks.nativeState = { nativeActive: false };
  mocks.acknowledgeEnded.mockClear();
  mocks.consumeNativeEnded.mockClear();
  mocks.adoptNativePlayback.mockClear();
  mocks.syncExternalPosition.mockClear();
  mocks.seek.mockClear();
  mocks.resume.mockClear();
  mocks.getPlaybackState.mockImplementation(() => Promise.resolve(mocks.nativeState));
  mocks.saveImmediate.mockClear();
  mocks.loadPersistence.mockReturnValue(null);
  mocks.getRecommendations.mockReset();
  mocks.getRecommendations.mockImplementation((): Promise<Song[]> => Promise.resolve([]));
  mocks.crossfadePhase = 'idle';
  mocks.prepareCrossfadeIn.mockClear();
  mocks.prepareCrossfadeIn.mockImplementation((): Promise<boolean> => Promise.resolve(true));
  mocks.startCrossfadeIn.mockClear();
  mocks.startCrossfadeIn.mockImplementation((): boolean => {
    mocks.crossfadePhase = 'fading';
    return true;
  });
  mocks.cancelCrossfade.mockClear();
  mocks.cancelCrossfade.mockImplementation(() => { mocks.crossfadePhase = 'idle'; });
  mocks.finishCrossfadeNow.mockClear();
  mocks.finishCrossfadeNow.mockImplementation(() => { mocks.crossfadePhase = 'idle'; });
  delete (window as any).Capacitor;
  resetStores();
});

// ---------------------------------------------------------------------------
// Rapid repeated commands — exactly one authoritative transition each
// ---------------------------------------------------------------------------

describe('rapid commands', () => {
  it('rapid repeated NEXT commands produce exactly one transition', async () => {
    const [a, b, c] = [makeSong('a'), makeSong('b'), makeSong('c')];
    useAudioStore.getState().loadSong(a, [a, b, c], 0);
    await flush();
    mocks.play.mockClear();

    const store = useAudioStore.getState();
    store.nextSong();
    store.nextSong(); // must be dropped — a next-transition is in flight
    store.nextSong(); // must be dropped

    await flush();

    expect(useQueueStore.getState().currentIndex).toBe(1);
    expect(useAudioStore.getState().currentSong?.id).toBe('b');
    expect(mocks.play).toHaveBeenCalledTimes(1); // exactly one transition
  });

  it('rapid repeated PREVIOUS commands produce exactly one transition', async () => {
    const [a, b, c] = [makeSong('a'), makeSong('b'), makeSong('c')];
    useAudioStore.getState().loadSong(b, [a, b, c], 1);
    await flush();
    mocks.play.mockClear();

    const store = useAudioStore.getState();
    store.previousSong();
    store.previousSong(); // dropped
    store.previousSong(); // dropped

    await flush();

    expect(useQueueStore.getState().currentIndex).toBe(0);
    expect(useAudioStore.getState().currentSong?.id).toBe('a');
    expect(mocks.play).toHaveBeenCalledTimes(1);
  });

  it('NEXT then PREVIOUS serialize deterministically — no lost, doubled, or skipped updates', async () => {
    const [a, b, c] = [makeSong('a'), makeSong('b'), makeSong('c')];
    useAudioStore.getState().loadSong(b, [a, b, c], 1);
    await flush();
    mocks.play.mockClear();

    const store = useAudioStore.getState();
    store.nextSong();
    store.previousSong();

    await flush();
    await flush();

    // Both commands executed exactly once, in order: b → c → b
    expect(useQueueStore.getState().currentIndex).toBe(1);
    expect(useAudioStore.getState().currentSong?.id).toBe('b');
    expect(mocks.play).toHaveBeenCalledTimes(2);
  });

  it('a SONG CLICK always wins over an in-flight next transition', async () => {
    const [a, b, c] = [makeSong('a'), makeSong('b'), makeSong('c')];
    useAudioStore.getState().loadSong(a, [a, b, c], 0);
    await flush();

    useAudioStore.getState().nextSong();
    // User clicks song C while the next-transition is still in flight
    useAudioStore.getState().loadSong(c, [a, b, c], 2);
    await flush();
    await flush();

    // The click is the authoritative result — the stale next must not
    // overwrite it afterwards.
    expect(useAudioStore.getState().currentSong?.id).toBe('c');
    expect(useQueueStore.getState().currentIndex).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Ended track — never two next-transitions
// ---------------------------------------------------------------------------

describe('ended handling', () => {
  it('an ended track triggers next EXACTLY once even if ended fires twice', async () => {
    const [a, b, c] = [makeSong('a'), makeSong('b'), makeSong('c')];
    useAudioStore.getState().loadSong(a, [a, b, c], 0);
    await flush();
    mocks.playbackId = 5;
    mocks.play.mockClear();

    const handler = engineHandler();
    handler('ended', { playbackId: 5 });
    handler('ended', { playbackId: 5 }); // duplicate ended — must be ignored
    await flush();
    await flush();

    expect(useQueueStore.getState().currentIndex).toBe(1);
    expect(useAudioStore.getState().currentSong?.id).toBe('b');
    expect(mocks.play).toHaveBeenCalledTimes(1); // ONE next-transition

    // A third late ended for the same session must still be a no-op
    handler('ended', { playbackId: 5 });
    await flush();
    expect(useQueueStore.getState().currentIndex).toBe(1);
    expect(mocks.play).toHaveBeenCalledTimes(1);
  });

  it('an OLD track ending after a newer track started is ignored entirely', async () => {
    const [a, b, c] = [makeSong('a'), makeSong('b'), makeSong('c')];
    useAudioStore.getState().loadSong(a, [a, b, c], 0);
    await flush();
    useAudioStore.getState().loadSong(b, [a, b, c], 1);
    await flush();
    mocks.playbackId = 9; // the engine is now on a newer session
    mocks.play.mockClear();

    engineHandler()('ended', { playbackId: 8 }); // stale session ends late
    await flush();

    expect(useQueueStore.getState().currentIndex).toBe(1); // no skip happened
    expect(useAudioStore.getState().currentSong?.id).toBe('b');
    expect(mocks.play).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Stale async operations — never replace/rewrite the newer state
// ---------------------------------------------------------------------------

describe('stale async operations', () => {
  it('a late play() rejection from an OLD click cannot overwrite the new track', async () => {
    let rejectOld!: (e: Error) => void;
    mocks.play.mockImplementationOnce(
      () => new Promise<void>((_, rej) => { rejectOld = rej; }),
    );

    const a = makeSong('a');
    useAudioStore.getState().loadSong(a, [a], 0);

    // User clicks B before A's stream resolution fails
    mocks.play.mockImplementation(() => Promise.resolve());
    const b = makeSong('b');
    useAudioStore.getState().loadSong(b, [b], 0);
    await flush();
    expect(useAudioStore.getState().currentSong?.id).toBe('b');

    rejectOld(new Error('No audio source available'));
    await flush();

    const s = useAudioStore.getState();
    expect(s.currentSong?.id).toBe('b'); // stale rejection discarded
    expect(s.error).toBeNull();
    expect(s.isPlaying).toBe(false);
  });

  it('a stale PLAY event from an old session cannot change the current track', () => {
    const a = makeSong('a');
    const b = makeSong('b');
    useAudioStore.getState().loadSong(a, [a], 0);
    useAudioStore.getState().loadSong(b, [b], 0);
    mocks.playbackId = 4; // engine is on session 4 now

    engineHandler()('play', { song: a, playbackId: 3 }); // stale event

    const s = useAudioStore.getState();
    expect(s.currentSong?.id).toBe('b');
    expect(s.isPlaying).toBe(false); // fake PLAYING state never applied
  });

  it('a current-session PLAY event still applies normally', () => {
    const b = makeSong('b');
    useAudioStore.getState().loadSong(b, [b], 0);
    mocks.playbackId = 4;

    engineHandler()('play', { song: b, playbackId: 4 });

    const s = useAudioStore.getState();
    expect(s.currentSong?.id).toBe('b');
    expect(s.isPlaying).toBe(true);
    expect(s.isLoading).toBe(false);
  });

  it('a stale LOADED event cannot swap the current track', () => {
    const a = makeSong('a');
    const b = makeSong('b');
    useAudioStore.getState().loadSong(a, [a], 0);
    useAudioStore.getState().loadSong(b, [b], 0);
    mocks.playbackId = 6;

    engineHandler()('loaded', { song: a, playbackId: 5 });

    expect(useAudioStore.getState().currentSong?.id).toBe('b');
  });
});

// ---------------------------------------------------------------------------
// Queue insertion — duplicates are never allowed
// ---------------------------------------------------------------------------

describe('queue insertion', () => {
  it('addToQueue never inserts the same track twice', () => {
    const a = makeSong('a');
    useQueueStore.getState().setQueue([a], 0);

    useQueueStore.getState().addToQueue(makeSong('b'));
    useQueueStore.getState().addToQueue(makeSong('b')); // duplicate
    useQueueStore.getState().addToQueue(makeSong('a')); // already in queue

    expect(useQueueStore.getState().queue.map(q => q.id)).toEqual(['a', 'b']);
  });

  it('addNext never inserts a duplicate', () => {
    const a = makeSong('a');
    useQueueStore.getState().setQueue([a, makeSong('b')], 0);

    useQueueStore.getState().addNext(makeSong('c'));
    useQueueStore.getState().addNext(makeSong('c')); // duplicate
    useQueueStore.getState().addNext(makeSong('b')); // already queued later

    expect(useQueueStore.getState().queue.map(q => q.id)).toEqual(['a', 'c', 'b']);
  });
});

// ---------------------------------------------------------------------------
// Engine-loss recovery — a rejected resume must rebuild, never die silently
// ---------------------------------------------------------------------------

describe('engine-loss recovery', () => {
  it('play() rebuilds from the queue when resume fails (native engine lost)', async () => {
    const [a, b] = [makeSong('a'), makeSong('b')];
    useAudioStore.getState().loadSong(a, [a, b], 0);
    await flush();
    mocks.play.mockClear();

    // Store believes an engine is loaded, but the engine behind it is gone
    // (foreground service recreated) — resume rejects.
    mocks.isLoaded.mockReturnValueOnce(true);
    mocks.resume.mockRejectedValueOnce(new Error('Native playback is no longer available'));

    useAudioStore.getState().play();
    await flush();

    expect(mocks.play).toHaveBeenCalledTimes(1); // rebuilt instead of dying
    expect((mocks.play.mock.calls[0] as unknown as [{ id: string }])[0].id).toBe('a');
  });

  it('togglePlayPause falls back to a queue rebuild when resume fails', async () => {
    const [a, b] = [makeSong('a'), makeSong('b')];
    useAudioStore.getState().loadSong(a, [a, b], 0);
    await flush();
    mocks.play.mockClear();

    mocks.isLoaded.mockReturnValueOnce(true);
    mocks.resume.mockRejectedValueOnce(new Error('engine gone'));

    useAudioStore.getState().togglePlayPause();
    await flush();

    expect(mocks.play).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Queue continuation across JS disconnects (endedPending)
// ---------------------------------------------------------------------------

describe('foreground reconciliation', () => {
  it('continues the queue exactly once when a track ended while JS was disconnected', async () => {
    (window as any).Capacitor = {};
    const [a, b, c] = [makeSong('a'), makeSong('b'), makeSong('c')];
    useAudioStore.getState().loadSong(a, [a, b, c], 0);
    await flush();
    mocks.play.mockClear();
    useAudioStore.setState({ isLoading: false }); // idle — no resolution in flight

    // While JS was unreachable the current track finished natively.
    mocks.nativeState = { nativeActive: false, endedPending: true };

    const handler = mocks.bgHandlers[mocks.bgHandlers.length - 1];
    expect(handler).toBeDefined();
    handler(false); // returning to the foreground
    await flush();
    await flush();

    expect(mocks.acknowledgeEnded).toHaveBeenCalledTimes(1); // exactly-once consume
    expect(useQueueStore.getState().currentIndex).toBe(1);
    expect(useAudioStore.getState().currentSong?.id).toBe('b');
    expect(mocks.play).toHaveBeenCalledTimes(1);

    // A second foreground return must NOT advance again (flag was consumed).
    mocks.nativeState = { nativeActive: false, endedPending: false };
    handler(false);
    await flush();
    expect(useQueueStore.getState().currentIndex).toBe(1);
    expect(mocks.play).toHaveBeenCalledTimes(1);
  });

  it('never reconciles native state on non-native (web) platforms', async () => {
    // No window.Capacitor — reconciliation must be a no-op even if a stale
    // endedPending somehow appeared.
    const [a, b] = [makeSong('a'), makeSong('b')];
    useAudioStore.getState().loadSong(a, [a, b], 0);
    await flush();
    mocks.play.mockClear();
    mocks.nativeState = { nativeActive: false, endedPending: true };

    const handler = mocks.bgHandlers[mocks.bgHandlers.length - 1];
    expect(handler).toBeDefined();
    handler(false);
    await flush();

    expect(mocks.acknowledgeEnded).not.toHaveBeenCalled();
    expect(useQueueStore.getState().currentIndex).toBe(0);
    expect(mocks.play).not.toHaveBeenCalled();
  });

  it('a STALE endedPending never fires over an active session — it is cleared silently', async () => {
    (window as any).Capacitor = {};
    const [a, b] = [makeSong('a'), makeSong('b')];
    useAudioStore.getState().loadSong(a, [a, b], 0);
    await flush();
    mocks.play.mockClear();

    // Something is ACTIVELY playing (e.g. the user started a song right after
    // returning to the foreground) — the stale flag must be cleared, not
    // honored with a queue skip.
    useAudioStore.setState({ isPlaying: true, isLoading: false });
    mocks.nativeState = { nativeActive: false, endedPending: true };

    const handler = mocks.bgHandlers[mocks.bgHandlers.length - 1];
    handler(false);
    await flush();

    expect(mocks.acknowledgeEnded).toHaveBeenCalledTimes(1); // cleared only
    expect(mocks.play).not.toHaveBeenCalled();
    expect(useQueueStore.getState().currentIndex).toBe(0);
  });

  it('reconcile never stomps a user command that completed during the fetch', async () => {
    (window as any).Capacitor = {};
    const [a, b] = [makeSong('a'), makeSong('b')];
    useAudioStore.getState().loadSong(a, [a, b], 0);
    await flush();
    mocks.play.mockClear();

    // Native reports a live session, but while the snapshot was being fetched
    // the user clicked a song — the playback id advanced.
    mocks.nativeState = { nativeActive: true, isPlaying: true, position: 12000, duration: 200000, generation: 7 };
    mocks.getPlaybackState.mockImplementationOnce(() => {
      mocks.playbackId += 1; // user command completed mid-fetch
      return Promise.resolve(mocks.nativeState);
    });

    const handler = mocks.bgHandlers[mocks.bgHandlers.length - 1];
    handler(false);
    await flush();

    // The stale snapshot must not adopt (which would invalidate the in-flight
    // stream resolution) nor sync a stale position.
    expect(mocks.adoptNativePlayback).not.toHaveBeenCalled();
    expect(mocks.syncExternalPosition).not.toHaveBeenCalled();
    expect(mocks.play).not.toHaveBeenCalled();
  });

  it('never adopts native state while a play resolution is in flight', async () => {
    (window as any).Capacitor = {};
    const [a, b] = [makeSong('a'), makeSong('b')];
    useAudioStore.getState().loadSong(a, [a, b], 0);
    await flush();
    mocks.play.mockClear();

    useAudioStore.setState({ isLoading: true }); // resolution in flight
    mocks.nativeState = { nativeActive: true, isPlaying: true, position: 12000, duration: 200000, generation: 3 };

    const handler = mocks.bgHandlers[mocks.bgHandlers.length - 1];
    handler(false);
    await flush();

    expect(mocks.adoptNativePlayback).not.toHaveBeenCalled();
    expect(mocks.syncExternalPosition).not.toHaveBeenCalled();
  });

  it('adopts a live native session with its generation when JS is idle', async () => {
    (window as any).Capacitor = {};
    const [a, b] = [makeSong('a'), makeSong('b')];
    useAudioStore.getState().loadSong(a, [a, b], 0);
    await flush();
    mocks.play.mockClear();
    useAudioStore.setState({ isLoading: false }); // idle — no resolution in flight

    mocks.nativeState = { nativeActive: true, isPlaying: true, position: 42000, duration: 200000, generation: 9 };

    const handler = mocks.bgHandlers[mocks.bgHandlers.length - 1];
    handler(false);
    await flush();

    expect(mocks.adoptNativePlayback).toHaveBeenCalledTimes(1);
    const opts = mocks.adoptNativePlayback.mock.calls[0][1] as { positionSec: number; generation?: number };
    expect(opts.positionSec).toBe(42);
    expect(opts.generation).toBe(9);
    expect(mocks.play).not.toHaveBeenCalled(); // engine untouched — no restart
  });
});

// ---------------------------------------------------------------------------
// Native media-button routing (Bluetooth / lock screen / notification).
// Every transport event arrives through ONE captured handler and must reach
// the SAME playback controller — never spawn parallel playback logic.
// ---------------------------------------------------------------------------

import { audioService } from '../services/audioServiceInstance';
import { backgroundPlaybackService } from '../services/backgroundPlaybackService';

/** The single native media-action handler registered by the store. */
function mediaActionHandler(): (event: { action: string; position?: number }) => void {
  expect(mocks.mediaActionHandlers.length).toBe(1); // exactly ONE registration
  return mocks.mediaActionHandlers[0];
}

describe('native media-button routing', () => {
  it('registers exactly one native media-action listener', () => {
    expect(mocks.mediaActionHandlers.length).toBe(1);
  });

  it('a duplicate PLAY while already playing is dropped (no second resume)', async () => {
    const a = makeSong('a');
    useAudioStore.getState().loadSong(a, [a], 0);
    await flush();
    useAudioStore.setState({ isPlaying: true, isLoading: false });
    mocks.resume.mockClear();
    mocks.play.mockClear();

    const fire = mediaActionHandler();
    fire({ action: 'play' });
    fire({ action: 'play' }); // Bluetooth double-tap
    await flush();

    expect(mocks.resume).not.toHaveBeenCalled();
    expect(mocks.play).not.toHaveBeenCalled();
  });

  it('a PLAY while idle resumes through the single controller', async () => {
    const a = makeSong('a');
    useAudioStore.getState().loadSong(a, [a], 0);
    await flush();
    useAudioStore.setState({ isPlaying: false, isLoading: false });
    mocks.isLoaded.mockReturnValue(true);
    mocks.resume.mockClear();

    mediaActionHandler()({ action: 'play' });
    await flush();

    // store.play() → audioService.resume() — the same controller the UI uses.
    expect(mocks.resume).toHaveBeenCalledTimes(1);
  });

  it('PAUSE and STOP both route to the single pause path', async () => {
    const a = makeSong('a');
    useAudioStore.getState().loadSong(a, [a], 0);
    await flush();
    useAudioStore.setState({ isPlaying: true });

    const fire = mediaActionHandler();
    fire({ action: 'pause' });
    expect(mocks.pause).toHaveBeenCalledTimes(1);
    fire({ action: 'stop' });
    expect(mocks.pause).toHaveBeenCalledTimes(2);
  });

  it('SEEK while the native engine owns playback only mirrors the position', async () => {
    const a = makeSong('a');
    useAudioStore.getState().loadSong(a, [a], 0);
    await flush();
    (audioService.isNativeEngineActive as ReturnType<typeof vi.fn>).mockReturnValue(true);

    mediaActionHandler()({ action: 'seek', position: 42_000 });
    await flush();

    // Native already applied the seek — JS mirrors, never re-seeks.
    expect(mocks.syncExternalPosition).toHaveBeenCalledWith(42);
    expect(mocks.seek).not.toHaveBeenCalled();
    (audioService.isNativeEngineActive as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it('SEEK while the WebView engine owns playback issues one seek', async () => {
    const a = makeSong('a');
    useAudioStore.getState().loadSong(a, [a], 0);
    await flush();

    mediaActionHandler()({ action: 'seek', position: 15_000 });
    await flush();

    expect(mocks.seek).toHaveBeenCalledWith(15);
    expect(mocks.syncExternalPosition).not.toHaveBeenCalled();
  });

  it('rapid repeated NEXT presses produce one transition while one is in flight', async () => {
    const [a, b, c] = [makeSong('a'), makeSong('b'), makeSong('c')];
    useAudioStore.getState().loadSong(a, [a, b, c], 0);
    await flush();
    mocks.play.mockClear();

    // Make the next-track play HANG so the transition stays in flight.
    let resolvePlay: (() => void) | null = null;
    mocks.play.mockImplementation(() => new Promise<void>((r) => { resolvePlay = r; }));

    const fire = mediaActionHandler();
    fire({ action: 'next' });
    fire({ action: 'next' }); // double-press while the first is resolving
    await flush();

    expect(mocks.play).toHaveBeenCalledTimes(1); // exactly one transition
    resolvePlay!();
    await flush();
    expect(useQueueStore.getState().currentIndex).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Converging triggers — ended + Bluetooth next + notification/UI next
// arriving for the SAME moment must still produce ONE transition.
// ---------------------------------------------------------------------------

describe('converging next triggers', () => {
  it('ended + Bluetooth next + UI next together produce exactly one transition', async () => {
    const [a, b, c] = [makeSong('a'), makeSong('b'), makeSong('c')];
    useAudioStore.getState().loadSong(a, [a, b, c], 0);
    await flush();
    mocks.playbackId = 21;

    // Hang the next-track play so the first transition stays in flight and
    // every competing trigger lands while it is pending.
    let resolvePlay: (() => void) | null = null;
    mocks.play.mockImplementation(() => new Promise<void>((r) => { resolvePlay = r; }));
    mocks.play.mockClear();

    engineHandler()('ended', { playbackId: 21 }); // song ended
    mediaActionHandler()({ action: 'next' });     // Bluetooth / notification
    useAudioStore.getState().nextSong();          // UI next button
    await flush();

    expect(mocks.play).toHaveBeenCalledTimes(1); // exactly one transition
    resolvePlay!();
    await flush();
    expect(useQueueStore.getState().currentIndex).toBe(1);
    expect(useAudioStore.getState().currentSong?.id).toBe('b');
    expect(mocks.play).toHaveBeenCalledTimes(1); // no second advance afterwards
  });

  it('duplicate ENDED with no playbackId tag still advances exactly once', async () => {
    const [a, b, c] = [makeSong('a'), makeSong('b'), makeSong('c')];
    useAudioStore.getState().loadSong(a, [a, b, c], 0);
    await flush();
    mocks.playbackId = 11;
    mocks.play.mockClear();

    const handler = engineHandler();
    handler('ended'); // untagged — binds to the current session
    handler('ended'); // duplicate untagged — must be dropped
    await flush();
    await flush();

    expect(useQueueStore.getState().currentIndex).toBe(1);
    expect(useAudioStore.getState().currentSong?.id).toBe('b');
    expect(mocks.play).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Repeat / shuffle modes — ended never double-advances, modes stay honest
// ---------------------------------------------------------------------------

describe('repeat and shuffle transitions', () => {
  it('repeat-one replays the SAME song on ended — no queue advance, one play', async () => {
    const [a, b] = [makeSong('a'), makeSong('b')];
    useAudioStore.getState().loadSong(a, [a, b], 0);
    await flush();
    useQueueStore.setState({ repeatMode: 'one' });
    mocks.playbackId = 31;
    mocks.play.mockClear();

    const handler = engineHandler();
    handler('ended', { playbackId: 31 });
    handler('ended', { playbackId: 31 }); // duplicate — dropped
    await flush();

    expect(useQueueStore.getState().currentIndex).toBe(0); // never advanced
    expect(mocks.play).toHaveBeenCalledTimes(1);
    expect((mocks.play.mock.calls[0] as unknown as [{ id: string }])[0].id).toBe('a');
  });

  it('shuffle + ended produces exactly one transition to a different track', async () => {
    const [a, b, c] = [makeSong('a'), makeSong('b'), makeSong('c')];
    useAudioStore.getState().loadSong(a, [a, b, c], 0);
    await flush();
    useQueueStore.setState({ isShuffled: true });
    mocks.playbackId = 41;
    mocks.play.mockClear();

    const handler = engineHandler();
    handler('ended', { playbackId: 41 });
    handler('ended', { playbackId: 41 }); // duplicate — dropped
    await flush();

    expect(mocks.play).toHaveBeenCalledTimes(1);
    expect(useAudioStore.getState().currentSong?.id).not.toBe('a');
    expect(useQueueStore.getState().currentIndex).not.toBe(0);
  });

  it('repeat-one — MANUAL next/previous still move; replay belongs to ended only', async () => {
    const [a, b, c] = [makeSong('a'), makeSong('b'), makeSong('c')];
    useAudioStore.getState().loadSong(a, [a, b, c], 0);
    await flush();
    useQueueStore.setState({ repeatMode: 'one' });
    mocks.play.mockClear();

    useAudioStore.getState().nextSong();
    await flush();
    expect(useAudioStore.getState().currentSong?.id).toBe('b');
    expect(mocks.play).toHaveBeenCalledTimes(1);

    useAudioStore.getState().previousSong();
    await flush();
    expect(useAudioStore.getState().currentSong?.id).toBe('a');
    expect(mocks.play).toHaveBeenCalledTimes(2);
  });

  it('repeat-one — a FAILED track is skipped forward exactly once, never replayed', async () => {
    const [a, b, c] = [makeSong('a'), makeSong('b'), makeSong('c')];
    useAudioStore.getState().loadSong(a, [a, b, c], 0);
    await flush();
    useQueueStore.setState({ repeatMode: 'one' });
    // Reset the module-level failure counter deterministically.
    engineHandler()('playing');
    mocks.playbackId = 71;
    mocks.play.mockClear();

    // The engine marks the track failed, then ends it — the bounded
    // auto-skip must win over repeat-one's replay instinct.
    useAudioStore.setState({ error: 'Stream failed' });
    engineHandler()('ended', { playbackId: 71 });

    // Auto-skip backs off 500ms before the next transition (real timers).
    await new Promise((r) => setTimeout(r, 700));
    await deepFlush();

    expect(useQueueStore.getState().currentIndex).toBe(1);
    expect(useAudioStore.getState().currentSong?.id).toBe('b');
    expect(mocks.play).toHaveBeenCalledTimes(1); // one skip — not a replay loop
  });
});

// ---------------------------------------------------------------------------
// Autoplay end-of-queue — extend + advance exactly once; a newer user
// command mid-fetch always wins.
// ---------------------------------------------------------------------------

describe('autoplay end-of-queue', () => {
  it('extends the queue at the end and advances exactly once', async () => {
    mocks.getRecommendations.mockImplementation(
      (): Promise<Song[]> => Promise.resolve([makeSong('c'), makeSong('d')]),
    );
    const [a, b] = [makeSong('a'), makeSong('b')];
    useQueueStore.setState({ autoplayEnabled: true });
    useAudioStore.getState().loadSong(b, [a, b], 1); // last track
    await flush();
    mocks.playbackId = 51;
    mocks.play.mockClear();

    const handler = engineHandler();
    handler('ended', { playbackId: 51 });
    handler('ended', { playbackId: 51 }); // duplicate — dropped
    await deepFlush();

    const qs = useQueueStore.getState();
    expect(qs.queue.map(s => s.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(qs.currentIndex).toBe(2);
    expect(useAudioStore.getState().currentSong?.id).toBe('c');
    expect(mocks.play).toHaveBeenCalledTimes(1); // one advance, not two
  });

  it('a song click mid-autoplay-fetch aborts the stale transition', async () => {
    let resolveRecs!: (songs: Song[]) => void;
    mocks.getRecommendations.mockImplementation(
      () => new Promise<Song[]>((r) => { resolveRecs = r; }),
    );
    const [a, b] = [makeSong('a'), makeSong('b')];
    useQueueStore.setState({ autoplayEnabled: true });
    useAudioStore.getState().loadSong(b, [a, b], 1);
    await flush();
    mocks.playbackId = 52;

    // The last track ends — autoplay recommendation fetch hangs in flight.
    engineHandler()('ended', { playbackId: 52 });
    await deepFlush(); // settle until the hung recommendation fetch is reached
    expect(mocks.getRecommendations).toHaveBeenCalledTimes(1);

    // User clicks song A while recommendations are still resolving.
    mocks.play.mockClear();
    useAudioStore.getState().loadSong(a, [a, b], 0);
    await flush();
    expect(useAudioStore.getState().currentSong?.id).toBe('a');
    expect(mocks.play).toHaveBeenCalledTimes(1);

    // Recommendations finally arrive — the stale autoplay transition must
    // NOT overwrite the newer click.
    resolveRecs([makeSong('c'), makeSong('d')]);
    await deepFlush();

    expect(useAudioStore.getState().currentSong?.id).toBe('a');
    expect(useQueueStore.getState().currentIndex).toBe(0);
    expect(mocks.play).toHaveBeenCalledTimes(1); // only the click played
  });
});

// ---------------------------------------------------------------------------
// Foreground/background — queue state survives every transition
// ---------------------------------------------------------------------------

describe('foreground/background queue preservation', () => {
  it('backgrounding flushes the debounced queue write synchronously', async () => {
    const [a, b] = [makeSong('a'), makeSong('b')];
    useAudioStore.getState().loadSong(a, [a, b], 0);
    await flush();

    // A queue mutation inside the 500ms debounce window, right before the
    // app backgrounds — it must not be lost.
    useQueueStore.getState().addToQueue(makeSong('c'));

    const handler = mocks.bgHandlers[mocks.bgHandlers.length - 1];
    expect(handler).toBeDefined();
    handler(true); // moving to background

    const raw = JSON.parse(localStorage.getItem('playback-queue') || '{}');
    expect(raw.queue.map((s: Song) => s.id)).toEqual(['a', 'b', 'c']);
    expect(raw.currentIndex).toBe(0);
    expect(mocks.saveImmediate).toHaveBeenCalledTimes(1); // playback snapshot too
  });

  it('restores queue, index, mode and position after process recreation', () => {
    mocks.loadPersistence.mockReturnValue({
      currentSong: makeSong('b'),
      queue: [makeSong('a'), makeSong('b'), makeSong('c')],
      currentIndex: 1,
      progress: 42,
      duration: 200,
      volume: 0.5,
      isShuffled: false,
      repeatMode: 'all',
      originalQueue: [],
    });

    useAudioStore.getState().restoreFromPersistence();

    const qs = useQueueStore.getState();
    expect(qs.queue.map(s => s.id)).toEqual(['a', 'b', 'c']);
    expect(qs.currentIndex).toBe(1);
    expect(qs.repeatMode).toBe('all');
    const audio = useAudioStore.getState();
    expect(audio.currentSong?.id).toBe('b');
    expect(audio.progress).toBe(42);
    expect(audio.isPlaying).toBe(false); // restored, not playing yet
  });
});

// ---------------------------------------------------------------------------
// Queue mutations against live playback
// ---------------------------------------------------------------------------

describe('queue mutations against live playback', () => {
  it('removing the CURRENTLY PLAYING song swaps in the replacement exactly once', async () => {
    const [a, b, c] = [makeSong('a'), makeSong('b'), makeSong('c')];
    useAudioStore.getState().loadSong(b, [a, b, c], 1);
    await flush();
    useAudioStore.setState({ isPlaying: true });
    mocks.play.mockClear();

    useQueueStore.getState().removeFromQueue(1);
    await deepFlush();

    expect(useQueueStore.getState().queue.map(s => s.id)).toEqual(['a', 'c']);
    expect(useQueueStore.getState().currentIndex).toBe(1); // now 'c'
    expect(mocks.play).toHaveBeenCalledTimes(1);
    expect((mocks.play.mock.calls[0] as unknown as [{ id: string }])[0].id).toBe('c');
  });

  it('double-clicking the same row while it is loading does not restart playback', () => {
    const [a, b] = [makeSong('a'), makeSong('b')];
    // Make the play HANG so the first click stays in the loading state.
    mocks.play.mockImplementation(() => new Promise<void>(() => {}));

    useAudioStore.getState().loadSong(a, [a, b], 0);
    useAudioStore.getState().loadSong(a, [a, b], 0); // rapid second click

    expect(mocks.play).toHaveBeenCalledTimes(1); // no restart, no second queue replace
  });
});

// ---------------------------------------------------------------------------
// Crossfade — timing and state transitions.
// The service is a stateful fake (idle → prepared → fading); these tests pin
// the store's trigger/claim/yield rules: one fade per session, manual next
// always wins, failures degrade to the normal ended-path advance.
// ---------------------------------------------------------------------------

describe('crossfade timing and state transitions', () => {
  function enableCrossfade(duration = 6) {
    useQueueStore.setState({ crossfadeEnabled: true, crossfadeDurationSec: duration });
  }

  /** Store behaves as if track ids[startIndex] is PLAYING on the html engine.
   *  The play mock bumps the session id exactly like the real engine does.
   *  Session ids are monotonically unique per setup — exactly like the real
   *  engine — so the one-claim-per-session crossfade gate can never leak
   *  between tests. */
  let sessionSeq = 100;
  function setupPlaying(ids: string[], startIndex = 0, session = ++sessionSeq) {
    mocks.play.mockImplementation(() => {
      mocks.playbackId += 1;
      return Promise.resolve();
    });
    const songs = ids.map((id) => makeSong(id));
    useAudioStore.getState().loadSong(songs[startIndex], songs, startIndex);
    mocks.playbackId = session;
    useAudioStore.setState({
      isPlaying: true,
      isLoading: false,
      currentSong: songs[startIndex],
      error: null,
    });
    mocks.play.mockClear();
    return songs;
  }

  it('crossfade DISABLED — near-end progress never prepares or starts a fade', async () => {
    setupPlaying(['a', 'b', 'c']);
    engineHandler()('progress', 197); // inside the would-be fade window
    await deepFlush();
    expect(mocks.prepareCrossfadeIn).not.toHaveBeenCalled();
    expect(mocks.startCrossfadeIn).not.toHaveBeenCalled();
    expect(useQueueStore.getState().currentIndex).toBe(0);
  });

  it('crossfade ENABLED — the fade window prepares and starts exactly one fade', async () => {
    enableCrossfade(6);
    setupPlaying(['a', 'b', 'c']);
    engineHandler()('progress', 195); // duration 200, fade 6 → window open
    await deepFlush();

    expect(mocks.prepareCrossfadeIn).toHaveBeenCalledTimes(1);
    expect((mocks.prepareCrossfadeIn.mock.calls[0] as unknown as [Song])[0].id).toBe('b');
    expect(mocks.startCrossfadeIn).toHaveBeenCalledTimes(1);
    expect(mocks.startCrossfadeIn).toHaveBeenCalledWith(6);
    // The queue committed to the prepared track exactly once.
    expect(useQueueStore.getState().currentIndex).toBe(1);
    // The fade replaces the ended-path transition — no normal play().
    expect(mocks.play).not.toHaveBeenCalled();
  });

  it('rapid progress ticks claim the session ONCE — one prepare, one fade', async () => {
    enableCrossfade(6);
    setupPlaying(['a', 'b', 'c']);
    const handler = engineHandler();
    handler('progress', 195);
    await deepFlush();
    expect(mocks.prepareCrossfadeIn).toHaveBeenCalledTimes(1);

    // Past the 250ms progress throttle — a later window tick must hit the
    // session claim and NOT retrigger.
    await new Promise((r) => setTimeout(r, 300));
    handler('progress', 198);
    await deepFlush();

    expect(mocks.prepareCrossfadeIn).toHaveBeenCalledTimes(1);
    expect(mocks.startCrossfadeIn).toHaveBeenCalledTimes(1);
    expect(useQueueStore.getState().currentIndex).toBe(1);
  });

  it('repeat-one — no crossfade even deep inside the fade window', async () => {
    enableCrossfade(6);
    setupPlaying(['a', 'b']);
    useQueueStore.setState({ repeatMode: 'one' });
    engineHandler()('progress', 198);
    await deepFlush();
    expect(mocks.prepareCrossfadeIn).not.toHaveBeenCalled();
    expect(mocks.startCrossfadeIn).not.toHaveBeenCalled();
  });

  it('next UNAVAILABLE — last track with repeat-off never prepares a fade', async () => {
    enableCrossfade(6);
    setupPlaying(['a', 'b', 'c'], 2);
    engineHandler()('progress', 196);
    await deepFlush();
    expect(mocks.prepareCrossfadeIn).not.toHaveBeenCalled();
  });

  it('track too short (duration <= 2x fade) — never fades', async () => {
    enableCrossfade(6);
    setupPlaying(['a', 'b', 'c']);
    (audioService.getDuration as ReturnType<typeof vi.fn>).mockReturnValue(10);
    engineHandler()('progress', 6); // 10 - 6 = 4 ≤ fade, but duration ≤ fade*2
    await deepFlush();
    expect(mocks.prepareCrossfadeIn).not.toHaveBeenCalled();
    (audioService.getDuration as ReturnType<typeof vi.fn>).mockReturnValue(200);
  });

  it('paused or loading playback never triggers a fade', async () => {
    enableCrossfade(6);
    setupPlaying(['a', 'b', 'c']);
    useAudioStore.setState({ isPlaying: false });
    engineHandler()('progress', 196);
    await deepFlush();
    expect(mocks.prepareCrossfadeIn).not.toHaveBeenCalled();

    useAudioStore.setState({ isPlaying: true, isLoading: true });
    await new Promise((r) => setTimeout(r, 300)); // clear the progress throttle
    engineHandler()('progress', 197);
    await deepFlush();
    expect(mocks.prepareCrossfadeIn).not.toHaveBeenCalled();
  });

  it('next stream FAILS to prepare — queue untouched; the ended path still advances once', async () => {
    enableCrossfade(6);
    setupPlaying(['a', 'b', 'c']);
    mocks.prepareCrossfadeIn.mockImplementation((): Promise<boolean> => Promise.resolve(false));

    engineHandler()('progress', 195);
    await deepFlush();

    expect(mocks.startCrossfadeIn).not.toHaveBeenCalled();
    expect(useQueueStore.getState().currentIndex).toBe(0); // queue untouched

    // The track then ends naturally — the normal path advances exactly once.
    engineHandler()('ended', { playbackId: mocks.playbackId });
    await deepFlush();
    expect(useQueueStore.getState().currentIndex).toBe(1);
    expect(mocks.play).toHaveBeenCalledTimes(1);
  });

  it('MANUAL NEXT while a fade is preparing — fade cancelled, exactly one advance', async () => {
    enableCrossfade(6);
    setupPlaying(['a', 'b', 'c']);
    let resolvePrepare!: (v: boolean) => void;
    mocks.prepareCrossfadeIn.mockImplementation(
      () => new Promise<boolean>((r) => { resolvePrepare = r; }),
    );

    engineHandler()('progress', 195);
    await flush(); // trigger runs; prepare hangs in flight
    expect(mocks.prepareCrossfadeIn).toHaveBeenCalledTimes(1);

    useAudioStore.getState().nextSong(); // manual next owns the transition
    await deepFlush();
    expect(useQueueStore.getState().currentIndex).toBe(1);
    expect(mocks.play).toHaveBeenCalledTimes(1);

    // The prepared stream lands late — it must NOT start a fade over the
    // newer track (the manual play bumped the session id).
    resolvePrepare(true);
    await deepFlush();
    expect(mocks.startCrossfadeIn).not.toHaveBeenCalled();
    expect(mocks.cancelCrossfade).toHaveBeenCalled();
    expect(useQueueStore.getState().currentIndex).toBe(1); // no double advance
    expect(mocks.play).toHaveBeenCalledTimes(1);
  });

  it('MANUAL NEXT while a fade is RUNNING — one further advance, no second fade', async () => {
    enableCrossfade(6);
    setupPlaying(['a', 'b', 'c']);
    engineHandler()('progress', 195);
    await deepFlush();
    expect(mocks.crossfadePhase).toBe('fading');
    expect(useQueueStore.getState().currentIndex).toBe(1); // fade committed to b
    mocks.play.mockClear();

    useAudioStore.getState().nextSong(); // user skips during the fade
    await deepFlush();

    expect(useQueueStore.getState().currentIndex).toBe(2);
    expect(useAudioStore.getState().currentSong?.id).toBe('c');
    expect(mocks.play).toHaveBeenCalledTimes(1); // exactly one further advance
    expect(mocks.prepareCrossfadeIn).toHaveBeenCalledTimes(1); // no second fade
  });

  it('startCrossfadeIn REJECTED — falls back to a normal play of the committed track', async () => {
    enableCrossfade(6);
    setupPlaying(['a', 'b', 'c']);
    mocks.startCrossfadeIn.mockReturnValueOnce(false); // hand-off impossible

    engineHandler()('progress', 195);
    await deepFlush();

    // The queue committed and the committed track plays via the normal path.
    expect(useQueueStore.getState().currentIndex).toBe(1);
    expect(mocks.play).toHaveBeenCalledTimes(1);
    expect((mocks.play.mock.calls[0] as unknown as [Song])[0].id).toBe('b');
    expect(mocks.cancelCrossfade).toHaveBeenCalled();
  });

  it('SHUFFLE — the fade commits exactly the track that was prepared (preselect)', async () => {
    enableCrossfade(6);
    setupPlaying(['a', 'b', 'c', 'd']);
    useQueueStore.setState({ isShuffled: true });

    engineHandler()('progress', 195);
    await deepFlush();

    const prepared = (mocks.prepareCrossfadeIn.mock.calls[0] as unknown as [Song])[0];
    expect(prepared.id).not.toBe('a'); // peek never returns the current track
    // The commit landed on the SAME track that was buffered — no random race.
    const qs = useQueueStore.getState();
    expect(qs.queue[qs.currentIndex].id).toBe(prepared.id);
    expect(mocks.startCrossfadeIn).toHaveBeenCalledTimes(1);
  });

  it('background playback — the trigger never fires while backgrounded', async () => {
    enableCrossfade(6);
    setupPlaying(['a', 'b', 'c']);
    const bg = backgroundPlaybackService.getIsBackground as ReturnType<typeof vi.fn>;
    bg.mockReturnValue(true);

    engineHandler()('progress', 196);
    await deepFlush();
    expect(mocks.prepareCrossfadeIn).not.toHaveBeenCalled();
    bg.mockReturnValue(false);
  });

  it('backgrounding during a RUNNING fade completes it instantly', async () => {
    enableCrossfade(6);
    setupPlaying(['a', 'b', 'c']);
    engineHandler()('progress', 195);
    await deepFlush();
    expect(mocks.crossfadePhase).toBe('fading');

    const handler = mocks.bgHandlers[mocks.bgHandlers.length - 1];
    handler(true); // moving to background

    expect(mocks.finishCrossfadeNow).toHaveBeenCalledTimes(1);
    expect(mocks.crossfadePhase).toBe('idle'); // never left half-fading
  });
});
