import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { downloadSongWithProgress, isValidBlob } from './downloadManager';

// ---------------------------------------------------------------------------
// Mock audio data (fake MP3: ID3v2 header + frame sync)
// ---------------------------------------------------------------------------
function makeAudioBytes(size: number): Uint8Array {
  const buf = new Uint8Array(size);
  // ID3v2 header
  buf[0] = 0x49; // 'I'
  buf[1] = 0x44; // 'D'
  buf[2] = 0x33; // '3'
  buf[3] = 0x03; // version
  buf[4] = 0x00; // flags
  // rest is zeros (valid enough for MIME detection)
  return buf;
}

function makeEmptyResponse(): Response {
  return new Response(null, {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg' },
  });
}

function makeJsonErrorResponse(): Response {
  return new Response(JSON.stringify({ success: false, message: 'Download failed', code: 'DOWNLOAD_FAILED' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeAudioResponse(bytes: Uint8Array, mime = 'audio/mpeg'): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(bytes.length),
    },
  });
}

function makeTooSmallResponse(): Response {
  const tiny = new Uint8Array(100);
  return new Response(tiny, {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '100' },
  });
}

// ---------------------------------------------------------------------------
// Mock IndexedDB
// ---------------------------------------------------------------------------
interface MockIDBObjectStore {
  _data: Map<IDBValidKey, any>;
  name: string;
  keyPath: string | null;
  get(key: IDBValidKey): IDBRequest;
  put(value: any, key?: IDBValidKey): IDBRequest;
  delete(key: IDBValidKey): IDBRequest;
  count(): IDBRequest;
  getAll(): IDBRequest;
  index(name: string): MockIDBIndex;
  createIndex(name: string, keyPath: string, opts?: any): void;
}
interface MockIDBIndex {
  get(key: IDBValidKey): IDBRequest;
  count(key?: IDBValidKey): IDBRequest;
}
interface MockIDBRequest {
  result: any;
  error: any;
  onsuccess: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
}

function createMockRequest(result?: any, error?: any): MockIDBRequest {
  const req: MockIDBRequest = { result, error: error || null, onsuccess: null, onerror: null };
  setTimeout(() => {
    if (error && req.onerror) req.onerror({ target: req });
    else if (req.onsuccess) req.onsuccess({ target: req });
  }, 0);
  return req;
}

function createMockObjectStore(name: string, keyPath: string): MockIDBObjectStore {
  const data = new Map<IDBValidKey, any>();
  const store: MockIDBObjectStore = {
    _data: data,
    name,
    keyPath,
    get(key) { return createMockRequest(data.get(key)); },
    put(value, key) { const k = key ?? value[keyPath]; data.set(k, value); return createMockRequest(); },
    delete(key) { data.delete(key); return createMockRequest(); },
    count() { return createMockRequest(data.size); },
    getAll() { return createMockRequest(Array.from(data.values())); },
    index(name) {
      return {
        get(key) {
          for (const [, v] of data.entries()) {
            if ((v as any)[name] === key) return createMockRequest(v);
          }
          return createMockRequest(undefined);
        },
        count(key) {
          let c = 0;
          for (const v of data.values()) {
            if ((v as any)[name] === key) c++;
          }
          return createMockRequest(c);
        },
      };
    },
    createIndex() {},
  };
  return store;
}

const stores = new Map<string, MockIDBObjectStore>();

function resetDB() {
  stores.clear();
  stores.set('songs', createMockObjectStore('songs', 'id'));
  stores.set('thumbnails', createMockObjectStore('thumbnails', 'url'));
  stores.set('meta', createMockObjectStore('meta', 'id'));
}

beforeEach(() => {
  resetDB();
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
// Mock song fixture
// ---------------------------------------------------------------------------
const MOCK_SONG = {
  id: 'test-song-1',
  youtubeId: 'dQw4w9WgXcQ',
  title: 'Test Song',
  artist: 'Test Artist',
  genre: 'Pop',
  duration: 200,
  coverArt: '',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('downloadSongWithProgress — full pipeline', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  it('throws on non-200 HTTP response', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 404, statusText: 'Not Found' }));

    await expect(
      downloadSongWithProgress(MOCK_SONG),
    ).rejects.toThrow('Download failed: 404');
  });

  it('throws on 403 response', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 403, statusText: 'Forbidden' }));

    await expect(
      downloadSongWithProgress(MOCK_SONG),
    ).rejects.toThrow('Download failed: 403');
  });

  it('throws on 429 response', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 429, statusText: 'Too Many Requests' }));

    await expect(
      downloadSongWithProgress(MOCK_SONG),
    ).rejects.toThrow('Download failed: 429');
  });

  it('throws on server JSON error (500 with application/json body)', async () => {
    fetchSpy.mockResolvedValue(makeJsonErrorResponse());

    await expect(
      downloadSongWithProgress(MOCK_SONG),
    ).rejects.toThrow('Download failed: 500');
  });

  it('throws when response body is null (empty response)', async () => {
    fetchSpy.mockResolvedValue(makeEmptyResponse());

    await expect(
      downloadSongWithProgress(MOCK_SONG),
    ).rejects.toThrow(/too small|empty|invalid/i);
  });

  it('throws on a zero-byte body served with audio/mpeg content type', async () => {
    fetchSpy.mockResolvedValue(new Response(new Uint8Array(0), {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '0' },
    }));

    await expect(
      downloadSongWithProgress(MOCK_SONG),
    ).rejects.toThrow(/too small|empty|invalid/i);
  });

  it('throws when downloaded blob is too small (< 10KB)', async () => {
    fetchSpy.mockResolvedValue(makeTooSmallResponse());

    await expect(
      downloadSongWithProgress(MOCK_SONG),
    ).rejects.toThrow(/too small|invalid/i);
  });

  it('rejects HTML bytes mislabeled with an audio/mpeg content type', async () => {
    const html = new TextEncoder().encode(('<html><body>Stream expired</body></html>'.padEnd(50_000, ' ')));
    fetchSpy.mockResolvedValue(makeAudioResponse(html, 'audio/mpeg'));

    await expect(
      downloadSongWithProgress(MOCK_SONG),
    ).rejects.toThrow(/invalid|audio data/i);
  });

  it('rejects JSON bytes mislabeled with an audio/mpeg content type', async () => {
    const json = new TextEncoder().encode(JSON.stringify({ error: 'expired', videoId: 'dQw4w9WgXcQ' }).padEnd(50_000, ' '));
    fetchSpy.mockResolvedValue(makeAudioResponse(json, 'audio/mpeg'));

    await expect(
      downloadSongWithProgress(MOCK_SONG),
    ).rejects.toThrow(/invalid|audio data/i);
  });

  it('rejects a partial download (declared longer than delivered)', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(makeAudioBytes(30_000));
        controller.close();
      },
    });
    fetchSpy.mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '50000' },
    }));

    await expect(
      downloadSongWithProgress(MOCK_SONG),
    ).rejects.toThrow(/incomplete|received/i);
  });

  it('rejects when the connection drops mid-stream', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(makeAudioBytes(20_000));
        controller.error(new Error('socket hang up'));
      },
    });
    fetchSpy.mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg' },
    }));

    await expect(
      downloadSongWithProgress(MOCK_SONG),
    ).rejects.toThrow(/connection lost|network|interrupted/i);
  });

  it('successfully downloads a valid audio response (> 10KB)', async () => {
    const audioBytes = makeAudioBytes(50_000);
    fetchSpy.mockResolvedValue(makeAudioResponse(audioBytes));

    const result = await downloadSongWithProgress(MOCK_SONG);

    expect(result.id).toBe('test-song-1');
    expect(result.youtubeId).toBe('dQw4w9WgXcQ');
    expect(result.size).toBe(50_000);
    expect(result.audioBlob).toBeInstanceOf(Blob);
    expect(result.audioBlob.size).toBe(50_000);
    expect(result.audioUrl).toBeTruthy();
    expect(result.downloadedAt).toBeGreaterThan(0);
  });

  it('saved blob is valid per isValidBlob()', async () => {
    const audioBytes = makeAudioBytes(50_000);
    fetchSpy.mockResolvedValue(makeAudioResponse(audioBytes));

    const result = await downloadSongWithProgress(MOCK_SONG);
    expect(isValidBlob(result.audioBlob)).toBe(true);
  });

  it('saved blob has correct MIME type', async () => {
    const audioBytes = makeAudioBytes(50_000);
    fetchSpy.mockResolvedValue(makeAudioResponse(audioBytes, 'audio/mp4'));

    const result = await downloadSongWithProgress(MOCK_SONG);
    expect(result.audioBlob.type).toBe('audio/mp4');
  });

  it('rejects non-audio MIME type from server', async () => {
    const htmlBytes = new TextEncoder().encode('<html>error</html>');
    fetchSpy.mockResolvedValue(new Response(htmlBytes, {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    }));

    await expect(
      downloadSongWithProgress(MOCK_SONG),
    ).rejects.toThrow(/Unexpected response type|invalid/i);
  });

  it('rejects application/json response body as error', async () => {
    const jsonBody = new TextEncoder().encode(JSON.stringify({ success: false, message: 'Video unavailable' }));
    fetchSpy.mockResolvedValue(new Response(jsonBody, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(
      downloadSongWithProgress(MOCK_SONG),
    ).rejects.toThrow(/Video unavailable|error|invalid/i);
  });

  it('progress callback fires with loaded > 0', async () => {
    const audioBytes = makeAudioBytes(30_000);
    fetchSpy.mockResolvedValue(makeAudioResponse(audioBytes));

    const progressCalls: Array<{ loaded: number; total: number; percent: number }> = [];
    await downloadSongWithProgress(MOCK_SONG, (p) => progressCalls.push(p));

    expect(progressCalls.length).toBeGreaterThan(0);
    const last = progressCalls[progressCalls.length - 1];
    expect(last.loaded).toBe(30_000);
    expect(last.total).toBe(30_000);
    expect(last.percent).toBe(100);
  });

  it('aborts when signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();

    await expect(
      downloadSongWithProgress(MOCK_SONG, undefined, ctrl.signal),
    ).rejects.toThrow(/abort/i);
  });

  it('returns blob URL that can be revoked', async () => {
    const audioBytes = makeAudioBytes(50_000);
    fetchSpy.mockResolvedValue(makeAudioResponse(audioBytes));

    const result = await downloadSongWithProgress(MOCK_SONG);
    expect(result.audioUrl).toMatch(/^blob:/);
  });

  it('persists to IndexedDB (mock)', async () => {
    const audioBytes = makeAudioBytes(50_000);
    fetchSpy.mockResolvedValue(makeAudioResponse(audioBytes));

    await downloadSongWithProgress(MOCK_SONG);

    const songsStore = stores.get('songs')!;
    const entry = songsStore._data.get('test-song-1');
    expect(entry).toBeDefined();
    expect(entry.id).toBe('test-song-1');
    expect(entry.size).toBe(50_000);
  });

  it('fetches from correct API endpoint', async () => {
    const audioBytes = makeAudioBytes(50_000);
    fetchSpy.mockResolvedValue(makeAudioResponse(audioBytes));

    await downloadSongWithProgress(MOCK_SONG);

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/download/dQw4w9WgXcQ');
    expect(calledUrl).toContain('title=Test%20Song');
  });
});

describe('download edge cases', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  it('handles zero Content-Length with actual body data', async () => {
    const audioBytes = makeAudioBytes(20_000);
    fetchSpy.mockResolvedValue(new Response(audioBytes, {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '0' },
    }));

    const result = await downloadSongWithProgress(MOCK_SONG);
    expect(result.size).toBe(20_000);
  });

  it('handles chunked response (no Content-Length header)', async () => {
    const audioBytes = makeAudioBytes(25_000);
    fetchSpy.mockResolvedValue(new Response(audioBytes, {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg' },
    }));

    const result = await downloadSongWithProgress(MOCK_SONG);
    expect(result.size).toBe(25_000);
  });

  it('handles very large download (> 1MB)', async () => {
    const audioBytes = makeAudioBytes(1_500_000);
    fetchSpy.mockResolvedValue(makeAudioResponse(audioBytes));

    const result = await downloadSongWithProgress(MOCK_SONG);
    expect(result.size).toBe(1_500_000);
    expect(isValidBlob(result.audioBlob)).toBe(true);
  });
});
