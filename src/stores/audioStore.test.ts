import { vi, describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the playback engine + platform services. The audioStore must be tested
// in isolation: the store's reaction to clicks and engine events is what we
// are verifying, not actual audio output.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  play: vi.fn((): Promise<void> => Promise.resolve()),
  pause: vi.fn(),
  resume: vi.fn((): Promise<void> => Promise.resolve()),
  isLoaded: vi.fn(() => false),
  subscribeHandlers: [] as Array<(event: string, data?: unknown) => void>,
}));

vi.mock('../services/audioServiceInstance', () => ({
  audioService: {
    play: mocks.play,
    pause: mocks.pause,
    resume: mocks.resume,
    isLoaded: mocks.isLoaded,
    seek: vi.fn(),
    setVolume: vi.fn(),
    getDuration: vi.fn(() => 200),
    getCurrentTime: vi.fn(() => 0),
    isNativeEngineActive: vi.fn(() => false),
    syncExternalPosition: vi.fn(),
    adoptNativePlayback: vi.fn(),
    getCurrentPlaybackId: vi.fn(() => 0),
    // Crossfade API — idle defaults keep the progress-driven trigger dormant.
    getCrossfadePhase: vi.fn(() => 'idle'),
    isCrossfading: vi.fn(() => false),
    isHtmlEngineActive: vi.fn(() => false),
    prepareCrossfadeIn: vi.fn(() => Promise.resolve(false)),
    startCrossfadeIn: vi.fn(() => false),
    cancelCrossfade: vi.fn(),
    finishCrossfadeNow: vi.fn(),
    subscribe: vi.fn((cb: (event: string, data?: unknown) => void) => {
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
  playbackPersistenceService: { load: vi.fn(() => null), save: vi.fn(), clear: vi.fn() },
}));

vi.mock('../services/backgroundPlaybackService', () => ({
  backgroundPlaybackService: {
    init: vi.fn(),
    registerAudioElement: vi.fn(),
    onInterruption: vi.fn(),
    onReconnect: vi.fn(),
    onBackgroundChange: vi.fn(),
    getIsBackground: vi.fn(() => false),
  },
}));

vi.mock('../services/backgroundAudio', () => ({
  backgroundAudio: {
    onMediaAction: vi.fn(() => Promise.resolve()),
    startService: vi.fn(() => Promise.resolve()),
    updateMetadata: vi.fn(() => Promise.resolve()),
    updatePlaybackState: vi.fn(() => Promise.resolve()),
    getPlaybackState: vi.fn(() => Promise.resolve({ nativeActive: false })),
    acknowledgeEnded: vi.fn(() => Promise.resolve()),
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
  });
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('audioStore.loadSong — song click safety', () => {
  beforeEach(() => {
    mocks.play.mockClear();
    mocks.play.mockImplementation(() => Promise.resolve());
    mocks.pause.mockClear();
    mocks.isLoaded.mockReturnValue(false);
    resetStores();
  });

  it('rejects an undefined song with a controlled error — no crash, no engine call', () => {
    expect(() =>
      useAudioStore.getState().loadSong(undefined as unknown as Song, [], 0),
    ).not.toThrow();

    const s = useAudioStore.getState();
    expect(s.error).toBeTruthy();
    expect(s.isLoading).toBe(false);
    expect(s.isPlaying).toBe(false);
    expect(mocks.play).not.toHaveBeenCalled();
    expect(useQueueStore.getState().queue).toEqual([]);
  });

  it('rejects a song with a missing id', () => {
    const broken = makeSong('x');
    (broken as { id?: string }).id = undefined as unknown as string;

    expect(() => useAudioStore.getState().loadSong(broken, [broken], 0)).not.toThrow();

    const s = useAudioStore.getState();
    expect(s.error).toBeTruthy();
    expect(s.isPlaying).toBe(false);
    expect(mocks.play).not.toHaveBeenCalled();
  });

  it('rejects a song with a blank/whitespace id', () => {
    const blank = makeSong('   ');
    useAudioStore.getState().loadSong(blank, [blank], 0);

    const s = useAudioStore.getState();
    expect(s.error).toBeTruthy();
    expect(s.isLoading).toBe(false);
    expect(mocks.play).not.toHaveBeenCalled();
    expect(useQueueStore.getState().queue).toEqual([]);
  });

  it('plays a valid song and builds a valid queue', () => {
    const song = makeSong('a');
    useAudioStore.getState().loadSong(song, [song], 0);

    const s = useAudioStore.getState();
    expect(s.currentSong?.id).toBe('a');
    expect(s.isLoading).toBe(true);
    expect(s.error).toBeNull();
    expect(mocks.play).toHaveBeenCalledTimes(1);
    expect(useQueueStore.getState().queue.map(q => q.id)).toEqual(['a']);
  });

  it('never lets an id-less entry from the clicked playlist become a queue item', () => {
    const good = makeSong('good');
    const bad = makeSong('bad', { id: '' });
    const alsoBad = makeSong('also-bad', { id: '   ' });

    useAudioStore.getState().loadSong(good, [bad, alsoBad, good], 2);

    const queue = useQueueStore.getState().queue;
    expect(queue.map(q => q.id)).toEqual(['good']);
    expect(useQueueStore.getState().currentIndex).toBe(0);
    expect(mocks.play).toHaveBeenCalledTimes(1);
  });

  it('rapid double-click plays the same song only once', () => {
    const song = makeSong('dbl');
    const store = useAudioStore.getState();
    store.loadSong(song, [song], 0);
    // Second click lands while the first is still resolving (isLoading=true)
    useAudioStore.getState().loadSong(song, [song], 0);

    expect(mocks.play).toHaveBeenCalledTimes(1);
  });

  it('surfaces a controlled error when play() rejects (e.g. stream resolution failure)', async () => {
    mocks.play.mockImplementation(() => Promise.reject(new Error('No audio source available')));
    const song = makeSong('fail');

    useAudioStore.getState().loadSong(song, [song], 0);
    await flush();

    const s = useAudioStore.getState();
    expect(s.error).toBe('No audio source available');
    expect(s.isLoading).toBe(false);
    expect(s.isPlaying).toBe(false);
  });

  it('an engine "error" event clears a fake PLAYING state', () => {
    // Ensure the engine subscription is registered (happens on first loadSong).
    const song = makeSong('err');
    useAudioStore.getState().loadSong(song, [song], 0);
    expect(mocks.subscribeHandlers.length).toBeGreaterThan(0);

    // Simulate: UI thinks it is playing, then the engine reports failure.
    useAudioStore.setState({ isPlaying: true, isLoading: false });
    const handler = mocks.subscribeHandlers[0];
    handler('error', 'Stream expired');

    const s = useAudioStore.getState();
    expect(s.isPlaying).toBe(false);
    expect(s.isLoading).toBe(false);
    expect(s.error).toBe('Stream expired');
  });

  it('an engine "error" event with non-string payload still resets playback state', () => {
    const song = makeSong('err2');
    useAudioStore.getState().loadSong(song, [song], 0);
    useAudioStore.setState({ isPlaying: true });

    mocks.subscribeHandlers[0]('error', { code: 500 });

    const s = useAudioStore.getState();
    expect(s.isPlaying).toBe(false);
    expect(s.error).toBe('Playback error');
  });
});

// ---------------------------------------------------------------------------
// Regression: permanent-loading scenarios.
//
// Every play attempt MUST exit the loading state. These tests prove it by
// simulating the exact sequences that previously caused a permanent spinner:
//
//   1. Stream resolution hangs → loading timeout must still fire
//   2. 'waiting' events must NOT reset the loading timeout
//   3. Play ceiling must force-clear isLoading even if the engine is deadlocked
// ---------------------------------------------------------------------------
describe('audioStore — permanent-loading regression', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    mocks.play.mockClear();
    mocks.play.mockImplementation(() => Promise.resolve());
    mocks.pause.mockClear();
    mocks.isLoaded.mockReturnValue(false);
    resetStores();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loading timeout fires and clears isLoading even when play() is pending', async () => {
    // Simulate: play() starts but never resolves (stream resolution hung)
    let playResolve: (() => void) | null = null;
    mocks.play.mockImplementation(() => new Promise<void>((resolve) => { playResolve = resolve; }));

    const song = makeSong('hang');
    useAudioStore.getState().loadSong(song, [song], 0);

    const s1 = useAudioStore.getState();
    expect(s1.isLoading).toBe(true);
    expect(s1.error).toBeNull();

    // Fast-forward past the loading timeout (30s)
    vi.advanceTimersByTime(30_000);

    const s2 = useAudioStore.getState();
    expect(s2.isLoading).toBe(false);
    expect(s2.error).toBeTruthy();
    expect(s2.error).toContain('timed out');

    // Clean up: resolve the hanging play so it doesn't leak
    playResolve?.();
  });

  it('"waiting" events do NOT reset the loading timeout', async () => {
    // Simulate: play() starts, audio fires 'waiting' repeatedly
    let playResolve: (() => void) | null = null;
    mocks.play.mockImplementation(() => new Promise<void>((resolve) => { playResolve = resolve; }));

    const song = makeSong('waiting-loop');
    useAudioStore.getState().loadSong(song, [song], 0);
    expect(useAudioStore.getState().isLoading).toBe(true);

    // Emit 10 'waiting' events spaced 2s apart (20s total)
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(2_000);
      mocks.subscribeHandlers[0]?.('waiting');
    }

    // 20s have passed; loading timeout started at t=0, fires at t=30
    // In the old code, each 'waiting' would restart the 30s timer,
    // pushing the fire time to t=50.  Now it must NOT reset.
    vi.advanceTimersByTime(10_000); // t=30

    const s = useAudioStore.getState();
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeTruthy();
    expect(s.error).toContain('timed out');

    playResolve?.();
  });

  it('play ceiling fires and clears isLoading after PLAY_CEILING_MS', async () => {
    // Simulate: play() hangs AND the loading timeout was already consumed
    let playResolve: (() => void) | null = null;
    mocks.play.mockImplementation(() => new Promise<void>((resolve) => { playResolve = resolve; }));

    const song = makeSong('ceiling');
    useAudioStore.getState().loadSong(song, [song], 0);

    // Clear the regular loading timeout (simulate canplay clearing it)
    const handler = mocks.subscribeHandlers[0];
    handler?.('canplay');

    const s1 = useAudioStore.getState();
    expect(s1.isLoading).toBe(false); // canplay cleared it
    expect(s1.error).toBeNull();

    // The 'waiting' event re-sets isLoading (which is correct)
    handler?.('waiting');
    const s2 = useAudioStore.getState();
    expect(s2.isLoading).toBe(true);

    // The play ceiling fires after 60s from the original loadSong call
    vi.advanceTimersByTime(60_000);

    const s3 = useAudioStore.getState();
    expect(s3.isLoading).toBe(false);
    expect(s3.error).toBeTruthy();
    expect(s3.error).toContain('timed out');

    playResolve?.();
  });

  it('loading state is cleared when play() rejects', async () => {
    mocks.play.mockImplementation(() => Promise.reject(new Error('Stream failed')));
    const song = makeSong('reject');
    useAudioStore.getState().loadSong(song, [song], 0);
    await flush();

    const s = useAudioStore.getState();
    expect(s.isLoading).toBe(false);
    expect(s.isPlaying).toBe(false);
    expect(s.error).toBeTruthy();
  });

  it('rapid song clicks never leave isLoading stuck on a stale track', async () => {
    let resolve1: (() => void) | null = null;
    let resolve2: (() => void) | null = null;
    let callCount = 0;

    mocks.play.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return new Promise<void>((r) => { resolve1 = r; });
      return new Promise<void>((r) => { resolve2 = r; });
    });

    const s1 = makeSong('fast1');
    const s2 = makeSong('fast2');

    useAudioStore.getState().loadSong(s1, [s1], 0);
    expect(useAudioStore.getState().isLoading).toBe(true);

    // Second click supersedes the first
    useAudioStore.getState().loadSong(s2, [s2], 0);
    expect(useAudioStore.getState().currentSong?.id).toBe('fast2');

    // Resolve both hanging plays
    resolve1?.();
    resolve2?.();
    await flush();

    // Simulate the engine emitting 'playing' which clears isLoading
    mocks.subscribeHandlers[0]?.('playing');

    const s = useAudioStore.getState();
    expect(s.isPlaying).toBe(true);
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
  });
});
