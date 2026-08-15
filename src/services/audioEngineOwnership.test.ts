import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { youtubePlayerService } from './youtubePlayerService';
import { backgroundPlaybackService } from './backgroundPlaybackService';
import type { Song } from '../types/music';

// ---------------------------------------------------------------------------
// Engine-ownership regression tests for the auxiliary playback layers:
//   A1 — a stale YouTube internal-retry timer can never restart a video for a
//        session that has already moved on (stop() cancels it; identity check
//        at fire time is defense-in-depth).
//   A2 — visibilitychange/freeze/resume/beforeunload funnel through ONE deduped
//        state machine: subscribers receive each background transition once.
// ---------------------------------------------------------------------------

function makeSong(id: string, youtubeId: string): Song {
  return {
    id,
    title: `Song ${id}`,
    artist: 'Artist',
    album: 'Album',
    duration: 200,
    genre: 'Pop',
    coverArt: '',
    audioUrl: '',
    youtubeId,
    provider: 'youtube',
    releaseYear: 2020,
    isFavorite: false,
    playCount: 0,
  } as Song;
}

describe('YouTubePlayerService — stale retry timer (A1)', () => {
  let loadVideoById: ReturnType<typeof vi.fn>;
  let svc: any;

  beforeEach(() => {
    vi.useFakeTimers();
    svc = youtubePlayerService as any;
    loadVideoById = vi.fn();
    // Inject a ready fake player — bypasses IFrame API loading entirely.
    svc.player = { loadVideoById, stopVideo: vi.fn() };
    svc.currentSongId = 'songA';
    svc.currentLoadSong = makeSong('songA', 'ytA');
    svc.retryCount = 0;
  });

  afterEach(() => {
    svc.stop(); // clears timers + state
    svc.player = null;
    vi.useRealTimers();
  });

  it('retries the SAME video when the session has not changed', () => {
    svc.handleError({ data: 5 }); // transient — schedules internal retry
    expect(loadVideoById).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5_000);
    expect(loadVideoById).toHaveBeenCalledTimes(1);
    expect(loadVideoById).toHaveBeenCalledWith('ytA');
  });

  it('stop() cancels a pending retry — no late loadVideoById after stop', () => {
    svc.handleError({ data: 5 });
    svc.stop();

    vi.advanceTimersByTime(30_000);
    expect(loadVideoById).not.toHaveBeenCalled();
  });

  it('a superseded session can never be restarted by a stale timer', () => {
    svc.handleError({ data: 5 }); // retry armed for songA/ytA

    // The engine moves on to a NEWER track (identity changes while the
    // timer is still pending).
    svc.currentSongId = 'songB';
    svc.currentLoadSong = makeSong('songB', 'ytB');

    vi.advanceTimersByTime(30_000);

    // The stale timer must NOT restart anything — especially not the NEW
    // track from position 0.
    expect(loadVideoById).not.toHaveBeenCalled();
  });

  it('a new load() supersedes a pending retry of the previous video', async () => {
    svc.handleError({ data: 5 }); // retry armed for songA

    // Simulate a fresh load taking over: initialize() is already satisfied
    // by the injected player stub.
    svc.initialize = vi.fn(() => Promise.resolve());
    await svc.load(makeSong('songB', 'ytB'));

    vi.advanceTimersByTime(30_000);

    // Only the fresh load's loadVideoById ran — the stale retry is dead.
    expect(loadVideoById).toHaveBeenCalledTimes(1);
    expect(loadVideoById).toHaveBeenCalledWith('ytB');
  });
});

describe('BackgroundPlaybackService — deduped transitions (A2)', () => {
  beforeEach(() => {
    backgroundPlaybackService.init();
  });

  afterEach(() => {
    backgroundPlaybackService.destroy();
  });

  it('visibilitychange + freeze deliver background=true exactly once', () => {
    const calls: boolean[] = [];
    const off = backgroundPlaybackService.onBackgroundChange((bg) => calls.push(bg));

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('freeze')); // second source, same state

    expect(calls).toEqual([true]);
    off();
  });

  it('resume + visibilitychange deliver foreground exactly once', () => {
    const calls: boolean[] = [];
    const off = backgroundPlaybackService.onBackgroundChange((bg) => calls.push(bg));

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    calls.length = 0;

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('resume'));
    document.dispatchEvent(new Event('visibilitychange')); // duplicate source

    expect(calls).toEqual([false]);
    off();
  });

  it('a same-state repeat from any source is swallowed', () => {
    const calls: boolean[] = [];
    const off = backgroundPlaybackService.onBackgroundChange((bg) => calls.push(bg));

    document.dispatchEvent(new Event('resume')); // already foreground — no-op
    document.dispatchEvent(new Event('freeze'));
    document.dispatchEvent(new Event('freeze')); // duplicate — no-op

    expect(calls).toEqual([true]);
    expect(backgroundPlaybackService.getIsBackground()).toBe(true);
    off();
  });
});
