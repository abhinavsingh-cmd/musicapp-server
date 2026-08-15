import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Crossfade regression tests for the REAL AudioService — single-engine
// hand-off, volume ramp timing, promotion, cancellation, rollback.
// jsdom has no working media engine, so HTMLAudioElement is replaced by a
// deterministic fake and timers are fake (the ramp is time-driven).
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  engineParams: vi.fn(),
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
  static playBehavior: 'resolve' | 'hang' | 'reject' = 'resolve';
  src = '';
  volume = 1;
  paused = true;
  muted = false;
  playbackRate = 1;
  preload = '';
  readyState = 0;
  duration: number = NaN;
  currentTime = 0;
  constructor() {
    super();
    FakeAudio.instances.push(this);
  }
  play(): Promise<void> {
    this.paused = false;
    if (FakeAudio.playBehavior === 'hang') return new Promise<void>(() => {});
    if (FakeAudio.playBehavior === 'reject') return Promise.reject(new Error('NotAllowedError'));
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
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function makeReady(el: FakeAudio, duration = 200): void {
  el.readyState = 3;
  el.duration = duration;
  el.dispatchEvent(new Event('canplay'));
}

/** Play track A on the html engine and bring it to the PLAYING state. */
async function setupPlaying(svc: AudioService, song: Song): Promise<FakeAudio> {
  mocks.resolve.mockResolvedValue({ kind: 'html' });
  mocks.engineParams.mockReturnValue({ mode: 'html', src: 'blob:local', isLocalFile: true });
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

/** Prepare a crossfade to `next` and resolve its canplay deterministically. */
async function prepareTo(svc: AudioService, next: Song): Promise<boolean> {
  mocks.resolve.mockResolvedValue({ kind: 'html' });
  mocks.engineParams.mockReturnValue({ mode: 'html', src: 'blob:next', isLocalFile: true });
  const prep = svc.prepareCrossfadeIn(next);
  await flush();
  makeReady(FakeAudio.instances[FakeAudio.instances.length - 1]);
  return prep;
}

const realAudio = globalThis.Audio;

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as any).Audio = FakeAudio;
  FakeAudio.instances = [];
  FakeAudio.playBehavior = 'resolve';
  mocks.resolve.mockReset();
  mocks.engineParams.mockReset();
  delete (window as any).Capacitor;
});

afterEach(() => {
  vi.useRealTimers();
  (globalThis as any).Audio = realAudio;
});

describe('AudioService — crossfade lifecycle', () => {
  it('prepare → start → ramp → promote: one engine, one session, element swap', async () => {
    const svc = new AudioService();
    const events: Array<[string, any]> = [];
    svc.subscribe((e, d) => events.push([e, d]));

    const outgoing = await setupPlaying(svc, makeSong('a'));
    const sessionBefore = svc.getCurrentPlaybackId();

    expect(await prepareTo(svc, makeSong('b'))).toBe(true);
    expect(svc.getCrossfadePhase()).toBe('prepared');
    const incoming = FakeAudio.instances[FakeAudio.instances.length - 1];
    expect(incoming).not.toBe(outgoing);
    expect(incoming.volume).toBe(0); // silent until the ramps begin

    expect(svc.startCrossfadeIn(2)).toBe(true);
    expect(svc.getCrossfadePhase()).toBe('fading');
    // THE hand-off: session bumped, outgoing listeners detached, incoming is
    // now the authoritative song — all BEFORE the ramp completes.
    expect(svc.getCurrentPlaybackId()).not.toBe(sessionBefore);
    expect(svc.getCurrentSong()?.id).toBe('b');
    await flush(); // let incoming.play() settle

    // Mid-ramp: volumes blend in opposite directions under the master volume.
    vi.advanceTimersByTime(1_000); // halfway through a 2s fade
    expect(incoming.volume).toBeGreaterThan(0);
    expect(outgoing.volume).toBeLessThan(svc.getVolume());
    expect(incoming.volume).toBeLessThanOrEqual(svc.getVolume());

    // Ramp completes — the incoming element becomes THE html element.
    vi.advanceTimersByTime(1_200);
    await flush();
    expect(svc.getCrossfadePhase()).toBe('idle');
    expect((svc as unknown as { htmlAudio: FakeAudio }).htmlAudio).toBe(incoming);
    expect(incoming.volume).toBe(svc.getVolume()); // full master volume
    expect(outgoing.src).toBe('');                  // silenced + released
    expect(outgoing.paused).toBe(true);

    // A late 'ended' from the outgoing element can never reach subscribers —
    // its listeners were detached at fade start (no double advance possible).
    outgoing.dispatchEvent(new Event('ended'));
    expect(events.some(([e]) => e === 'ended')).toBe(false);

    // Exactly one 'play' emission for the incoming track, tagged with the
    // NEW session id.
    const plays = events.filter(([e]) => e === 'play');
    expect(plays.filter(([, d]) => d?.song?.id === 'b')).toHaveLength(1);
  });

  it('the promoted track owns normal lifecycle again — its ended emits exactly once', async () => {
    const svc = new AudioService();
    const events: Array<[string, any]> = [];
    svc.subscribe((e, d) => events.push([e, d]));

    await setupPlaying(svc, makeSong('a'));
    await prepareTo(svc, makeSong('b'));
    svc.startCrossfadeIn(2);
    await flush();
    vi.advanceTimersByTime(2_300); // complete the fade
    await flush();

    const incoming = (svc as unknown as { htmlAudio: FakeAudio }).htmlAudio;
    incoming.dispatchEvent(new Event('ended'));
    incoming.dispatchEvent(new Event('ended')); // duplicate — session guard

    expect(events.filter(([e]) => e === 'ended')).toHaveLength(1);
  });

  it('pause during a fade completes the fade instantly, then pauses the promoted track', async () => {
    const svc = new AudioService();
    await setupPlaying(svc, makeSong('a'));
    await prepareTo(svc, makeSong('b'));
    svc.startCrossfadeIn(2);
    await flush();
    const incoming = FakeAudio.instances[FakeAudio.instances.length - 1];

    svc.pause();

    expect(svc.getCrossfadePhase()).toBe('idle'); // never left half-fading
    expect((svc as unknown as { htmlAudio: FakeAudio }).htmlAudio).toBe(incoming);
    expect(incoming.paused).toBe(true);
    expect(svc.getState().isPlaying).toBe(false);
  });

  it('seek during a fade completes the fade instantly, then seeks the promoted track', async () => {
    const svc = new AudioService();
    await setupPlaying(svc, makeSong('a'));
    await prepareTo(svc, makeSong('b'));
    svc.startCrossfadeIn(2);
    await flush();
    const incoming = FakeAudio.instances[FakeAudio.instances.length - 1];

    svc.seek(30);

    expect(svc.getCrossfadePhase()).toBe('idle');
    expect(incoming.currentTime).toBe(30);
  });

  it('a new play while PREPARED discards the prepared stream — no orphaned element', async () => {
    const svc = new AudioService();
    await setupPlaying(svc, makeSong('a'));
    await prepareTo(svc, makeSong('b'));
    const prepared = FakeAudio.instances[FakeAudio.instances.length - 1];

    const p = svc.play(makeSong('c'), [], 0);
    await flush();
    // The prepared element was torn down before the new session started.
    expect(prepared.src).toBe('');
    expect(svc.getCrossfadePhase()).toBe('idle');

    makeReady(FakeAudio.instances[FakeAudio.instances.length - 1]);
    await flush();
    await p;
    expect(svc.getCurrentSong()?.id).toBe('c');
  });

  it('a new play while FADING promotes first, then plays — never two audible tracks left behind', async () => {
    const svc = new AudioService();
    await setupPlaying(svc, makeSong('a'));
    await prepareTo(svc, makeSong('b'));
    svc.startCrossfadeIn(2);
    await flush();

    const p = svc.play(makeSong('c'), [], 0);
    await flush();

    // The fade was finished (promoted) before the new play took over.
    expect(svc.getCrossfadePhase()).toBe('idle');
    const el = FakeAudio.instances[FakeAudio.instances.length - 1];
    makeReady(el);
    await flush();
    el.dispatchEvent(new Event('playing'));
    await p;
    expect(svc.getCurrentSong()?.id).toBe('c');
    expect(svc.getState().isPlaying).toBe(true);
    // No other element is left playing.
    expect(FakeAudio.instances.filter((i) => !i.paused && i !== el)).toHaveLength(0);
  });

  it('cancelCrossfade while PREPARED leaves the outgoing track fully intact', async () => {
    const svc = new AudioService();
    const events: Array<[string, any]> = [];
    svc.subscribe((e, d) => events.push([e, d]));
    const outgoing = await setupPlaying(svc, makeSong('a'));
    await prepareTo(svc, makeSong('b'));
    const session = svc.getCurrentPlaybackId();

    svc.cancelCrossfade();

    expect(svc.getCrossfadePhase()).toBe('idle');
    expect(svc.getCurrentPlaybackId()).toBe(session); // session untouched
    expect(svc.getCurrentSong()?.id).toBe('a');
    // Outgoing listeners still wired — its natural ended still advances.
    outgoing.dispatchEvent(new Event('ended'));
    expect(events.filter(([e]) => e === 'ended')).toHaveLength(1);
  });

  it('failed prepare (no stream) — returns false, stays idle, creates no element', async () => {
    const svc = new AudioService();
    await setupPlaying(svc, makeSong('a'));
    expect(FakeAudio.instances).toHaveLength(1);

    mocks.resolve.mockResolvedValueOnce(null); // the next track has no stream
    expect(await svc.prepareCrossfadeIn(makeSong('b'))).toBe(false);
    expect(svc.getCrossfadePhase()).toBe('idle');
    expect(FakeAudio.instances).toHaveLength(1); // nothing orphaned
    expect(svc.startCrossfadeIn(2)).toBe(false); // nothing to start
  });

  it('crossfade API is inert when no html engine is active', async () => {
    const svc = new AudioService();
    expect(await svc.prepareCrossfadeIn(makeSong('a'))).toBe(false);
    expect(svc.startCrossfadeIn(2)).toBe(false);
    svc.finishCrossfadeNow(); // must never throw
    svc.cancelCrossfade();
    expect(svc.getCrossfadePhase()).toBe('idle');
  });

  it('autoplay rejection rolls back — outgoing track stays live and can still end normally', async () => {
    const svc = new AudioService();
    const events: Array<[string, any]> = [];
    svc.subscribe((e, d) => events.push([e, d]));
    const outgoing = await setupPlaying(svc, makeSong('a'));
    await prepareTo(svc, makeSong('b'));

    FakeAudio.playBehavior = 'reject';
    svc.startCrossfadeIn(2);
    await flush(); // rejection settles → rollback

    expect(svc.getCrossfadePhase()).toBe('idle');
    expect(svc.getCurrentSong()?.id).toBe('a'); // rolled back
    expect(events.some(([e, d]) => e === 'play' && d?.song?.id === 'b')).toBe(false);

    // The outgoing track's lifecycle is fully restored.
    outgoing.dispatchEvent(new Event('ended'));
    expect(events.filter(([e]) => e === 'ended')).toHaveLength(1);
    FakeAudio.playBehavior = 'resolve';
  });

  it('finishCrossfadeNow promotes instantly (background/WebView-suspend path)', async () => {
    const svc = new AudioService();
    await setupPlaying(svc, makeSong('a'));
    await prepareTo(svc, makeSong('b'));
    svc.startCrossfadeIn(2);
    await flush();
    const incoming = FakeAudio.instances[FakeAudio.instances.length - 1];

    svc.finishCrossfadeNow();

    expect(svc.getCrossfadePhase()).toBe('idle');
    expect((svc as unknown as { htmlAudio: FakeAudio }).htmlAudio).toBe(incoming);
    expect(svc.getCurrentSong()?.id).toBe('b');
  });
});
