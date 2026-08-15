import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// AudioService concurrency regression tests — the REAL engine class with
// mocked providers/platform services. Verifies that an old async stream
// resolution can never replace a newer song, and that element callbacks from
// a superseded track cannot change the current state.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  engineParams: vi.fn(),
  // Native-engine plumbing: queued playAudioUrl results and the captured
  // mediaAction listener so tests can inject lifecycle events (ended).
  nativeResults: [] as Array<{ started: boolean; generation?: number }>,
  nativeHandlers: [] as Array<(event: { action: string; generation?: number }) => void>,
}));

vi.mock('../providers', () => ({
  resolvePlayableSource: mocks.resolve,
  playableToEngineParams: mocks.engineParams,
  toTrack: (s: any) => ({
    id: s.id,
    title: s.title,
    artist: s.artist,
    provider: 'youtube',
    externalId: s.youtubeId,
    artwork: s.coverArt,
    durationMs: (s.duration || 0) * 1000,
  }),
  toSong: (t: any) => t,
  providerRegistry: { get: () => undefined },
}));

vi.mock('./backgroundPlaybackService', () => ({
  backgroundPlaybackService: {
    init: vi.fn(),
    registerAudioElement: vi.fn(),
    unregisterAudioElement: vi.fn(),
    onInterruption: vi.fn(),
    onReconnect: vi.fn(),
    onBackgroundChange: vi.fn(),
  },
}));

vi.mock('./audioEffectsService', () => ({
  audioEffectsService: {
    init: vi.fn(() => Promise.resolve()),
    resume: vi.fn(() => Promise.resolve()),
    destroy: vi.fn(),
    audioContextState: 'suspended',
    isReady: false,
    enabled: false,
    gains: [],
    getFilters: () => [],
    getAudioElement: () => null,
  },
}));

vi.mock('./backgroundAudio', () => ({
  backgroundAudio: {
    startService: vi.fn(() => Promise.resolve()),
    stopService: vi.fn(() => Promise.resolve()),
    playAudioUrl: vi.fn(() => Promise.resolve(mocks.nativeResults.shift() ?? { started: false })),
    stopAudio: vi.fn(() => Promise.resolve()),
    pauseAudio: vi.fn(() => Promise.resolve()),
    resumeAudio: vi.fn(() => Promise.resolve()),
    seekAudio: vi.fn(() => Promise.resolve()),
    setVolume: vi.fn(() => Promise.resolve()),
    onMediaAction: vi.fn((cb: (event: { action: string; generation?: number }) => void) => {
      mocks.nativeHandlers.push(cb);
      return Promise.resolve(null);
    }),
    getPlaybackState: vi.fn(() => Promise.resolve({ nativeActive: false })),
    acknowledgeEnded: vi.fn(() => Promise.resolve()),
    updateMetadata: vi.fn(() => Promise.resolve()),
    updatePlaybackState: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('./youtubePlayerService', () => ({
  youtubePlayerService: {
    subscribe: vi.fn(() => () => {}),
    load: vi.fn(() => Promise.resolve()),
    stop: vi.fn(),
    destroy: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    getCurrentTime: vi.fn(() => 0),
    getDuration: vi.fn(() => 0),
    getCurrentSongId: vi.fn(() => null),
    markStreamWorking: vi.fn(),
  },
}));

vi.mock('../utils/toast', () => ({ showToast: vi.fn() }));

vi.mock('./metricsCollector', () => ({
  metricsCollector: { pushStreamLatency: vi.fn(), pushBufferSample: vi.fn() },
}));

import { AudioService } from './audioService';
import { backgroundAudio } from './backgroundAudio';
import type { Song } from '../types/music';

function makeSong(id: string): Song {
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
    isFavorite: false,
    playCount: 0,
  } as Song;
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.resolve.mockReset();
  mocks.engineParams.mockReset();
  mocks.engineParams.mockReturnValue({ mode: 'html', src: 'blob:local', isLocalFile: true });
  mocks.nativeResults.length = 0;
  mocks.nativeHandlers.length = 0;
  delete (window as any).Capacitor;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AudioService — stale async stream resolution', () => {
  it('a slow resolution for an OLD track never replaces the newer song', async () => {
    const svc = new AudioService();
    const events: Array<[string, any]> = [];
    svc.subscribe((e, d) => events.push([e, d]));

    let resolveOld: ((v: unknown) => void) | null = null;
    mocks.resolve.mockImplementation((track: any) =>
      track.id === 'old'
        ? new Promise((r) => { resolveOld = r; })
        : Promise.resolve({ kind: 'html' }),
    );

    const playOld = svc.play(makeSong('old'), [], 0);
    // While the old track is still resolving its stream, the user clicks
    // a new song.
    svc.play(makeSong('new'), [], 0);
    await flush();

    expect(svc.getCurrentSong()?.id).toBe('new');
    const session = svc.getCurrentPlaybackId();

    // The old resolution finally lands — it MUST be discarded as stale.
    resolveOld!({ kind: 'html' });
    await playOld;
    await flush();

    expect(svc.getCurrentSong()?.id).toBe('new');
    expect(svc.getCurrentPlaybackId()).toBe(session); // no takeover happened
    // No lifecycle event may ever be emitted for the superseded track after
    // the newer one became current.
    expect(events.some(([e, d]) => e === 'play' && d?.song?.id === 'old')).toBe(false);
    expect(events.some(([e]) => e === 'ended' || e === 'error')).toBe(false);
  });

  it('element callbacks from a superseded track cannot change the current state', async () => {
    const svc = new AudioService();
    const events: Array<[string, any]> = [];
    svc.subscribe((e, d) => events.push([e, d]));

    mocks.resolve.mockResolvedValue({ kind: 'html' });

    svc.play(makeSong('doomed'), [], 0);
    await flush();
    const element = (svc as unknown as { htmlAudio: HTMLAudioElement | null }).htmlAudio;
    expect(element).not.toBeNull();

    // The user stops — the in-flight session is superseded.
    svc.stop();

    // The old element's callbacks arrive late — they must be dropped.
    element!.dispatchEvent(new Event('error'));
    element!.dispatchEvent(new Event('ended'));

    expect(events.some(([e]) => e === 'error')).toBe(false);
    expect(events.some(([e]) => e === 'ended')).toBe(false);
    expect(svc.getState().error).toBeNull();
  });

  it('a pause while a play is resolving wins the race (no late PLAYING state)', async () => {
    const svc = new AudioService();
    const events: Array<[string, any]> = [];
    svc.subscribe((e, d) => events.push([e, d]));

    let resolveStream: ((v: unknown) => void) | null = null;
    mocks.resolve.mockImplementation(
      () => new Promise((r) => { resolveStream = r; }),
    );

    svc.play(makeSong('x'), [], 0);
    expect(svc.getState().isLoading).toBe(true);

    // Pause before the stream resolves — pause must win deterministically.
    svc.pause();
    expect(svc.getState().isPlaying).toBe(false);
    expect(svc.getState().isLoading).toBe(false);

    // The resolution lands late — it must NOT start playback.
    resolveStream!({ kind: 'html' });
    await flush();

    expect(svc.getState().isPlaying).toBe(false);
    expect(events.some(([e]) => e === 'playing' || e === 'play')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Native completion dedupe — one completion may advance the queue only once,
// no matter how many times/when the native 'ended' notification is delivered.
// ---------------------------------------------------------------------------

describe('AudioService — native ended dedupe', () => {
  function setupNative() {
    (window as any).Capacitor = {};
    mocks.resolve.mockResolvedValue({ kind: 'html' });
    mocks.engineParams.mockReturnValue({ mode: 'html', src: 'https://stream.example/x', isLocalFile: false });
  }

  it('a duplicate ended for the same native session is consumed exactly once', async () => {
    setupNative();
    const svc = new AudioService();
    const events: Array<[string, any]> = [];
    svc.subscribe((e, d) => events.push([e, d]));

    mocks.nativeResults.push({ started: true, generation: 1 });
    await svc.play(makeSong('x'), [], 0);
    await flush();

    const handler = mocks.nativeHandlers[mocks.nativeHandlers.length - 1];
    handler({ action: 'ended', generation: 1 });
    handler({ action: 'ended', generation: 1 }); // duplicate — must be dropped

    expect(events.filter(([e]) => e === 'ended')).toHaveLength(1);
  });

  it('consumeNativeEnded() blocks a late duplicate after endedPending recovery', async () => {
    setupNative();
    const svc = new AudioService();
    const events: Array<[string, any]> = [];
    svc.subscribe((e, d) => events.push([e, d]));

    mocks.nativeResults.push({ started: true, generation: 1 });
    await svc.play(makeSong('x'), [], 0);
    await flush();

    // The store's reconnect recovery already took over queue duty for this
    // completion; a late raw notification must become a no-op.
    svc.consumeNativeEnded();
    mocks.nativeHandlers[0]({ action: 'ended', generation: 1 });

    expect(events.filter(([e]) => e === 'ended')).toHaveLength(0);
  });

  it('a late ended for a REPLACED track (old generation) cannot advance the new track', async () => {
    setupNative();
    const svc = new AudioService();
    const events: Array<[string, any]> = [];
    svc.subscribe((e, d) => events.push([e, d]));

    mocks.nativeResults.push({ started: true, generation: 1 });
    await svc.play(makeSong('a'), [], 0);
    await flush();

    // User skips — a NEW native session (generation 2) starts.
    mocks.nativeResults.push({ started: true, generation: 2 });
    await svc.play(makeSong('b'), [], 0);
    await flush();

    const handler = mocks.nativeHandlers[mocks.nativeHandlers.length - 1];
    // The OLD track's completion arrives late — stale generation, dropped.
    handler({ action: 'ended', generation: 1 });
    expect(events.filter(([e]) => e === 'ended')).toHaveLength(0);

    // The CURRENT session's completion is still honored normally.
    handler({ action: 'ended', generation: 2 });
    expect(events.filter(([e]) => e === 'ended')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Engine ownership — exactly ONE authoritative engine may be active. Claiming
// an engine must deterministically release whichever engine owned before.
// ---------------------------------------------------------------------------

describe('AudioService — engine ownership exclusivity', () => {
  it('claiming the html engine releases the native engine (single stopAudio)', async () => {
    (window as any).Capacitor = {};
    mocks.resolve.mockResolvedValue({ kind: 'html' });
    const svc = new AudioService();

    // 1) Native play — remote stream on Android routes to the MediaPlayer.
    mocks.engineParams.mockReturnValue({ mode: 'html', src: 'https://stream.example/x', isLocalFile: false });
    mocks.nativeResults.push({ started: true, generation: 1 });
    await svc.play(makeSong('a'), [], 0);
    await flush();
    expect(svc.isNativeEngineActive()).toBe(true);

    // 2) Next track resolves to a local blob — html engine must take over and
    //    the native session must be released exactly once (no duplicate stops).
    //    Ownership release happens before stream resolution, so we verify it
    //    without awaiting the full html pipeline (which needs real media
    //    events that jsdom never fires).
    (backgroundAudio.stopAudio as ReturnType<typeof vi.fn>).mockClear();
    mocks.engineParams.mockReturnValue({ mode: 'html', src: 'blob:local', isLocalFile: true });
    void svc.play(makeSong('b'), [], 0);
    await flush();

    expect(svc.isNativeEngineActive()).toBe(false);
    expect(backgroundAudio.stopAudio).toHaveBeenCalledTimes(1);
  });

  it('native→native keeps ownership with exactly one stop per transition', async () => {
    (window as any).Capacitor = {};
    (backgroundAudio.stopAudio as ReturnType<typeof vi.fn>).mockClear();
    mocks.resolve.mockResolvedValue({ kind: 'html' });
    mocks.engineParams.mockReturnValue({ mode: 'html', src: 'https://stream.example/x', isLocalFile: false });
    const svc = new AudioService();

    mocks.nativeResults.push({ started: true, generation: 1 });
    await svc.play(makeSong('a'), [], 0);
    await flush();
    mocks.nativeResults.push({ started: true, generation: 2 });
    await svc.play(makeSong('b'), [], 0);
    await flush();

    // The next track's stop-before-resolve issues exactly one stopAudio for
    // the transition — claimEngine then re-claims without a second stop.
    expect(svc.isNativeEngineActive()).toBe(true);
    expect(backgroundAudio.stopAudio).toHaveBeenCalledTimes(1);
  });

  it('stop() releases engine ownership completely', async () => {
    (window as any).Capacitor = {};
    mocks.resolve.mockResolvedValue({ kind: 'html' });
    mocks.engineParams.mockReturnValue({ mode: 'html', src: 'https://stream.example/x', isLocalFile: false });
    const svc = new AudioService();

    mocks.nativeResults.push({ started: true, generation: 1 });
    await svc.play(makeSong('a'), [], 0);
    await flush();
    svc.stop();

    expect(svc.isNativeEngineActive()).toBe(false);
    expect(svc.isLoaded()).toBe(false);
  });
});
