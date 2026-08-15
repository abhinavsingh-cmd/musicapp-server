/**
 * Search store pipeline tests.
 *
 * Covers the store-level half of the search feature: request cancellation,
 * stale-response protection (rapid a/ar/ari/arij/arijit typing), error
 * surfacing vs. cancellation classification, duplicate/broken-row dedupe,
 * empty-result handling, and paging races against new searches.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { OfflineError, TimeoutError } from '../config/api';
import type { Song } from '../types/music';
import type { Track } from '../providers/types';

vi.mock('../providers/search', () => ({
  searchProviders: vi.fn(),
}));

vi.mock('../services/librarySearchIndex', () => ({
  initLibrarySearchIndex: vi.fn(),
  librarySearchIndex: {
    search: vi.fn(),
    suggest: vi.fn(),
  },
}));

vi.mock('../services/metricsCollector', () => ({
  metricsCollector: { pushSearchLatency: vi.fn() },
}));

import { useSearchStore } from './searchStore';
import { searchProviders } from '../providers/search';
import { librarySearchIndex } from '../services/librarySearchIndex';

// ---- Helpers ----

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** One real-timer macrotask; a few of these drain chained microtasks. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));
async function flush(n = 5): Promise<void> {
  for (let i = 0; i < n; i++) await tick();
}

function makeTrack(id: string, title?: string): Track {
  return {
    id,
    externalId: id,
    title: title ?? `Track ${id}`,
    artist: 'Artist',
    album: '',
    duration: 200,
    artwork: `https://img.youtube.com/vi/${id}/mqdefault.jpg`,
    playCount: 0,
  } as unknown as Track;
}

type YtResultRow = { providerId: 'youtube'; providerName: string; tracks: Track[] };
function ytResult(tracks: Track[]): YtResultRow[] {
  return [{ providerId: 'youtube', providerName: 'YouTube', tracks }];
}

/** Per-query deferred responses — tests control exactly when each arrives. */
const pending = new Map<string, Deferred<YtResultRow[]>>();

beforeEach(() => {
  vi.clearAllMocks();
  pending.clear();
  useSearchStore.getState().clear();
  (librarySearchIndex.search as Mock).mockResolvedValue([]);
  (librarySearchIndex.suggest as Mock).mockResolvedValue([]);
  (searchProviders as Mock).mockImplementation((query: string) => {
    const d = deferred<YtResultRow[]>();
    pending.set(query, d);
    return d.promise;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ---- Rapid-typing race (the required a/ar/ari/arij/arijit scenario) ----

describe('rapid sequential searches', () => {
  const queries = ['a', 'ar', 'ari', 'arij', 'arijit'];

  /** Fire each prefix search and let it reach the in-flight YT request,
   *  so all five are simultaneously pending like a fast typist produces. */
  async function fireAllSequentially(): Promise<Promise<void>[]> {
    const searches: Promise<void>[] = [];
    for (const q of queries) {
      searches.push(useSearchStore.getState().search(q));
      await flush(); // previous search's YT request is now in flight
    }
    return searches;
  }

  it('newest response wins even when old responses arrive LAST', async () => {
    const searches = await fireAllSequentially();

    // Every prefix fired exactly one provider search...
    expect((searchProviders as Mock).mock.calls.map((c) => c[0])).toEqual(queries);

    // Worst case: responses arrive in reverse order — the OLDEST last.
    for (const q of [...queries].reverse()) {
      pending.get(q)!.resolve(ytResult([makeTrack(`${q}-1`), makeTrack(`${q}-2`)]));
      await flush();
    }
    await Promise.allSettled(searches);

    const s = useSearchStore.getState();
    expect(s.debouncedQuery).toBe('arijit');
    expect(s.ytResults.map((r) => r.id)).toEqual(['arijit-1', 'arijit-2']);
    expect(s.status).toBe('success');
    expect(s.ytStatus).toBe('success');
  });

  it('a lone stale late response is discarded, never applied', async () => {
    await fireAllSequentially();

    // Only the FIRST (superseded) search ever responds.
    pending.get('a')!.resolve(ytResult([makeTrack('stale-row')]));
    await flush();

    const s = useSearchStore.getState();
    expect(s.debouncedQuery).toBe('arijit');
    expect(s.ytResults).toEqual([]);
    expect(s.ytStatus).toBe('loading'); // newest search still in flight
  });

  it('abort errors from superseded requests never surface as errors', async () => {
    const searches = await fireAllSequentially();

    // Superseded requests abort; only the newest resolves.
    for (const q of queries.slice(0, -1)) {
      pending.get(q)!.reject(new DOMException('Aborted', 'AbortError'));
    }
    pending.get('arijit')!.resolve(ytResult([makeTrack('arijit-1')]));
    await flush();
    await Promise.allSettled(searches);

    const s = useSearchStore.getState();
    expect(s.error).toBeNull();
    expect(s.ytStatus).toBe('success');
    expect(s.ytResults.map((r) => r.id)).toEqual(['arijit-1']);
  });

  it('a superseding search aborts the previous request controller', async () => {
    void useSearchStore.getState().search('first');
    await flush();
    const firstCall = (searchProviders as Mock).mock.calls[0];
    const firstSignal: AbortSignal = firstCall[1].signal;
    expect(firstSignal.aborted).toBe(false);

    void useSearchStore.getState().search('second');
    await flush();
    expect(firstSignal.aborted).toBe(true);
  });
});

// ---- Cancellation ----

describe('cancellation', () => {
  it('cancelSearch marks the search cancelled, not errored', async () => {
    void useSearchStore.getState().search('hello');
    await flush();

    useSearchStore.getState().cancelSearch();
    pending.get('hello')!.reject(new DOMException('Aborted', 'AbortError'));
    await flush();

    const s = useSearchStore.getState();
    expect(s.ytStatus).toBe('cancelled');
    expect(s.isCancelled).toBe(true);
    expect(s.error).toBeNull();
  });

  it('empty query resets to idle without any network call', async () => {
    await useSearchStore.getState().search('   ');
    const s = useSearchStore.getState();
    expect(s.status).toBe('idle');
    expect(s.ytStatus).toBe('idle');
    expect(searchProviders).not.toHaveBeenCalled();
  });
});

// ---- Error surfacing ----

describe('failure surfacing', () => {
  it('provider failure becomes an explicit error state, not fake "no results"', async () => {
    const p = useSearchStore.getState().search('boom');
    await flush();
    pending.get('boom')!.reject(new Error('backend exploded'));
    await flush();
    await p;

    const s = useSearchStore.getState();
    expect(s.ytStatus).toBe('error');
    expect(s.status).toBe('error');
    expect(s.error).toBe('backend exploded');
    expect(s.ytResults).toEqual([]);
  });

  it('timeout gets a user-actionable message', async () => {
    const p = useSearchStore.getState().search('slow');
    await flush();
    pending.get('slow')!.reject(new TimeoutError('http://x/api/youtube/search'));
    await flush();
    await p;

    const s = useSearchStore.getState();
    expect(s.ytStatus).toBe('error');
    expect(s.error).toBe('Search timed out. Try again.');
  });

  it('offline failure is classified as offline', async () => {
    const p = useSearchStore.getState().search('off');
    await flush();
    pending.get('off')!.reject(new OfflineError());
    await flush();
    await p;

    const s = useSearchStore.getState();
    expect(s.ytStatus).toBe('offline');
    expect(s.status).toBe('offline');
  });

  it('library results survive a YouTube failure', async () => {
    const song = { id: 'lib-1', title: 'Local Song' } as unknown as Song;
    (librarySearchIndex.search as Mock).mockResolvedValue([{ song }]);

    const p = useSearchStore.getState().search('keep');
    await flush();
    pending.get('keep')!.reject(new Error('yt down'));
    await flush();
    await p;

    const s = useSearchStore.getState();
    expect(s.status).toBe('success'); // library half succeeded
    expect(s.libraryResults).toEqual([song]);
    expect(s.ytStatus).toBe('error');
    expect(s.ytResults).toEqual([]);
  });
});

// ---- Malformed / duplicate result protection ----

describe('result sanitization', () => {
  it('drops duplicate ids and rows without a playable id', async () => {
    const p = useSearchStore.getState().search('dupes');
    await flush();
    pending.get('dupes')!.resolve(
      ytResult([
        makeTrack('v1'),
        makeTrack('v1', 'Duplicate of v1'),
        makeTrack(''), // no playable id — can never be clicked
        makeTrack('v2'),
      ]),
    );
    await flush();
    await p;

    const s = useSearchStore.getState();
    expect(s.ytResults.map((r) => r.id)).toEqual(['v1', 'v2']);
  });

  it('zero results becomes an explicit empty state', async () => {
    const p = useSearchStore.getState().search('nothing');
    await flush();
    pending.get('nothing')!.resolve(ytResult([]));
    await flush();
    await p;

    const s = useSearchStore.getState();
    expect(s.status).toBe('empty');
    expect(s.ytStatus).toBe('empty');
    expect(s.error).toBeNull();
  });
});

// ---- Paging vs. new search race ----

describe('paging races', () => {
  it('an in-flight loadMore from an old query never overwrites a new search', async () => {
    // 1) Complete a search with > 15 rows so paging is armed.
    const p1 = useSearchStore.getState().search('q1');
    await flush();
    const many = Array.from({ length: 20 }, (_, i) => makeTrack(`q1-${i}`));
    pending.get('q1')!.resolve(ytResult(many));
    await flush();
    await p1;
    expect(useSearchStore.getState().hasMore).toBe(true);
    expect(useSearchStore.getState().ytResults).toHaveLength(15);

    // 2) Expire the 60s result cache so loadMore must hit the network.
    vi.useFakeTimers();
    try {
      await vi.advanceTimersByTimeAsync(61_000);

      const lm = useSearchStore.getState().loadMore(); // fetch now in flight
      await vi.advanceTimersByTimeAsync(0);

      // 3) User starts a NEW search while the paging request is in flight.
      const p2 = useSearchStore.getState().search('q2');
      await vi.advanceTimersByTimeAsync(0);

      // 4) Old paging response finally arrives — must be discarded.
      pending.get('q1')!.resolve(ytResult(many));
      await vi.advanceTimersByTimeAsync(0);
      await lm;

      let s = useSearchStore.getState();
      expect(s.debouncedQuery).toBe('q2');
      expect(s.ytResults.map((r) => r.id)).not.toContain('q1-15');
      expect(s.page).toBe(1);

      // 5) New search completes and owns the results.
      pending.get('q2')!.resolve(ytResult([makeTrack('new-1')]));
      await vi.advanceTimersByTimeAsync(0);
      await p2;

      s = useSearchStore.getState();
      expect(s.ytResults.map((r) => r.id)).toEqual(['new-1']);
      expect(s.ytStatus).toBe('success');
    } finally {
      vi.useRealTimers();
    }
  });

  it('loadMore is a no-op when nothing has been searched', async () => {
    await useSearchStore.getState().loadMore();
    expect(searchProviders).not.toHaveBeenCalled();
  });
});
