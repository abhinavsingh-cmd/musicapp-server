import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isValidBlob, repairDownloads } from './downloadManager';

// ---------------------------------------------------------------------------
// Fixtures — repairDownloads now does full verification (size + mime + magic
// bytes), so "valid" blobs must start with real audio magic bytes (ID3v2).
// ---------------------------------------------------------------------------
function validAudioBlob(size = 50_000): Blob {
  const bytes = new Uint8Array(size);
  bytes[0] = 0x49; // 'I'
  bytes[1] = 0x44; // 'D'
  bytes[2] = 0x33; // '3'
  return new Blob([bytes], { type: 'audio/mpeg' });
}

// Zero-filled blob: right size, right mime, but no audio magic bytes.
function garbageBlob(size = 50_000): Blob {
  return new Blob([new ArrayBuffer(size)], { type: 'audio/mpeg' });
}

// ---------------------------------------------------------------------------
// Mock IndexedDB
// ---------------------------------------------------------------------------

interface MockIDBObjectStore {
  _data: Map<IDBValidKey, any>;
  _indexData: Map<string, Map<IDBValidKey, any>>;
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
    _indexData: new Map(),
    name,
    keyPath,
    get(key) {
      return createMockRequest(data.get(key));
    },
    put(value, key) {
      const k = key ?? value[keyPath];
      data.set(k, value);
      return createMockRequest();
    },
    delete(key) {
      data.delete(key);
      return createMockRequest();
    },
    count() {
      return createMockRequest(data.size);
    },
    getAll() {
      return createMockRequest(Array.from(data.values()));
    },
    index(name) {
      if (!store._indexData.has(name)) {
        store._indexData.set(name, new Map());
      }
      const idxData = store._indexData.get(name)!;
      return {
        get(key) {
          for (const [k, v] of data.entries()) {
            if (v[name] === key) return createMockRequest(v);
          }
          return createMockRequest(undefined);
        },
        count(key) {
          let count = 0;
          for (const v of data.values()) {
            if (v[name] === key) count++;
          }
          return createMockRequest(count);
        },
      };
    },
    createIndex() {},
  };
  return store;
}

const stores = new Map<string, MockIDBObjectStore>();
let dbVersion = 1;

function resetDB() {
  stores.clear();
  stores.set('songs', createMockObjectStore('songs', 'id'));
  stores.set('thumbnails', createMockObjectStore('thumbnails', 'url'));
  stores.set('meta', createMockObjectStore('meta', 'id'));
}

// Mock indexedDB.open
const originalIndexedDB = globalThis.indexedDB;

beforeEach(() => {
  resetDB();
  dbVersion = 1;

  const mockDB: any = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string, opts: any) => {
      const store = createMockObjectStore(name, opts.keyPath);
      stores.set(name, store);
      return store;
    },
    transaction: (storeNames: string | string[], mode: string) => {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      const storesInTx = names.map(n => stores.get(n)!).filter(Boolean);
      return {
        objectStore: (name: string) => stores.get(name)!,
        oncomplete: null as any,
        onerror: null as any,
      };
    },
    close: vi.fn(),
  };

  (globalThis as any).indexedDB = {
    open: (_name: string, _version: number) => {
      const req = createMockRequest(mockDB);
      return req;
    },
  };
});

afterEach(() => {
  if (originalIndexedDB) {
    (globalThis as any).indexedDB = originalIndexedDB;
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isValidBlob', () => {
  it('returns true for valid Blob with size >= MIN_AUDIO_SIZE (10KB)', () => {
    const blob = new Blob([new ArrayBuffer(20_000)], { type: 'audio/mpeg' });
    expect(isValidBlob(blob)).toBe(true);
  });

  it('returns false for Blob smaller than MIN_AUDIO_SIZE', () => {
    const blob = new Blob([new ArrayBuffer(5_000)], { type: 'audio/mpeg' });
    expect(isValidBlob(blob)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isValidBlob(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isValidBlob(undefined)).toBe(false);
  });

  it('returns false for non-Blob objects', () => {
    expect(isValidBlob('not a blob')).toBe(false);
    expect(isValidBlob(123)).toBe(false);
    expect(isValidBlob({ size: 20000 })).toBe(false);
  });

  it('returns true for empty-type Blob if size is sufficient', () => {
    const blob = new Blob([new ArrayBuffer(15_000)], { type: '' });
    expect(isValidBlob(blob)).toBe(true);
  });
});

describe('repairDownloads', () => {
  it('removes entries with null audioBlob', async () => {
    const songsStore = stores.get('songs')!;
    songsStore._data.set('song-1', {
      id: 'song-1',
      youtubeId: 'abc123',
      title: 'Good Song',
      artist: 'Artist',
      genre: 'Pop',
      duration: 200,
      coverArt: '',
      audioBlob: validAudioBlob(),
      audioUrl: '',
      downloadedAt: Date.now(),
      size: 50_000,
    });
    songsStore._data.set('song-2', {
      id: 'song-2',
      youtubeId: 'def456',
      title: 'Bad Song',
      artist: 'Artist',
      genre: 'Pop',
      duration: 200,
      coverArt: '',
      audioBlob: null,
      audioUrl: '',
      downloadedAt: Date.now(),
      size: 0,
    });

    const removed = await repairDownloads();
    expect(removed).toBe(1);

    // song-1 should still exist
    const remaining = Array.from(songsStore._data.values());
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('song-1');
  });

  it('removes entries with too-small audioBlob', async () => {
    const songsStore = stores.get('songs')!;
    songsStore._data.set('song-1', {
      id: 'song-1',
      youtubeId: 'abc',
      title: 'Tiny',
      artist: 'A',
      genre: 'Pop',
      duration: 10,
      coverArt: '',
      audioBlob: new Blob([new ArrayBuffer(100)], { type: 'audio/mpeg' }),
      audioUrl: '',
      downloadedAt: Date.now(),
      size: 100,
    });

    const removed = await repairDownloads();
    expect(removed).toBe(1);
    expect(songsStore._data.size).toBe(0);
  });

  it('keeps entries with valid audioBlob', async () => {
    const songsStore = stores.get('songs')!;
    songsStore._data.set('song-1', {
      id: 'song-1',
      youtubeId: 'abc',
      title: 'Valid',
      artist: 'A',
      genre: 'Pop',
      duration: 200,
      coverArt: '',
      audioBlob: validAudioBlob(),
      audioUrl: '',
      downloadedAt: Date.now(),
      size: 50_000,
    });

    const removed = await repairDownloads();
    expect(removed).toBe(0);
    expect(songsStore._data.size).toBe(1);
  });

  it('returns 0 for empty database', async () => {
    const removed = await repairDownloads();
    expect(removed).toBe(0);
  });

  it('handles mixed valid and invalid entries', async () => {
    const songsStore = stores.get('songs')!;

    songsStore._data.set('good-1', {
      id: 'good-1', youtubeId: 'a1', title: 'G1', artist: 'A', genre: '',
      duration: 100, coverArt: '', audioBlob: validAudioBlob(), audioUrl: '',
      downloadedAt: 1, size: 50_000,
    });
    songsStore._data.set('bad-1', {
      id: 'bad-1', youtubeId: 'b1', title: 'B1', artist: 'A', genre: '',
      duration: 100, coverArt: '', audioBlob: null, audioUrl: '',
      downloadedAt: 2, size: 0,
    });
    songsStore._data.set('good-2', {
      id: 'good-2', youtubeId: 'a2', title: 'G2', artist: 'A', genre: '',
      duration: 100, coverArt: '', audioBlob: validAudioBlob(), audioUrl: '',
      downloadedAt: 3, size: 50_000,
    });
    songsStore._data.set('bad-2', {
      id: 'bad-2', youtubeId: 'b2', title: 'B2', artist: 'A', genre: '',
      duration: 100, coverArt: '', audioBlob: new Blob([new ArrayBuffer(50)]), audioUrl: '',
      downloadedAt: 4, size: 50,
    });

    const removed = await repairDownloads();
    expect(removed).toBe(2);

    const remaining = Array.from(songsStore._data.values());
    expect(remaining).toHaveLength(2);
    expect(remaining.map((r: any) => r.id).sort()).toEqual(['good-1', 'good-2']);
  });

  it('removes a 0-byte "audio/mpeg" phantom entry (legacy bug regression)', async () => {
    const songsStore = stores.get('songs')!;
    songsStore._data.set('phantom', {
      id: 'phantom', youtubeId: 'ph1', title: 'Phantom', artist: 'A', genre: '',
      duration: 100, coverArt: '', audioBlob: new Blob([], { type: 'audio/mpeg' }),
      audioUrl: '', downloadedAt: 1, size: 0,
    });

    const removed = await repairDownloads();
    expect(removed).toBe(1);
    expect(songsStore._data.size).toBe(0);
  });

  it('removes large garbage blobs that lack audio magic bytes', async () => {
    const songsStore = stores.get('songs')!;
    songsStore._data.set('garbage', {
      id: 'garbage', youtubeId: 'g1', title: 'Garbage', artist: 'A', genre: '',
      duration: 100, coverArt: '', audioBlob: garbageBlob(), audioUrl: '',
      downloadedAt: 1, size: 50_000,
    });

    const removed = await repairDownloads();
    expect(removed).toBe(1);
    expect(songsStore._data.size).toBe(0);
  });
});
