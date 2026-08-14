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

    fetchSpy.mockRejectedValueOnce(new TypeError('network down'));
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
    expect(state.failedDownloads[0].message).toContain('Download failed: 404');
  });
});
