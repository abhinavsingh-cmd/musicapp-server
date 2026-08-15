import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Store-level integration tests for the smart-replacement GATE: the failed
// 'ended' path must try exactly one bounded replacement before falling back
// to the bounded auto-skip — and the queue must never stall or loop.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  play: vi.fn((..._args: unknown[]): Promise<void> => Promise.resolve()),
  pause: vi.fn(),
  resume: vi.fn((): Promise<void> => Promise.resolve()),
  isLoaded: vi.fn(() => false),
  subscribeHandlers: [] as Array<(event: string, data?: unknown) => void>,
  replace: vi.fn(),
  // Monotonic playback session id — matches production semantics so the
  // store's exactly-once 'ended' dedupe never drops a fresh failure.
  playbackId: 0,
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
    getCurrentPlaybackId: vi.fn(() => mocks.playbackId),
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

vi.mock('../services/smartReplaceService', () => ({
  findVerifiedReplacement: mocks.replace,
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
    repeatMode: 'off',
  });
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** Simulate the engine failing the current track (error + ended pair). */
function failCurrentTrack(message = 'Stream expired') {
  mocks.playbackId += 1; // every failure owns a fresh playback session
  const handler = mocks.subscribeHandlers[0];
  handler('error', message);
  handler('ended', { playbackId: mocks.playbackId });
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.play.mockReset();
  mocks.play.mockImplementation(() => Promise.resolve());
  mocks.pause.mockClear();
  mocks.replace.mockReset();
  mocks.replace.mockResolvedValue({ status: 'unavailable' });
  // NOTE: subscribeHandlers is never cleared — the engine subscription is
  // registered exactly once per module lifetime (globalListenersRegistered).
  resetStores();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('audioStore — smart-replacement gate on failure', () => {
  it('verified replacement: same queue slot, metadata intact, playback continues', async () => {
    const a = makeSong('a');
    const b = makeSong('b');
    useAudioStore.getState().loadSong(a, [a, b], 0);
    await flush();

    const replacement = makeSong('a', { youtubeId: 'altvid', audioUrl: 'https://cdn/alt' });
    mocks.replace.mockResolvedValue({ status: 'replaced', replacement });

    failCurrentTrack();
    await flush();

    expect(mocks.replace).toHaveBeenCalledTimes(1);
    // The replacement plays in the SAME slot — the queue never advanced.
    expect(mocks.play).toHaveBeenCalledTimes(2);
    expect(mocks.play.mock.calls[1][0]).toEqual(replacement);
    expect(mocks.play.mock.calls[1][2]).toBe(0);
    expect(useQueueStore.getState().currentIndex).toBe(0);
    const s = useAudioStore.getState();
    expect(s.currentSong).toEqual(replacement);
    expect(s.error).toBeNull();
    expect(s.isLoading).toBe(true);
  });

  it('unavailable replacement: falls through to the bounded auto-skip', async () => {
    const a = makeSong('a');
    const b = makeSong('b');
    useAudioStore.getState().loadSong(a, [a, b], 0);
    await flush();
    mocks.replace.mockResolvedValue({ status: 'unavailable' });

    failCurrentTrack();
    await flush();
    // auto-skip uses exponential backoff — let the bounded retry fire.
    await vi.advanceTimersByTimeAsync(2_500);
    await flush();

    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(useQueueStore.getState().currentIndex).toBe(1); // advanced to B
    expect(useAudioStore.getState().currentSong?.id).toBe('b');
  });

  it('replacement itself fails to play: auto-skips WITHOUT a second replacement attempt', async () => {
    const a = makeSong('a');
    const b = makeSong('b');
    useAudioStore.getState().loadSong(a, [a, b], 0);
    await flush();

    const replacement = makeSong('a', { youtubeId: 'altvid', audioUrl: 'https://cdn/alt' });
    mocks.replace.mockResolvedValue({ status: 'replaced', replacement });
    // loadSong's play already succeeded; the replacement play rejects, and
    // any later play (the auto-skipped next track) resolves again.
    mocks.play.mockImplementationOnce(() => Promise.reject(new Error('alt stream dead')))
      .mockImplementation(() => Promise.resolve());

    failCurrentTrack();
    await flush();
    // Replacement failed -> bounded auto-skip takes over.
    await vi.advanceTimersByTimeAsync(2_500);
    await flush();

    expect(mocks.replace).toHaveBeenCalledTimes(1); // never retried — bounded
    expect(useQueueStore.getState().currentIndex).toBe(1);
    expect(useAudioStore.getState().currentSong?.id).toBe('b');
  });

  it('timeout replacement: falls through to the bounded auto-skip', async () => {
    const a = makeSong('a');
    const b = makeSong('b');
    useAudioStore.getState().loadSong(a, [a, b], 0);
    await flush();
    mocks.replace.mockResolvedValue({ status: 'timeout' });

    failCurrentTrack();
    await flush();
    await vi.advanceTimersByTimeAsync(2_500);
    await flush();

    expect(useQueueStore.getState().currentIndex).toBe(1);
    expect(useAudioStore.getState().currentSong?.id).toBe('b');
  });

  it('a user command during the attempt owns the player — the replacement is dropped', async () => {
    const a = makeSong('a');
    const b = makeSong('b');
    useAudioStore.getState().loadSong(a, [a, b], 0);
    await flush();

    let resolveReplace!: (r: unknown) => void;
    mocks.replace.mockImplementation(() => new Promise((res) => { resolveReplace = res; }));

    failCurrentTrack();
    await flush();
    expect(mocks.replace).toHaveBeenCalledTimes(1);

    // The user presses next while the search is still in flight.
    useAudioStore.getState().nextSong();
    await flush();

    // Now the replacement resolves — it must be silently dropped.
    resolveReplace({ status: 'replaced', replacement: makeSong('a', { youtubeId: 'altvid' }) });
    await flush();

    // Plays: loadSong(a) + nextSong(b) ONLY — no replacement play.
    const played = mocks.play.mock.calls.map((c: any[]) => c[0].id);
    expect(played).toEqual(['a', 'b']);
    expect(useQueueStore.getState().currentIndex).toBe(1);
  });

  it('an identical second failure on the same command never retriggers replacement', async () => {
    const a = makeSong('a');
    useAudioStore.getState().loadSong(a, [a], 0);
    await flush();
    mocks.replace.mockResolvedValue({ status: 'unavailable' });

    failCurrentTrack();
    await flush();

    // A duplicate 'ended' for the SAME session is consumed by the dedupe and
    // the consumed-seq guard — replacement must stay at exactly one attempt.
    const handler = mocks.subscribeHandlers[0];
    handler('error', 'again');
    handler('ended', { playbackId: mocks.playbackId });
    await flush();

    expect(mocks.replace).toHaveBeenCalledTimes(1);
  });
});
