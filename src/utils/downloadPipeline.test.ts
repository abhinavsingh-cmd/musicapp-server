import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  downloadSongWithProgress,
  isValidBlob,
  isTransientDownloadError,
  pauseDownload,
  resumeDownload,
  cancelDownloadById,
  HEADER_TIMEOUT_MS,
  STALL_TIMEOUT_MS,
} from './downloadManager';
// Warm the provider module graph at import time. The download path lazy-
// imports the YouTube provider; under vi.useFakeTimers() a first-time
// vite-node dynamic import never settles, so the stall tests below would
// hang on descriptor resolution instead of exercising the timeout.
import '../providers/index';

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
    ).rejects.toThrow(/not found.*404|404.*not found/i);
  });

  it('throws on 403 response with an expired-link explanation', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 403, statusText: 'Forbidden' }));

    await expect(
      downloadSongWithProgress(MOCK_SONG),
    ).rejects.toThrow(/access denied.*403|expired/i);
  });

  it('throws on 429 response with a rate-limit explanation', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 429, statusText: 'Too Many Requests' }));

    await expect(
      downloadSongWithProgress(MOCK_SONG),
    ).rejects.toThrow(/rate-limit.*429|429/i);
  });

  it('throws on HTTP 500 with a server-error explanation', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 500, statusText: 'Internal Server Error' }));

    await expect(
      downloadSongWithProgress(MOCK_SONG),
    ).rejects.toThrow(/server.*error.*500|500/i);
  });

  it('throws on server JSON error (500 with application/json body)', async () => {
    fetchSpy.mockResolvedValue(makeJsonErrorResponse());

    await expect(
      downloadSongWithProgress(MOCK_SONG),
    ).rejects.toThrow(/500.*Download failed|Download failed.*500/s);
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

  it('REQUIREMENT: a simulated 0-byte response is rejected AND nothing is persisted', async () => {
    // The exact failure mode from the field: HTTP 200, audio/mpeg, empty body.
    // A 0-byte blob must never be written to the store as a "successful"
    // download, regardless of what the server claimed.
    fetchSpy.mockResolvedValue(new Response(new Uint8Array(0), {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '0' },
    }));

    await expect(downloadSongWithProgress(MOCK_SONG)).rejects.toThrow(/empty|too small/i);

    const songsStore = stores.get('songs')!;
    expect(songsStore._data.size).toBe(0);
    expect(songsStore._data.get('test-song-1')).toBeUndefined();
  });

  it('REQUIREMENT: a valid audio response succeeds AND is persisted', async () => {
    const audioBytes = makeAudioBytes(50_000);
    fetchSpy.mockResolvedValue(makeAudioResponse(audioBytes));

    const result = await downloadSongWithProgress(MOCK_SONG);

    expect(result.size).toBe(50_000);
    expect(isValidBlob(result.audioBlob)).toBe(true);

    const songsStore = stores.get('songs')!;
    expect(songsStore._data.size).toBe(1);
    const entry = songsStore._data.get('test-song-1');
    expect(entry).toBeDefined();
    expect(entry.size).toBe(50_000);
    expect(entry.audioBlob).toBeInstanceOf(Blob);
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

  it('rejects an HTML error page served with text/html content type', async () => {
    const html = new TextEncoder().encode('<html><body>403 Forbidden — link expired</body></html>');
    fetchSpy.mockResolvedValue(new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }));

    await expect(
      downloadSongWithProgress(MOCK_SONG),
    ).rejects.toThrow(/HTML error page|expired/i);
  });

  it('never persists anything when the download fails', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 500 }));

    await expect(downloadSongWithProgress(MOCK_SONG)).rejects.toThrow();

    const songsStore = stores.get('songs')!;
    expect(songsStore._data.size).toBe(0);
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

  it('rejects an over-delivered stream (more bytes than declared)', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(makeAudioBytes(30_000));
        controller.enqueue(makeAudioBytes(30_000));
        controller.close();
      },
    });
    fetchSpy.mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '40000' },
    }));

    await expect(
      downloadSongWithProgress(MOCK_SONG),
    ).rejects.toThrow(/corrupted|declared/i);

    // Nothing may be persisted
    expect(stores.get('songs')!._data.size).toBe(0);
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
    ).rejects.toThrow(/HTML error page|Unexpected response type|invalid/i);
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

// ---------------------------------------------------------------------------
// Transient vs deterministic failure classification (drives auto-retry)
// ---------------------------------------------------------------------------
describe('download failure classification', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  it('marks fetch network failures as transient', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await downloadSongWithProgress(MOCK_SONG).catch((e) => e);
    expect(isTransientDownloadError(err)).toBe(true);
    expect(err.message).toMatch(/network error/i);
  });

  it('marks truncated transfers as transient', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(makeAudioBytes(20_000));
        controller.close();
      },
    });
    fetchSpy.mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '50000' },
    }));
    const err = await downloadSongWithProgress(MOCK_SONG).catch((e) => e);
    expect(isTransientDownloadError(err)).toBe(true);
    expect(err.message).toMatch(/incomplete/i);
  });

  it('marks mid-stream connection loss as transient', async () => {
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
    const err = await downloadSongWithProgress(MOCK_SONG).catch((e) => e);
    expect(isTransientDownloadError(err)).toBe(true);
  });

  it('marks 5xx and 429 as transient but not 4xx', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 502 }));
    expect(isTransientDownloadError(await downloadSongWithProgress(MOCK_SONG).catch((e) => e))).toBe(true);

    fetchSpy.mockResolvedValue(new Response(null, { status: 429 }));
    expect(isTransientDownloadError(await downloadSongWithProgress(MOCK_SONG).catch((e) => e))).toBe(true);

    fetchSpy.mockResolvedValue(new Response(null, { status: 404 }));
    expect(isTransientDownloadError(await downloadSongWithProgress(MOCK_SONG).catch((e) => e))).toBe(false);

    fetchSpy.mockResolvedValue(new Response(null, { status: 403 }));
    expect(isTransientDownloadError(await downloadSongWithProgress(MOCK_SONG).catch((e) => e))).toBe(false);
  });

  it('marks completed-but-invalid payloads as NOT transient', async () => {
    // Transfer completes fully, but the bytes are an HTML error page —
    // retrying the same URL would return the same garbage.
    const html = new TextEncoder().encode(('<html>expired</html>'.padEnd(50_000, ' ')));
    fetchSpy.mockResolvedValue(makeAudioResponse(html, 'audio/mpeg'));
    const err = await downloadSongWithProgress(MOCK_SONG).catch((e) => e);
    expect(isTransientDownloadError(err)).toBe(false);
    expect(err.message).toMatch(/invalid/i);
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

  it('follows redirects and validates the final response', async () => {
    const audioBytes = makeAudioBytes(40_000);
    const finalResponse = makeAudioResponse(audioBytes);
    // Response.redirected is read-only — simulate a redirected fetch result.
    Object.defineProperty(finalResponse, 'redirected', { value: true });
    Object.defineProperty(finalResponse, 'url', { value: 'https://cdn.example.com/final.mp3' });
    fetchSpy.mockResolvedValue(finalResponse);

    const result = await downloadSongWithProgress(MOCK_SONG);
    expect(result.size).toBe(40_000);
    // fetch must have been asked to follow redirects
    expect(fetchSpy.mock.calls[0][1]?.redirect).toBe('follow');
  });

  it('rejects an expired redirect target that serves an error page', async () => {
    const html = new TextEncoder().encode('<html>expired</html>');
    const finalResponse = new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
    Object.defineProperty(finalResponse, 'redirected', { value: true });
    fetchSpy.mockResolvedValue(finalResponse);

    await expect(downloadSongWithProgress(MOCK_SONG)).rejects.toThrow(/HTML error page|expired|Unexpected/i);
  });

  it('cancels mid-stream without persisting a partial file', async () => {
    const ctrl = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(makeAudioBytes(10_000));
        // Deliver the next chunk slowly so the abort lands mid-download.
        setTimeout(() => {
          controller.enqueue(makeAudioBytes(10_000));
          controller.close();
        }, 50);
      },
    });
    fetchSpy.mockImplementation(() => new Promise<Response>((resolve, reject) => {
      ctrl.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      resolve(new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      }));
    }));

    const promise = downloadSongWithProgress(MOCK_SONG, undefined, ctrl.signal);
    setTimeout(() => ctrl.abort(), 10);

    await expect(promise).rejects.toThrow(/abort/i);
    const songsStore = stores.get('songs')!;
    expect(songsStore._data.size).toBe(0);
  });

  it('pause blocks the download until resume completes it', async () => {
    const audioBytes = makeAudioBytes(30_000);
    fetchSpy.mockResolvedValue(makeAudioResponse(audioBytes));

    const key = MOCK_SONG.youtubeId;
    const promise = downloadSongWithProgress(MOCK_SONG);

    // Pause immediately — the read loop must block on the gate.
    pauseDownload(key);
    let settled = false;
    void promise.then(() => { settled = true; });

    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false);

    resumeDownload(key);
    const result = await promise;
    expect(settled).toBe(true);
    expect(result.size).toBe(30_000);
  });

  it('resume called before the loop reaches the pause gate still completes', async () => {
    const audioBytes = makeAudioBytes(30_000);
    fetchSpy.mockResolvedValue(makeAudioResponse(audioBytes));

    const key = MOCK_SONG.youtubeId;
    // Pause + resume before the download loop reads any chunk — this is the
    // race that used to hang forever when resume resolved a throwaway promise.
    pauseDownload(key);
    resumeDownload(key);

    const result = await downloadSongWithProgress(MOCK_SONG);
    expect(result.size).toBe(30_000);
  });
});

// ---------------------------------------------------------------------------
// Hard-settlement guarantees: a download must NEVER stay "in progress"
// forever. These are the exact failure modes that would otherwise leave the
// row button spinning: a server that accepts the connection but never
// responds, and a body that stops producing bytes mid-stream.
// ---------------------------------------------------------------------------
describe('download hard-settlement guarantees', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  it('REQUIREMENT: a server that never sends response headers fails as a transient timeout, never hangs', async () => {
    vi.useFakeTimers();
    try {
      // The connection is accepted but no response ever arrives — a wedged
      // server/network would otherwise hold the fetch (and the button's
      // downloading state) forever.
      fetchSpy.mockImplementation(() => new Promise(() => {}));

      const p = downloadSongWithProgress(MOCK_SONG);
      let settled = false;
      p.finally(() => { settled = true; }).catch(() => {});

      await vi.advanceTimersByTimeAsync(HEADER_TIMEOUT_MS + 100);
      const err = await p.catch((e: unknown) => e);
      expect(settled).toBe(true);
      expect(err).toMatchObject({ transient: true });
      expect((err as Error).message).toMatch(/timed out/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('REQUIREMENT: a body that stalls mid-stream fails as transient after the stall deadline, never hangs', async () => {
    vi.useFakeTimers();
    try {
      // Headers arrive and the first chunk is delivered — then the
      // connection dies silently: read() never resolves and never errors.
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(makeAudioBytes(10_000));
        },
      });
      fetchSpy.mockResolvedValue(new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      }));

      const p = downloadSongWithProgress(MOCK_SONG);
      let settled = false;
      p.finally(() => { settled = true; }).catch(() => {});

      // First chunk lands immediately; the transfer is then mid-flight.
      await vi.advanceTimersByTimeAsync(10);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS + 100);
      const err = await p.catch((e: unknown) => e);
      expect(settled).toBe(true);
      expect(err).toMatchObject({ transient: true });
      expect((err as Error).message).toMatch(/stalled/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancelling a paused download settles promptly (pause gate is released)', async () => {
    const audioBytes = makeAudioBytes(30_000);
    fetchSpy.mockResolvedValue(makeAudioResponse(audioBytes));

    const key = MOCK_SONG.youtubeId;
    pauseDownload(key);

    const ctrl = new AbortController();
    const promise = downloadSongWithProgress(MOCK_SONG, undefined, ctrl.signal);
    let settled = false;
    void promise.then(() => { settled = true; }).catch(() => {});

    // Let the loop reach the pause gate and block on it, THEN cancel — this
    // is the exact race that used to leak the parallel slot forever because
    // the gate was never released.
    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false);

    ctrl.abort();
    // The promise must settle (reject with AbortError) instead of blocking
    // on the pause gate forever — that is the whole point of the fix.
    await expect(promise).rejects.toThrow(/abort/i);
    // Clean up the downloadManager controller so no state leaks to other tests.
    cancelDownloadById(key);
  });
});
