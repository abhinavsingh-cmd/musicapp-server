import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../services/preloadService', () => ({
  preloadNextSongs: vi.fn(),
}));

// playAtIndex / removeFromQueue reach into the audio store (and the engine)
// through dynamic imports — replace them with controllable doubles so the
// queue-store reactions are what we assert, not real audio.
const audioMocks = vi.hoisted(() => {
  const holder: {
    currentSong: Song | null;
    isPlaying: boolean;
    loadSong: ReturnType<typeof vi.fn>;
    setState: ReturnType<typeof vi.fn>;
  } = { currentSong: null, isPlaying: false, loadSong: vi.fn(), setState: vi.fn() };
  return {
    holder,
    getState: vi.fn(() => holder),
    stop: vi.fn(),
  };
});

vi.mock('./audioStore', () => ({
  useAudioStore: { getState: audioMocks.getState, setState: audioMocks.holder.setState },
}));

vi.mock('../services/audioServiceInstance', () => ({
  audioService: { stop: audioMocks.stop },
}));

import { useQueueStore, isValidSong, type RepeatMode } from './queueStore';
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

function resetStore() {
  useQueueStore.setState({
    queue: [],
    currentIndex: 0,
    isShuffled: false,
    originalQueue: [],
    repeatMode: 'off',
    recentlyPlayed: [],
    crossfadeEnabled: false,
    crossfadeDurationSec: 6,
  });
}

describe('isValidSong', () => {
  it('accepts a song with a real id', () => {
    expect(isValidSong(makeSong('a'))).toBe(true);
  });

  it('rejects null/undefined entries', () => {
    expect(isValidSong(null)).toBe(false);
    expect(isValidSong(undefined)).toBe(false);
  });

  it('rejects missing, blank, and non-string ids', () => {
    expect(isValidSong({ ...makeSong('x'), id: '' })).toBe(false);
    expect(isValidSong({ ...makeSong('x'), id: '   ' })).toBe(false);
    expect(isValidSong({ ...makeSong('x'), id: undefined as unknown as string })).toBe(false);
    expect(isValidSong({ ...makeSong('x'), id: 123 as unknown as string })).toBe(false);
  });
});

describe('queue boundaries never store broken entries', () => {
  beforeEach(resetStore);

  it('setQueue drops id-less entries and keeps the clicked song current', () => {
    const a = makeSong('a');
    const b = makeSong('b');
    const c = makeSong('c');
    const bad = makeSong('bad', { id: '' });

    useQueueStore.getState().setQueue([bad, a, null as unknown as Song, b, c], 3);

    const s = useQueueStore.getState();
    expect(s.queue.map(q => q.id)).toEqual(['a', 'b', 'c']);
    // Clicked song 'b' was at raw index 3 — must remain the current song.
    expect(s.currentIndex).toBe(1);
  });

  it('setQueue ignores a fully-invalid queue instead of storing a broken state', () => {
    const before = useQueueStore.getState().queue;
    useQueueStore.getState().setQueue(
      [makeSong('x', { id: '' }), null as unknown as Song],
      0,
    );
    expect(useQueueStore.getState().queue).toEqual(before);
  });

  it('setQueue falls back to the first valid entry when the clicked index was invalid', () => {
    const a = makeSong('a');
    useQueueStore.getState().setQueue([makeSong('bad', { id: '' }), a], 0);
    const s = useQueueStore.getState();
    expect(s.queue.map(q => q.id)).toEqual(['a']);
    expect(s.currentIndex).toBe(0);
  });

  it('addToQueue / addNext silently ignore invalid songs', () => {
    const a = makeSong('a');
    useQueueStore.getState().setQueue([a], 0);

    useQueueStore.getState().addToQueue(makeSong('bad', { id: '' }));
    useQueueStore.getState().addToQueue(undefined as unknown as Song);
    useQueueStore.getState().addNext(makeSong('bad2', { id: ' ' }));

    expect(useQueueStore.getState().queue.map(q => q.id)).toEqual(['a']);

    useQueueStore.getState().addToQueue(makeSong('b'));
    expect(useQueueStore.getState().queue.map(q => q.id)).toEqual(['a', 'b']);
  });

  it('restoreQueue sanitizes a corrupted persisted queue and clamps the index', () => {
    useQueueStore.getState().restoreQueue({
      queue: [makeSong('bad', { id: '' }), makeSong('a'), makeSong('b')],
      currentIndex: 10,
      repeatMode: 'off',
      isShuffled: false,
      originalQueue: [makeSong('bad2', { id: '' })],
      autoplayEnabled: true,
    });

    const s = useQueueStore.getState();
    expect(s.queue.map(q => q.id)).toEqual(['a', 'b']);
    expect(s.currentIndex).toBe(1);
    expect(s.originalQueue).toEqual([]);
  });

  it('appendRecommendations filters invalid and duplicate entries', async () => {
    const a = makeSong('a');
    useQueueStore.getState().setQueue([a], 0);

    await useQueueStore.getState().appendRecommendations([
      makeSong('a'),                      // duplicate of existing
      makeSong('bad', { id: '' }),        // invalid
      makeSong('rec1'),                   // valid + new
    ]);

    expect(useQueueStore.getState().queue.map(q => q.id)).toEqual(['a', 'rec1']);
  });
});

// ---------------------------------------------------------------------------
// Deterministic transport matrix: Next / Previous must behave identically
// for the same state — no mode asymmetries, no boundary surprises.
// ---------------------------------------------------------------------------
describe('deterministic transport transitions', () => {
  beforeEach(resetStore);

  function seed(
    ids: string[],
    index: number,
    opts: Partial<{ repeatMode: RepeatMode; isShuffled: boolean; autoplayEnabled: boolean }> = {},
  ) {
    useQueueStore.getState().setQueue(ids.map((id) => makeSong(id)), index);
    // setQueue resets modes — apply the scenario afterwards.
    useQueueStore.setState({
      repeatMode: opts.repeatMode ?? 'off',
      isShuffled: opts.isShuffled ?? false,
      autoplayEnabled: opts.autoplayEnabled ?? false,
    });
  }

  it('empty queue — next/previous return null and change nothing', async () => {
    expect(await useQueueStore.getState().nextSong()).toBeNull();
    expect(await useQueueStore.getState().previousSong()).toBeNull();
    const s = useQueueStore.getState();
    expect(s.queue).toEqual([]);
    expect(s.currentIndex).toBe(0);
  });

  it('last track, repeat-off — next stops (null), index unchanged', async () => {
    seed(['a', 'b', 'c'], 2);
    expect(await useQueueStore.getState().nextSong()).toBeNull();
    expect(useQueueStore.getState().currentIndex).toBe(2);
  });

  it('last track, repeat-all — next wraps to the first track', async () => {
    seed(['a', 'b', 'c'], 2, { repeatMode: 'all' });
    expect((await useQueueStore.getState().nextSong())?.id).toBe('a');
    expect(useQueueStore.getState().currentIndex).toBe(0);
  });

  it('first track, repeat-off — previous restarts the current track, never wraps', async () => {
    seed(['a', 'b', 'c'], 0);
    expect((await useQueueStore.getState().previousSong())?.id).toBe('a');
    expect(useQueueStore.getState().currentIndex).toBe(0);
  });

  it('first track, repeat-all — previous wraps to the last track', async () => {
    seed(['a', 'b', 'c'], 0, { repeatMode: 'all' });
    expect((await useQueueStore.getState().previousSong())?.id).toBe('c');
    expect(useQueueStore.getState().currentIndex).toBe(2);
  });

  it('middle tracks — next/previous move exactly one step', async () => {
    seed(['a', 'b', 'c', 'd'], 1);
    expect((await useQueueStore.getState().nextSong())?.id).toBe('c');
    expect(useQueueStore.getState().currentIndex).toBe(2);
    expect((await useQueueStore.getState().previousSong())?.id).toBe('b');
    expect(useQueueStore.getState().currentIndex).toBe(1);
  });

  it('one-track queue — repeat-off next stops; repeat-all replays; previous always restarts', async () => {
    seed(['solo'], 0);
    expect(await useQueueStore.getState().nextSong()).toBeNull();
    expect((await useQueueStore.getState().previousSong())?.id).toBe('solo');

    useQueueStore.setState({ repeatMode: 'all' });
    expect((await useQueueStore.getState().nextSong())?.id).toBe('solo');
    expect((await useQueueStore.getState().previousSong())?.id).toBe('solo');
  });

  it('repeat-one — manual next/previous always MOVE (replay is owned by the ended event)', async () => {
    seed(['a', 'b', 'c'], 0, { repeatMode: 'one' });
    expect((await useQueueStore.getState().nextSong())?.id).toBe('b');
    expect(useQueueStore.getState().currentIndex).toBe(1);
    expect((await useQueueStore.getState().previousSong())?.id).toBe('a');
    expect(useQueueStore.getState().currentIndex).toBe(0);
  });

  it('shuffle — next/previous never return the current track (len > 1)', async () => {
    seed(['a', 'b', 'c', 'd'], 1, { isShuffled: true });
    for (let i = 0; i < 6; i++) {
      const n = await useQueueStore.getState().nextSong();
      expect(n).not.toBeNull();
      expect(n!.id).not.toBe('b');
      // Restore position for the next iteration.
      useQueueStore.setState({ currentIndex: 1 });
      const p = await useQueueStore.getState().previousSong();
      expect(p).not.toBeNull();
      expect(p!.id).not.toBe('b');
      useQueueStore.setState({ currentIndex: 1 });
    }
  });

  it('shuffle, one-track queue — repeat-off next stops; repeat-all replays', async () => {
    seed(['solo'], 0, { isShuffled: true });
    expect(await useQueueStore.getState().nextSong()).toBeNull();
    expect((await useQueueStore.getState().previousSong())?.id).toBe('solo');

    useQueueStore.setState({ repeatMode: 'all' });
    expect((await useQueueStore.getState().nextSong())?.id).toBe('solo');
  });
});

// ---------------------------------------------------------------------------
// peekNextSong — the PURE crossfade lookahead. It must mirror nextSong()'s
// rules without mutating anything: no index change, no autoplay fetch.
// ---------------------------------------------------------------------------
describe('peekNextSong (crossfade lookahead)', () => {
  beforeEach(resetStore);

  function seed(
    ids: string[],
    index: number,
    opts: Partial<{ repeatMode: RepeatMode; isShuffled: boolean }> = {},
  ) {
    useQueueStore.getState().setQueue(ids.map((id) => makeSong(id)), index);
    useQueueStore.setState({
      repeatMode: opts.repeatMode ?? 'off',
      isShuffled: opts.isShuffled ?? false,
      autoplayEnabled: false,
    });
  }

  it('returns the next track mid-queue without mutating the queue', () => {
    seed(['a', 'b', 'c'], 0);
    expect(useQueueStore.getState().peekNextSong()?.id).toBe('b');
    expect(useQueueStore.getState().currentIndex).toBe(0); // PURE — no mutation
    expect(useQueueStore.getState().peekNextSong()?.id).toBe('b'); // stable
  });

  it('repeat-one has NO crossfade candidate — the track replays instead', () => {
    seed(['a', 'b'], 0, { repeatMode: 'one' });
    expect(useQueueStore.getState().peekNextSong()).toBeNull();
  });

  it('empty queue returns null', () => {
    expect(useQueueStore.getState().peekNextSong()).toBeNull();
  });

  it('repeat-off at the last track returns null (autoplay extension is not peekable)', () => {
    seed(['a', 'b'], 1);
    expect(useQueueStore.getState().peekNextSong()).toBeNull();
  });

  it('repeat-all at the last track wraps to the first', () => {
    seed(['a', 'b', 'c'], 2, { repeatMode: 'all' });
    expect(useQueueStore.getState().peekNextSong()?.id).toBe('a');
  });

  it('one-track queue returns null in every mode — never crossfades into itself', () => {
    seed(['solo'], 0);
    expect(useQueueStore.getState().peekNextSong()).toBeNull();
    useQueueStore.setState({ repeatMode: 'all' });
    expect(useQueueStore.getState().peekNextSong()).toBeNull();
    useQueueStore.setState({ isShuffled: true });
    expect(useQueueStore.getState().peekNextSong()).toBeNull();
  });

  it('shuffle peek never returns the current track and never mutates', () => {
    seed(['a', 'b', 'c', 'd'], 1, { isShuffled: true });
    for (let i = 0; i < 10; i++) {
      const peeked = useQueueStore.getState().peekNextSong();
      expect(peeked).not.toBeNull();
      expect(peeked!.id).not.toBe('b');
      expect(useQueueStore.getState().currentIndex).toBe(1); // PURE
    }
  });

  it('shuffle preselect — nextSong(target) locks the commit to the prepared track', async () => {
    seed(['a', 'b', 'c', 'd'], 0, { isShuffled: true });
    const target = useQueueStore.getState().queue[3]; // 'd'
    const committed = await useQueueStore.getState().nextSong(target);
    expect(committed?.id).toBe('d'); // preselect honored — no random race
    expect(useQueueStore.getState().currentIndex).toBe(3);
  });

  it('shuffle preselect is ignored when the target no longer fits the queue', async () => {
    seed(['a', 'b', 'c'], 0, { isShuffled: true });
    const ghost = makeSong('ghost'); // not in the queue
    const committed = await useQueueStore.getState().nextSong(ghost);
    expect(committed).not.toBeNull();
    expect(committed!.id).not.toBe('a'); // falls back to a random valid pick
    expect(committed!.id).not.toBe('ghost');
  });
});

// ---------------------------------------------------------------------------
// Crossfade settings — persisted, clamped, never corrupted
// ---------------------------------------------------------------------------
describe('crossfade settings', () => {
  beforeEach(resetStore);

  it('setCrossfadeEnabled toggles and persists', async () => {
    useQueueStore.getState().setCrossfadeEnabled(true);
    expect(useQueueStore.getState().crossfadeEnabled).toBe(true);
    await new Promise((r) => setTimeout(r, 600)); // persist debounce (500ms)
    const raw = JSON.parse(localStorage.getItem('playback-queue') || '{}');
    expect(raw.crossfadeEnabled).toBe(true);

    useQueueStore.getState().setCrossfadeEnabled(false);
    expect(useQueueStore.getState().crossfadeEnabled).toBe(false);
  });

  it('setCrossfadeDuration clamps to [2, 12] and rejects garbage', () => {
    useQueueStore.getState().setCrossfadeDuration(1);
    expect(useQueueStore.getState().crossfadeDurationSec).toBe(2);
    useQueueStore.getState().setCrossfadeDuration(99);
    expect(useQueueStore.getState().crossfadeDurationSec).toBe(12);
    useQueueStore.getState().setCrossfadeDuration(NaN);
    expect(useQueueStore.getState().crossfadeDurationSec).toBe(6);
    useQueueStore.getState().setCrossfadeDuration(8);
    expect(useQueueStore.getState().crossfadeDurationSec).toBe(8);
  });

  it('crossfade settings round-trip through persistence', () => {
    useQueueStore.getState().setCrossfadeEnabled(true);
    useQueueStore.getState().setCrossfadeDuration(9);
    useQueueStore.getState().flushPersist();

    const raw = JSON.parse(localStorage.getItem('playback-queue') || '{}');
    expect(raw.crossfadeEnabled).toBe(true);
    expect(raw.crossfadeDurationSec).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// Queue-panel interactions: jumping to a row inside the existing queue must
// not silently turn shuffle off, and removing the CURRENT song while paused
// must not leave the removed track as the stale "current" song.
// ---------------------------------------------------------------------------
describe('queue-panel interactions (playAtIndex / removeFromQueue)', () => {
  beforeEach(() => {
    resetStore();
    audioMocks.holder.currentSong = null;
    audioMocks.holder.isPlaying = false;
    audioMocks.holder.loadSong.mockReset();
    audioMocks.holder.setState.mockReset();
    audioMocks.stop.mockReset();
  });

  const flushAsync = () => new Promise((r) => setTimeout(r, 0));

  it('setQueue with preserveShuffle keeps shuffle mode and the original order', () => {
    const a = makeSong('a'); const b = makeSong('b'); const c = makeSong('c');
    useQueueStore.setState({ isShuffled: true, originalQueue: [a, b, c] });

    useQueueStore.getState().setQueue([a, b, c], 2, true);

    const s = useQueueStore.getState();
    expect(s.isShuffled).toBe(true);
    expect(s.originalQueue.map((q) => q.id)).toEqual(['a', 'b', 'c']);
    expect(s.currentIndex).toBe(2);
  });

  it('setQueue without preserveShuffle starts unshuffled (fresh list click)', () => {
    const a = makeSong('a'); const b = makeSong('b'); const c = makeSong('c');
    useQueueStore.setState({ isShuffled: true, originalQueue: [a, b, c] });

    useQueueStore.getState().setQueue([a, b, c], 0);

    const s = useQueueStore.getState();
    expect(s.isShuffled).toBe(false);
    expect(s.originalQueue).toEqual([]);
  });

  it('playAtIndex jumps within the existing queue WITHOUT turning shuffle off', async () => {
    const a = makeSong('a'); const b = makeSong('b'); const c = makeSong('c');
    useQueueStore.getState().setQueue([a, b, c], 1);
    useQueueStore.setState({ isShuffled: true, originalQueue: [a, b, c] });

    await useQueueStore.getState().playAtIndex(2);

    expect(audioMocks.holder.loadSong).toHaveBeenCalledTimes(1);
    expect(audioMocks.holder.loadSong.mock.calls[0][0]).toMatchObject({ id: 'c' });
    // 4th argument = preserveShuffle — the jump must keep the mode.
    expect(audioMocks.holder.loadSong.mock.calls[0][3]).toBe(true);
  });

  it('removing the current song while PLAYING loads the new current track', async () => {
    const a = makeSong('a'); const b = makeSong('b'); const c = makeSong('c');
    useQueueStore.getState().setQueue([a, b, c], 1);
    audioMocks.holder.currentSong = b;
    audioMocks.holder.isPlaying = true;

    useQueueStore.getState().removeFromQueue(1);
    await flushAsync();

    const s = useQueueStore.getState();
    expect(s.queue.map((q) => q.id)).toEqual(['a', 'c']);
    expect(s.currentIndex).toBe(1);
    expect(audioMocks.holder.loadSong).toHaveBeenCalledTimes(1);
    expect(audioMocks.holder.loadSong.mock.calls[0][0]).toMatchObject({ id: 'c' });
    expect(audioMocks.stop).not.toHaveBeenCalled();
  });

  it('removing the current song while PAUSED stops the engine and re-points currentSong (no autoplay)', async () => {
    const a = makeSong('a'); const b = makeSong('b'); const c = makeSong('c');
    useQueueStore.getState().setQueue([a, b, c], 1);
    audioMocks.holder.currentSong = b;
    audioMocks.holder.isPlaying = false;

    useQueueStore.getState().removeFromQueue(1);
    await flushAsync();

    const s = useQueueStore.getState();
    expect(s.queue.map((q) => q.id)).toEqual(['a', 'c']);
    expect(s.currentIndex).toBe(1);
    // The removed track's engine session is stopped so play() can never
    // resume a song that is no longer in the queue.
    expect(audioMocks.stop).toHaveBeenCalledTimes(1);
    expect(audioMocks.holder.loadSong).not.toHaveBeenCalled();
    expect(audioMocks.holder.setState).toHaveBeenCalledWith(expect.objectContaining({
      currentSong: expect.objectContaining({ id: 'c' }),
      isPlaying: false,
      isLoading: false,
    }));
  });

  it('removing a NON-current song leaves playback state untouched', async () => {
    const a = makeSong('a'); const b = makeSong('b'); const c = makeSong('c');
    useQueueStore.getState().setQueue([a, b, c], 1);
    audioMocks.holder.currentSong = b;
    audioMocks.holder.isPlaying = true;
    audioMocks.holder.loadSong.mockClear();
    audioMocks.stop.mockClear();

    useQueueStore.getState().removeFromQueue(2); // 'c', not current
    await flushAsync();

    expect(audioMocks.holder.loadSong).not.toHaveBeenCalled();
    expect(audioMocks.stop).not.toHaveBeenCalled();
    expect(useQueueStore.getState().queue.map((q) => q.id)).toEqual(['a', 'b']);
  });
});
