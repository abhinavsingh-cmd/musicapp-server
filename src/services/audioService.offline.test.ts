import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Offline-playback recovery tests for the REAL AudioService — the html
// engine's bounded stream-failure recovery (the offline/online bridge):
//   - remote stream fails mid-playback  -> local copy wins, zero network
//   - remote fails, no local copy       -> one forced re-resolve
//   - corrupted local blob              -> remote fallback, never the same copy
//   - corrupted local + no network      -> isolated track failure, no loops
//   - exactly ONE recovery per session
// jsdom has no working media engine, so HTMLAudioElement is replaced by a
// deterministic fake.
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

function failElement(el: FakeAudio, message = 'network dropped'): void {
  el.error = { code: 4, message };
  el.dispatchEvent(new Event('error'));
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

describe('AudioService — offline recovery (mid-stream remote failure)', () => {
  it('remote dies mid-playback with a local copy: switches to the blob with ZERO re-resolve and no error/ended', async () => {
    const svc = new AudioService();
    const events: Array<[string, any]> = [];
    svc.subscribe((e, d) => events.push([e, d]));
    const song = makeSong('a');
    const el = await setupPlaying(svc, song, 'https://cdn.example/stream1', false);

    // Recovery-time behavior only:
    mocks.resolve.mockClear();
    mocks.localCopy.mockReturnValue({ kind: 'local' });
    mocks.engineParams.mockReturnValue({ mode: 'html', src: 'blob:recovered', isLocalFile: true });

    // Progress at 42s so recovery must resume from position.
    el.currentTime = 42;
    el.dispatchEvent(new Event('timeupdate'));

    failElement(el);
    await flush();

    expect(mocks.localCopy).toHaveBeenCalledTimes(1);
    expect(mocks.resolve).not.toHaveBeenCalled(); // no network re-resolve
    expect(el.src).toBe('blob:recovered');
    expect(el.currentTime).toBe(42); // resumed from saved position
    expect(svc.getState().isPlaying).toBe(true);
    expect(events.filter(([e]) => e === 'error')).toHaveLength(0);
    expect(events.filter(([e]) => e === 'ended')).toHaveLength(0);
  });

  it('remote dies mid-playback with NO local copy: one forced re-resolve plays the fresh stream', async () => {
    const svc = new AudioService();
    const events: Array<[string, any]> = [];
    svc.subscribe((e, d) => events.push([e, d]));
    const song = makeSong('b');
    const el = await setupPlaying(svc, song, 'https://cdn.example/stream1', false);

    mocks.resolve.mockClear();
    mocks.resolve.mockResolvedValue({ kind: 'html' });
    mocks.localCopy.mockReturnValue(null);
    mocks.engineParams.mockReturnValue({ mode: 'html', src: 'https://cdn.example/stream2', isLocalFile: false });

    failElement(el);
    await flush();

    expect(mocks.localCopy).toHaveBeenCalledTimes(1);
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(mocks.resolve.mock.calls[0][1]).toEqual({ force: true, localFallback: true });
    expect(el.src).toBe('https://cdn.example/stream2');
    expect(svc.getState().isPlaying).toBe(true);
    expect(events.filter(([e]) => e === 'ended')).toHaveLength(0);
  });

  it('exactly ONE recovery per session: a second failure after a successful recovery fails the track', async () => {
    const svc = new AudioService();
    const events: Array<[string, any]> = [];
    svc.subscribe((e, d) => events.push([e, d]));
    const song = makeSong('c');
    const el = await setupPlaying(svc, song, 'https://cdn.example/stream1', false);

    mocks.resolve.mockClear();
    mocks.localCopy.mockReturnValue({ kind: 'local' });
    mocks.engineParams.mockReturnValue({ mode: 'html', src: 'blob:recovered', isLocalFile: true });

    failElement(el); // first failure -> recovered via local copy
    await flush();
    expect(el.src).toBe('blob:recovered');
    expect(events.filter(([e]) => e === 'ended')).toHaveLength(0);

    failElement(el, 'blob corrupted too'); // second failure -> budget spent
    await flush();

    expect(mocks.localCopy).toHaveBeenCalledTimes(1); // never consulted again
    expect(mocks.resolve).not.toHaveBeenCalled();   // no second re-resolve
    expect(events.filter(([e]) => e === 'ended')).toHaveLength(1); // isolated track failure
    expect(svc.getState().isPlaying).toBe(false);
  });
});

describe('AudioService — corrupted local file recovery', () => {
  it('local blob fails mid-playback: strips the dead URL, falls back to remote with localFallback:false', async () => {
    const svc = new AudioService();
    const events: Array<[string, any]> = [];
    svc.subscribe((e, d) => events.push([e, d]));
    const song = makeSong('d');
    const el = await setupPlaying(svc, song, 'blob:corrupted', true);

    mocks.resolve.mockClear();
    mocks.localCopy.mockClear();
    mocks.resolve.mockResolvedValue({ kind: 'html' });
    mocks.engineParams.mockReturnValue({ mode: 'html', src: 'https://cdn.example/fresh', isLocalFile: false });

    failElement(el, 'decode error');
    await flush();

    // The failed copy must never be offered back to the engine.
    expect(mocks.localCopy).not.toHaveBeenCalled();
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(mocks.resolve.mock.calls[0][0]).toHaveProperty('streamUrl', undefined);
    expect(mocks.resolve.mock.calls[0][1]).toEqual({ force: true, localFallback: false });
    expect(el.src).toBe('https://cdn.example/fresh');
    expect(svc.getState().isPlaying).toBe(true);
    expect(events.filter(([e]) => e === 'ended')).toHaveLength(0);
  });

  it('corrupted local blob + provider fails: isolated track failure, exactly one ended', async () => {
    const svc = new AudioService();
    const events: Array<[string, any]> = [];
    svc.subscribe((e, d) => events.push([e, d]));
    const song = makeSong('e');
    const el = await setupPlaying(svc, song, 'blob:corrupted', true);

    mocks.resolve.mockClear();
    mocks.localCopy.mockClear();
    mocks.resolve.mockResolvedValue(null); // provider cannot help

    failElement(el, 'decode error');
    await flush();

    expect(mocks.localCopy).not.toHaveBeenCalled();
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(events.filter(([e]) => e === 'error')).toHaveLength(1);
    expect(events.filter(([e]) => e === 'ended')).toHaveLength(1);
    expect(svc.getState().isPlaying).toBe(false);

    // A repeated error event must NOT re-enter recovery or re-advance.
    failElement(el, 'decode error again');
    await flush();
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(events.filter(([e]) => e === 'ended')).toHaveLength(1);
  });

  it('corrupted local blob fails AT STARTUP: recovery owns the session, remote takes over, no double failure', async () => {
    const svc = new AudioService();
    const events: Array<[string, any]> = [];
    svc.subscribe((e, d) => events.push([e, d]));
    const song = makeSong('f');

    mocks.resolve.mockResolvedValue({ kind: 'html' });
    mocks.engineParams
      .mockReturnValueOnce({ mode: 'html', src: 'blob:corrupted', isLocalFile: true }) // initial play
      .mockReturnValue({ mode: 'html', src: 'https://cdn.example/fresh', isLocalFile: false }); // recovery

    const p = svc.play(song, [], 0);
    await flush();
    const el = FakeAudio.instances[FakeAudio.instances.length - 1];
    expect(el.src).toBe('blob:corrupted');

    // Startup error BEFORE canplay — the downloaded file is unreadable.
    failElement(el, 'decode error');
    await flush();

    // The recovery path now owns the session and is buffering the remote.
    expect(mocks.localCopy).not.toHaveBeenCalled();
    expect(mocks.resolve).toHaveBeenCalledTimes(2); // initial play + forced recovery
    expect(mocks.resolve.mock.calls[1][1]).toEqual({ force: true, localFallback: false });

    makeReady(el);
    await flush();
    await p;

    expect(el.src).toBe('https://cdn.example/fresh');
    expect(events.filter(([e]) => e === 'error')).toHaveLength(0);
    expect(events.filter(([e]) => e === 'ended')).toHaveLength(0); // no double failure
  });

  it('corrupted local blob fails AT STARTUP with no provider help: exactly one failure, no attempt-loop race', async () => {
    const svc = new AudioService();
    const events: Array<[string, any]> = [];
    svc.subscribe((e, d) => events.push([e, d]));
    const song = makeSong('g');

    mocks.resolve.mockResolvedValueOnce({ kind: 'html' }) // initial play resolves the (dead) blob
      .mockResolvedValue(null);                            // recovery re-resolve fails
    mocks.engineParams.mockReturnValue({ mode: 'html', src: 'blob:corrupted', isLocalFile: true });

    const p = svc.play(song, [], 0);
    await flush();
    const el = FakeAudio.instances[FakeAudio.instances.length - 1];

    failElement(el, 'decode error');
    await flush();
    await p; // the attempt loop must yield to recovery, not run its own retries

    expect(mocks.localCopy).not.toHaveBeenCalled();
    expect(mocks.resolve).toHaveBeenCalledTimes(2); // never retried beyond recovery
    expect(events.filter(([e]) => e === 'error')).toHaveLength(1);
    expect(events.filter(([e]) => e === 'ended')).toHaveLength(1);
    expect(svc.getState().isPlaying).toBe(false);
  });
});
