import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Lyrics store regression tests — song changes, seeks, timeouts, and the
// stale-guard that keeps a slow/failed fetch from poisoning the NEXT song.
// Lyrics must never block audio playback: every fetch is fire-and-forget and
// every stale resolution is dropped by the request-sequence guard.
// ---------------------------------------------------------------------------

type Deferred = { promise: Promise<any>; resolve: (v: any) => void; reject: (e: any) => void };

function deferred(): Deferred {
  let resolve!: (v: any) => void;
  let reject!: (e: any) => void;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const mocks = vi.hoisted(() => ({
  fetchLyrics: vi.fn(),
}));

vi.mock('../services/lyricsService', () => ({
  lyricsService: { fetchLyrics: mocks.fetchLyrics },
}));

import { useLyricsStore } from './lyricsStore';
import type { LyricLine } from './lyricsStore';

function lines(...times: number[]): LyricLine[] {
  return times.map((time, i) => ({ time, text: `line-${i}` }));
}

function resetStore() {
  useLyricsStore.setState({
    lyrics: [],
    currentLine: -1,
    loading: false,
    error: null,
    songId: null,
  });
}

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

beforeEach(() => {
  mocks.fetchLyrics.mockReset();
  resetStore();
});

describe('basic retrieval', () => {
  it('loads timed lyrics for the current song', async () => {
    mocks.fetchLyrics.mockResolvedValue(lines(1, 5, 10));
    await useLyricsStore.getState().fetchLyrics('s1', 'Title', 'Artist');
    const s = useLyricsStore.getState();
    expect(s.lyrics).toHaveLength(3);
    expect(s.songId).toBe('s1');
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
  });

  it('no lyrics found — empty result with no error', async () => {
    mocks.fetchLyrics.mockResolvedValue([]);
    await useLyricsStore.getState().fetchLyrics('s1', 'Title', 'Artist');
    const s = useLyricsStore.getState();
    expect(s.lyrics).toEqual([]);
    expect(s.error).toBeNull();
    expect(s.loading).toBe(false);
  });

  it('a loaded song is not re-fetched on repeat requests (cache short-circuit)', async () => {
    mocks.fetchLyrics.mockResolvedValue(lines(1));
    await useLyricsStore.getState().fetchLyrics('s1', 'Title', 'Artist');
    await useLyricsStore.getState().fetchLyrics('s1', 'Title', 'Artist');
    expect(mocks.fetchLyrics).toHaveBeenCalledTimes(1);
  });

  it('fetching never blocks — loading flips synchronously while the API hangs', async () => {
    mocks.fetchLyrics.mockReturnValue(deferred().promise); // never resolves
    const pending = useLyricsStore.getState().fetchLyrics('s1', 'T', 'A');
    // The caller (a React effect) gets control back immediately — audio
    // playback is untouched by this path.
    expect(useLyricsStore.getState().loading).toBe(true);
    expect(pending).toBeInstanceOf(Promise);
  });
});

describe('song switching — stale lyrics can never surface', () => {
  it('switching A→B replaces A lyrics with B lyrics', async () => {
    mocks.fetchLyrics.mockImplementation((_t: string, artist: string) =>
      Promise.resolve(artist === 'ArtistA' ? lines(1, 2) : lines(10, 20)),
    );
    await useLyricsStore.getState().fetchLyrics('a', 'A', 'ArtistA');
    await useLyricsStore.getState().fetchLyrics('b', 'B', 'ArtistB');
    const s = useLyricsStore.getState();
    expect(s.songId).toBe('b');
    expect(s.lyrics.map(l => l.text)).toEqual(['line-0', 'line-1']);
    expect(s.lyrics[0].time).toBe(10);
    expect(s.currentLine).toBe(-1); // position belongs to the new song
  });

  it('A→B→A with a SLOW first A fetch — the stale A result is dropped', async () => {
    const firstA = deferred();  // the stale one
    const bFetch = deferred();
    const secondA = deferred(); // the fresh one
    mocks.fetchLyrics
      .mockReturnValueOnce(firstA.promise)
      .mockReturnValueOnce(bFetch.promise)
      .mockReturnValueOnce(secondA.promise);

    void useLyricsStore.getState().fetchLyrics('a', 'A', 'X');
    void useLyricsStore.getState().fetchLyrics('b', 'B', 'Y');
    void useLyricsStore.getState().fetchLyrics('a', 'A', 'X');
    await flush();

    // The stale first-A resolution lands — it must be ignored entirely.
    firstA.resolve(lines(99));
    await flush();
    expect(useLyricsStore.getState().songId).toBe('a');
    expect(useLyricsStore.getState().loading).toBe(true); // still the NEW fetch
    expect(useLyricsStore.getState().lyrics).toEqual([]);

    bFetch.resolve(lines(50)); // equally stale for B — dropped too
    await flush();
    expect(useLyricsStore.getState().lyrics).toEqual([]);

    // Only the latest fetch may write state.
    secondA.resolve(lines(1, 2));
    await flush();
    const s = useLyricsStore.getState();
    expect(s.songId).toBe('a');
    expect(s.lyrics[0].time).toBe(1);
    expect(s.loading).toBe(false);
  });

  it('a FAILED fetch for the old song never poisons the new song', async () => {
    const failing = deferred();
    const bFetch = deferred();
    mocks.fetchLyrics
      .mockReturnValueOnce(failing.promise)
      .mockReturnValueOnce(bFetch.promise);

    void useLyricsStore.getState().fetchLyrics('a', 'A', 'X');
    void useLyricsStore.getState().fetchLyrics('b', 'B', 'Y');
    await flush();

    failing.reject(new Error('network down'));
    await flush();
    // No stale error may appear while B is still loading.
    expect(useLyricsStore.getState().error).toBeNull();
    expect(useLyricsStore.getState().loading).toBe(true);

    bFetch.resolve(lines(5));
    await flush();
    expect(useLyricsStore.getState().error).toBeNull();
    expect(useLyricsStore.getState().lyrics).toHaveLength(1);
  });

  it('clearLyrics invalidates an in-flight fetch', async () => {
    const slow = deferred();
    mocks.fetchLyrics.mockReturnValue(slow.promise);

    void useLyricsStore.getState().fetchLyrics('a', 'A', 'X');
    await flush();
    useLyricsStore.getState().clearLyrics();
    expect(useLyricsStore.getState().songId).toBeNull();

    slow.resolve(lines(1));
    await flush();
    expect(useLyricsStore.getState().lyrics).toEqual([]);
    expect(useLyricsStore.getState().songId).toBeNull();
    expect(useLyricsStore.getState().loading).toBe(false);
  });
});

describe('timeout', () => {
  it('a hung API surfaces a timeout error and stops loading', async () => {
    vi.useFakeTimers();
    try {
      mocks.fetchLyrics.mockReturnValue(deferred().promise); // hangs forever
      const pending = useLyricsStore.getState().fetchLyrics('s1', 'T', 'A');
      await vi.advanceTimersByTimeAsync(12_500);
      await pending;
      const s = useLyricsStore.getState();
      expect(s.loading).toBe(false);
      expect(s.error).toBe('Lyrics request timed out');
      expect(s.lyrics).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('synchronization and seeking', () => {
  beforeEach(async () => {
    mocks.fetchLyrics.mockResolvedValue(lines(10, 20, 30));
    await useLyricsStore.getState().fetchLyrics('s1', 'T', 'A');
  });

  it('follows playback forward through the lines', () => {
    const st = useLyricsStore.getState();
    st.updateCurrentLine(5);
    expect(useLyricsStore.getState().currentLine).toBe(-1);
    st.updateCurrentLine(10);
    expect(useLyricsStore.getState().currentLine).toBe(0);
    st.updateCurrentLine(25);
    expect(useLyricsStore.getState().currentLine).toBe(1);
    st.updateCurrentLine(999);
    expect(useLyricsStore.getState().currentLine).toBe(2);
  });

  it('a seek BACKWARD moves the active line back deterministically', () => {
    const st = useLyricsStore.getState();
    st.updateCurrentLine(35);
    expect(useLyricsStore.getState().currentLine).toBe(2);
    st.updateCurrentLine(12); // seek back into the first verse
    expect(useLyricsStore.getState().currentLine).toBe(0);
    st.updateCurrentLine(0);  // seek to the very start
    expect(useLyricsStore.getState().currentLine).toBe(-1);
  });

  it('identical progress ticks do not churn state', () => {
    const st = useLyricsStore.getState();
    st.updateCurrentLine(25);
    const before = useLyricsStore.getState().currentLine;
    st.updateCurrentLine(25.1);
    expect(useLyricsStore.getState().currentLine).toBe(before);
  });

  it('garbage progress (NaN / negative) is ignored', () => {
    const st = useLyricsStore.getState();
    st.updateCurrentLine(25);
    st.updateCurrentLine(Number.NaN);
    st.updateCurrentLine(-5);
    expect(useLyricsStore.getState().currentLine).toBe(1);
  });

  it('after a song switch the playhead belongs to the new song', async () => {
    useLyricsStore.getState().updateCurrentLine(35);
    expect(useLyricsStore.getState().currentLine).toBe(2);

    mocks.fetchLyrics.mockResolvedValue(lines(100, 200));
    await useLyricsStore.getState().fetchLyrics('s2', 'Other', 'B');
    // New lyrics, position 0 — no line may be "active" from the old song.
    expect(useLyricsStore.getState().currentLine).toBe(-1);
    useLyricsStore.getState().updateCurrentLine(150);
    expect(useLyricsStore.getState().currentLine).toBe(0);
  });
});

describe('background playback safety', () => {
  it('progress ticks while lyrics are absent are a no-op (no crash, no state)', () => {
    const st = useLyricsStore.getState();
    expect(() => {
      st.updateCurrentLine(10);
      st.updateCurrentLine(0);
    }).not.toThrow();
    expect(useLyricsStore.getState().currentLine).toBe(-1);
  });
});
