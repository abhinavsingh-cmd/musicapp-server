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
