import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useDownloadsStore } from './downloadsStore';

// ---------------------------------------------------------------------------
// Mock audio data (fake MP3: ID3v2 header)
// ---------------------------------------------------------------------------
function makeAudioBytes(size: number): Uint8Array {
  const buf = new Uint8Array(size);
  buf[0] = 0x49; // 'I'
  buf[1] = 0x44; // 'D'
  buf[2] = 0x33; // '3'
  return buf;
}

// ---------------------------------------------------------------------------
// Mock IndexedDB (compact harness)
// ---------------------------------------------------------------------------
interface MockRequest {
  result: any;
  error: any;
  onsuccess: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
}

function createMockRequest(result?: any, error?: any): MockRequest {
  const req: MockRequest = { result, error: error || null, onsuccess: null, onerror: null };
  setTimeout(() => {
    if (error && req.onerror) req.onerror({ target: req });
    else if (req.onsuccess) req.onsuccess({ target: req });
  }, 0);
  return req;
}

function createMockObjectStore(name: string, keyPath: string) {
  const data = new Map<any, any>();
  return {
    _data: data,
    name,
    keyPath,
    get: (key: any) => createMockRequest(data.get(key)),
    put: (value: any, key?: any) => { data.set(key ?? value[keyPath], value); return createMockRequest(); },
    delete: (key: any) => { data.delete(key); return createMockRequest(); },
    count: () => createMockRequest(data.size),
    getAll: () => createMockRequest(Array.from(data.values())),
    index: (indexName: string) => ({
      get: (key: any) => {
        for (const v of data.values()) {
          if ((v as any)[indexName] === key) return createMockRequest(v);
        }
        return createMockRequest(undefined);
      },
      count: (key: any) => {
        let c = 0;
        for (const v of data.values()) {
          if ((v as any)[indexName] === key) c++;
        }
        return createMockRequest(c);
      },
    }),
    createIndex: () => {},
  };
}

const stores = new Map<string, ReturnType<typeof createMockObjectStore>>();

function resetDB() {
  stores.clear();
  stores.set('songs', createMockObjectStore('songs', 'id'));
  stores.set('thumbnails', createMockObjectStore('thumbnails', 'url'));
  stores.set('meta', createMockObjectStore('meta', 'id'));
}

function resetStoreState() {
  useDownloadsStore.setState({
    downloads: [],
    downloadingIds: new Set(),
    progressMap: {},
    pausedIds: new Set(),
    loading: false,
    cacheSize: 0,
    blobUrlCache: {},
    failedDownloads: [],
    downloadQueue: [],
    storageBreakdown: null,
  });
}

beforeEach(() => {
  resetDB();
  resetStoreState();
  const mockDB: any = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string, opts: any) => {
      const store = createMockObjectStore(name, opts.keyPath);
      stores.set(name, store);
      return store;
    },
    transaction: (storeNames: string | string[], _mode: string) => {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      names.forEach(n => { if (!stores.has(n)) stores.set(n, createMockObjectStore(n, 'id')); });
      return {
        objectStore: (name: string) => stores.get(name)!,
        oncomplete: null as any,
        onerror: null as any,
      };
    },
    close: vi.fn(),
  };
  (globalThis as any).indexedDB = {
    open: (_name: string, _version: number) => createMockRequest(mockDB),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Mock fetch: resolves after a tick, rejects on abort
// ---------------------------------------------------------------------------
function makeAbortableFetch(respond: (url: string, init?: any) => Response) {
  return vi.fn((url: string, init?: any) => new Promise<Response>((resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    setTimeout(() => resolve(respond(url, init)), 10);
  }));
}

const MOCK_SONG = {
  id: 'test-song-1',
  youtubeId: 'dQw4w9WgXcQ',
  title: 'Test Song',
  artist: 'Test Artist',
  genre: 'Pop',
  duration: 200,
  coverArt: '',
  album: '',
  audioUrl: '',
  releaseYear: 0,
};

function successResponse(): Response {
  return new Response(makeAudioBytes(50_000), {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '50000' },
  });
}

function failureResponse(): Response {
  return new Response(null, { status: 404, statusText: 'Not Found' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('downloadsStore — download lifecycle', () => {
  it('downloads a song successfully and records it', async () => {
    vi.stubGlobal('fetch', makeAbortableFetch(() => successResponse()));

    await useDownloadsStore.getState().downloadSong(MOCK_SONG);

    const state = useDownloadsStore.getState();
    expect(state.downloadingIds.size).toBe(0);
    expect(state.downloads.length).toBe(1);
    expect(state.downloads[0].id).toBe('test-song-1');
    expect(state.failedDownloads.length).toBe(0);
  });

  it('does not start a duplicate download for the same song in the same tick', async () => {
    const fetchSpy = makeAbortableFetch(() => successResponse());
    vi.stubGlobal('fetch', fetchSpy);

    const store = useDownloadsStore.getState();
    const p1 = store.downloadSong(MOCK_SONG);
    const p2 = store.downloadSong(MOCK_SONG);
    await Promise.all([p1, p2]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(useDownloadsStore.getState().downloads.length).toBe(1);
  });

  it('does not re-download a song that is already downloaded', async () => {
    const fetchSpy = makeAbortableFetch(() => successResponse());
    vi.stubGlobal('fetch', fetchSpy);

    await useDownloadsStore.getState().downloadSong(MOCK_SONG);
    await useDownloadsStore.getState().downloadSong(MOCK_SONG);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(useDownloadsStore.getState().downloads.length).toBe(1);
  });

  it('cancel removes the download from the active set without marking it failed', async () => {
    vi.stubGlobal('fetch', makeAbortableFetch(() => successResponse()));

    const store = useDownloadsStore.getState();
    const promise = store.downloadSong(MOCK_SONG);
    store.cancelDownload(MOCK_SONG.youtubeId);
    await promise;

    const state = useDownloadsStore.getState();
    expect(state.downloadingIds.has(MOCK_SONG.youtubeId)).toBe(false);
    expect(state.failedDownloads.length).toBe(0);
    expect(state.downloads.length).toBe(0);
  });

  it('retry clears the failed entry and downloads again', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    // 404 is deterministic — no auto-retry, fails immediately
    fetchSpy.mockResolvedValueOnce(failureResponse());
    await useDownloadsStore.getState().downloadSong(MOCK_SONG);
    expect(useDownloadsStore.getState().failedDownloads.length).toBe(1);

    fetchSpy.mockResolvedValueOnce(successResponse());
    useDownloadsStore.getState().retryDownload(MOCK_SONG);

    await new Promise((r) => setTimeout(r, 40));

    const state = useDownloadsStore.getState();
    expect(state.failedDownloads.length).toBe(0);
    expect(state.downloads.length).toBe(1);
  });

  it('records a real failure message from the download pipeline', async () => {
    const fetchSpy = makeAbortableFetch(() => failureResponse());
    vi.stubGlobal('fetch', fetchSpy);

    await useDownloadsStore.getState().downloadSong(MOCK_SONG);

    const state = useDownloadsStore.getState();
    expect(state.failedDownloads.length).toBe(1);
    expect(state.failedDownloads[0].message).toContain('404');
    expect(state.failedDownloads[0].message).toMatch(/not found/i);
  });

  it('records an expired-link reason from a 403 response', async () => {
    vi.stubGlobal('fetch', makeAbortableFetch(() => new Response(null, { status: 403 })));

    await useDownloadsStore.getState().downloadSong(MOCK_SONG);

    const state = useDownloadsStore.getState();
    expect(state.failedDownloads.length).toBe(1);
    expect(state.failedDownloads[0].message).toMatch(/access denied|expired/i);
    expect(state.failedDownloads[0].message).toContain('403');
  });

  it('records a server-error reason from a JSON error body', async () => {
    // 200 + application/json body: the server rejected the request with a
    // structured reason. This is deterministic (no auto-retry), so the
    // message must surface immediately and verbatim.
    vi.stubGlobal('fetch', makeAbortableFetch(() => new Response(
      JSON.stringify({ success: false, message: 'Download produced no audio data', code: 'DOWNLOAD_EMPTY' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));

    await useDownloadsStore.getState().downloadSong(MOCK_SONG);

    const state = useDownloadsStore.getState();
    expect(state.failedDownloads.length).toBe(1);
    expect(state.failedDownloads[0].message).toContain('Download produced no audio data');
  });

  it('preserves a 5xx server-error reason after auto-retries are exhausted', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 500, statusText: 'Internal Server Error' }));
    vi.stubGlobal('fetch', fetchSpy);

    const p = useDownloadsStore.getState().downloadSong(MOCK_SONG);
    await vi.advanceTimersByTimeAsync(50);
    await p;
    // Wait for all retries with generous timing to account for jitter
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(10000);
    await vi.advanceTimersByTimeAsync(20000);
    await vi.advanceTimersByTimeAsync(50);

    // 1 initial + 3 retries = 4 total attempts
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    const state = useDownloadsStore.getState();
    expect(state.failedDownloads.length).toBe(1);
    expect(state.failedDownloads[0].message).toContain('500');
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Automatic retry of transient failures
// ---------------------------------------------------------------------------
describe('downloadsStore — automatic retry', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-retries a transient network failure and succeeds without user action', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(successResponse());
    vi.stubGlobal('fetch', fetchSpy);

    const p = useDownloadsStore.getState().downloadSong(MOCK_SONG);
    // Flush attempt 1 (IDB mock + fetch rejection are timer-driven)
    await vi.advanceTimersByTimeAsync(50);
    await p;

    // Not surfaced as failed while retries remain
    expect(useDownloadsStore.getState().failedDownloads.length).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // The retry fires after the backoff (with jitter, so use generous timing)
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(50);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const state = useDownloadsStore.getState();
    expect(state.downloads.length).toBe(1);
    expect(state.failedDownloads.length).toBe(0);
  });

  it('never auto-retries a deterministic 404 failure', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn().mockResolvedValue(failureResponse());
    vi.stubGlobal('fetch', fetchSpy);

    const p = useDownloadsStore.getState().downloadSong(MOCK_SONG);
    await vi.advanceTimersByTimeAsync(50);
    await p;

    expect(useDownloadsStore.getState().failedDownloads.length).toBe(1);

    // No retry may fire, no matter how long we wait
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('surfaces the final error reason after exhausting all auto-retries', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchSpy);

    const p = useDownloadsStore.getState().downloadSong(MOCK_SONG);
    await vi.advanceTimersByTimeAsync(50);
    await p;
    // Wait for all retries with generous timing to account for jitter
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(10000);
    await vi.advanceTimersByTimeAsync(20000);
    await vi.advanceTimersByTimeAsync(50);

    // 1 initial + 3 retries = 4 total attempts
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    const state = useDownloadsStore.getState();
    expect(state.failedDownloads.length).toBe(1);
    expect(state.failedDownloads[0].message).toMatch(/network error/i);
    expect(state.downloads.length).toBe(0);
  });

  it('cancel suppresses a pending auto-retry', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchSpy);

    const p = useDownloadsStore.getState().downloadSong(MOCK_SONG);
    await vi.advanceTimersByTimeAsync(50);
    await p;

    useDownloadsStore.getState().cancelDownload(MOCK_SONG.youtubeId);

    await vi.advanceTimersByTimeAsync(10_000);

    // Only the initial attempt should have been made (no retries after cancel)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(useDownloadsStore.getState().failedDownloads.length).toBe(0);
    expect(useDownloadsStore.getState().downloads.length).toBe(0);
  });

  it('manual retry resets the auto-retry budget', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(successResponse());
    vi.stubGlobal('fetch', fetchSpy);

    const p = useDownloadsStore.getState().downloadSong(MOCK_SONG);
    await vi.advanceTimersByTimeAsync(50);
    await p;
    // Wait for all retries with generous timing to account for jitter
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(10000);
    await vi.advanceTimersByTimeAsync(20000);
    await vi.advanceTimersByTimeAsync(50);

    // Budget exhausted — failure is now visible (1 initial + 3 retries = 4 attempts)
    expect(useDownloadsStore.getState().failedDownloads.length).toBe(1);

    // Manual retry gets a fresh budget and succeeds
    useDownloadsStore.getState().retryDownload(MOCK_SONG);
    await vi.advanceTimersByTimeAsync(50);

    const state = useDownloadsStore.getState();
    expect(state.failedDownloads.length).toBe(0);
    expect(state.downloads.length).toBe(1);
  });
});
