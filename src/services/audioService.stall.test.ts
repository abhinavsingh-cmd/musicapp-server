import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Bounded mid-stream stall guard for the REAL AudioService (html engine).
//
// A throttled/403'd direct stream can starve the <audio> element (endless
// 'waiting') WITHOUT ever firing 'error' — without the stall guard the
// spinner would spin forever. The guard mirrors the YouTube engine's
// buffering timeout: after 30s of stall it routes through the session's
// SINGLE bounded recovery (fresh resolution -> embedded fallback), and a
// second stall on the same session fails the track instead of looping.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  engineParams: vi.fn(),
  localCopy: vi.fn(),
}));

vi.mock('../providers', () => ({
  resolvePlayableSource: mocks.resolve,
  resolveLocalCopy: mocks.localCopy,
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
    playAudioUrl: vi.fn(() => Promise.resolve({ started: false })),
    stopAudio: vi.fn(() => Promise.resolve()),
    pauseAudio: vi.fn(() => Promise.resolve()),
    resumeAudio: vi.fn(() => Promise.resolve()),
    seekAudio: vi.fn(() => Promise.resolve()),
    setVolume: vi.fn(() => Promise.resolve()),
    onMediaAction: vi.fn(() => Promise.resolve(null)),
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
import type { Song } from '../types/music';

/** Deterministic stand-in for HTMLAudioElement (jsdom cannot play media). */
class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  src = '';
  volume = 1;
  paused = true;
  muted = false;
  playbackRate = 1;
  preload = '';
  readyState = 0;
  duration: number = NaN;
  currentTime = 0;
  error: { code: number; message: string } | null = null;
  constructor() {
    super();
    FakeAudio.instances.push(this);
  }
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void { this.paused = true; }
  load(): void {}
  removeAttribute(name: string): void { if (name === 'src') this.src = ''; }
}

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
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

function makeReady(el: FakeAudio, duration = 200): void {
  el.readyState = 3;
  el.duration = duration;
  el.dispatchEvent(new Event('canplay'));
}

/** Play a song on the html engine with the given src and reach PLAYING. */
async function setupPlaying(
  svc: AudioService,
  song: Song,
  src: string,
  isLocalFile: boolean,
): Promise<FakeAudio> {
  mocks.resolve.mockResolvedValue({ kind: 'html' });
  mocks.engineParams.mockReturnValue({ mode: 'html', src, isLocalFile });
  const p = svc.play(song, [], 0);
  await flush();
  const el = FakeAudio.instances[FakeAudio.instances.length - 1];
  makeReady(el, song.duration || 200);
  await flush();
  el.dispatchEvent(new Event('playing'));
  await p;
  await flush();
  return el;
}

const realAudio = globalThis.Audio;

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as any).Audio = FakeAudio;
  FakeAudio.instances = [];
  mocks.resolve.mockReset();
  mocks.engineParams.mockReset();
  mocks.localCopy.mockReset();
  mocks.localCopy.mockReturnValue(null);
  delete (window as any).Capacitor;
});

afterEach(() => {
  vi.useRealTimers();
  (globalThis as any).Audio = realAudio;
});

describe('AudioService — bounded html-engine stall guard', () => {
  it('a stalled stream recovers exactly once after the 30s stall budget (fresh resolution, no error/ended)', async () => {
    const svc = new AudioService();
    const events: Array<[string, any]> = [];
    svc.subscribe((e, d) => events.push([e, d]));
    const song = makeSong('stall1');
    const el = await setupPlaying(svc, song, 'https://cdn.example/stream1', false);

    // Recovery-time behavior only: no local copy, fresh remote resolution.
    mocks.resolve.mockClear();
    mocks.resolve.mockResolvedValue({ kind: 'html' });
    mocks.engineParams.mockReturnValue({ mode: 'html', src: 'https://fresh.example/stream2', isLocalFile: false });

    el.dispatchEvent(new Event('waiting')); // stream starves — no 'error' ever fires
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();

    expect(mocks.resolve).toHaveBeenCalledTimes(1); // one bounded recovery
    expect(el.src).toBe('https://fresh.example/stream2'); // fresh stream assigned
    expect(svc.getState().isPlaying).toBe(true); // playback continues
    expect(events.filter(([e]) => e === 'error')).toHaveLength(0);
    expect(events.filter(([e]) => e === 'ended')).toHaveLength(0);
  });

  it('a genuine resume (playing) disarms the stall guard — no spurious recovery', async () => {
    const svc = new AudioService();
    const song = makeSong('stall2');
    const el = await setupPlaying(svc, song, 'https://cdn.example/stream1', false);

    mocks.resolve.mockClear();
    el.dispatchEvent(new Event('waiting'));
    await vi.advanceTimersByTimeAsync(10_000);
    el.dispatchEvent(new Event('playing')); // stream recovered on its own
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();

    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(svc.getState().isPlaying).toBe(true);
  });

  it('a deliberate user pause disarms the stall guard — no spurious recovery', async () => {
    const svc = new AudioService();
    const song = makeSong('stall3');
    const el = await setupPlaying(svc, song, 'https://cdn.example/stream1', false);

    mocks.resolve.mockClear();
    el.dispatchEvent(new Event('waiting'));
    await vi.advanceTimersByTimeAsync(10_000);
    el.dispatchEvent(new Event('pause')); // user hit pause — not a stall
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();

    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(svc.getState().isPlaying).toBe(false);
  });

  it('a second stall on the same session fails the track instead of looping recovery', async () => {
    const svc = new AudioService();
    const events: Array<[string, any]> = [];
    svc.subscribe((e, d) => events.push([e, d]));
    const song = makeSong('stall4');
    const el = await setupPlaying(svc, song, 'https://cdn.example/stream1', false);

    // First stall: bounded recovery succeeds (fresh stream assigned + canplay).
    mocks.resolve.mockClear();
    mocks.resolve.mockResolvedValue({ kind: 'html' });
    mocks.engineParams.mockReturnValue({ mode: 'html', src: 'https://fresh.example/stream2', isLocalFile: false });
    el.dispatchEvent(new Event('waiting'));
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();
    el.dispatchEvent(new Event('canplay')); // let the recovered stream start
    await flush();

    // Second stall on the SAME session: recovery budget is spent → the track
    // fails (error + ended) so the queue advances; no second re-resolve.
    mocks.resolve.mockClear();
    el.dispatchEvent(new Event('waiting'));
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();

    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(events.filter(([e]) => e === 'error').length).toBeGreaterThan(0);
    expect(events.filter(([e]) => e === 'ended').length).toBeGreaterThan(0);
    expect(svc.getState().isPlaying).toBe(false);
  });
});
