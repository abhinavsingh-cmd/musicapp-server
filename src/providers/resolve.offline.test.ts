import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolvePlayableSource,
  registerLocalCopyResolver,
  resolveLocalCopy,
} from './resolve';
import { providerRegistry } from './registry';
import type { Track, TrackProvider } from './types';

// ---------------------------------------------------------------------------
// Offline resolution tests — a downloaded song must resolve to its local copy
// without touching the network, while ONLINE behavior stays exactly as before.
// ---------------------------------------------------------------------------

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 't1',
    provider: 'youtube',
    title: 'Song',
    artist: 'Artist',
    album: '',
    genre: 'Pop',
    duration: 200,
    artwork: '',
    externalId: 'yt1',
    ...overrides,
  };
}

function fakeProvider(resolveStream: TrackProvider['resolveStream']): TrackProvider {
  return {
    id: 'youtube',
    name: 'Fake',
    resolveStream,
  } as unknown as TrackProvider;
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

let cleanupProvider = false;

beforeEach(() => {
  registerLocalCopyResolver(null);
  setOnline(true);
});

afterEach(() => {
  if (cleanupProvider) {
    providerRegistry.unregister?.('youtube');
    cleanupProvider = false;
  }
  registerLocalCopyResolver(null);
  setOnline(true);
});

describe('offline-first resolution', () => {
  it('OFFLINE with a remote URL + downloaded copy — local wins, provider untouched', async () => {
    setOnline(false);
    const resolveStream = vi.fn();
    providerRegistry.register(fakeProvider(resolveStream));
    cleanupProvider = true;
    registerLocalCopyResolver(() => 'blob:local-copy');

    const src = await resolvePlayableSource(makeTrack({ streamUrl: 'https://cdn.example/stream' }));

    expect(src).not.toBeNull();
    expect(src!.kind).toBe('stream');
    if (src!.kind === 'stream') {
      expect(src!.streamUrl).toBe('blob:local-copy');
      expect(src!.isLocalFile).toBe(true);
    }
    // NO network attempt — the provider was never consulted.
    expect(resolveStream).not.toHaveBeenCalled();
  });

  it('ONLINE with a remote URL — remote wins (online behavior unchanged)', async () => {
    registerLocalCopyResolver(() => 'blob:local-copy');
    const src = await resolvePlayableSource(makeTrack({ streamUrl: 'https://cdn.example/stream' }));
    expect(src!.kind).toBe('stream');
    if (src!.kind === 'stream') {
      expect(src!.streamUrl).toBe('https://cdn.example/stream');
      expect(src!.isLocalFile).toBe(false);
    }
  });

  it('a local blob: streamUrl always short-circuits — provider never consulted', async () => {
    const resolveStream = vi.fn();
    providerRegistry.register(fakeProvider(resolveStream));
    cleanupProvider = true;

    const src = await resolvePlayableSource(makeTrack({ streamUrl: 'blob:already-local' }));
    expect(src!.kind).toBe('stream');
    if (src!.kind === 'stream') expect(src!.isLocalFile).toBe(true);
    expect(resolveStream).not.toHaveBeenCalled();
  });
});

describe('local fallback when the provider has nothing', () => {
  it('provider returns null (offline) — the downloaded copy plays', async () => {
    providerRegistry.register(fakeProvider(vi.fn().mockResolvedValue(null)));
    cleanupProvider = true;
    registerLocalCopyResolver(() => 'blob:local-copy');

    const src = await resolvePlayableSource(makeTrack());
    expect(src).not.toBeNull();
    if (src!.kind === 'stream') expect(src!.streamUrl).toBe('blob:local-copy');
  });

  it('provider THROWS (network down) — the downloaded copy plays', async () => {
    providerRegistry.register(fakeProvider(vi.fn().mockRejectedValue(new Error('offline'))));
    cleanupProvider = true;
    registerLocalCopyResolver(() => 'blob:local-copy');

    const src = await resolvePlayableSource(makeTrack());
    expect(src).not.toBeNull();
    if (src!.kind === 'stream') expect(src!.streamUrl).toBe('blob:local-copy');
  });

  it('localFallback:false — a corrupted copy is never handed back', async () => {
    providerRegistry.register(fakeProvider(vi.fn().mockResolvedValue(null)));
    cleanupProvider = true;
    registerLocalCopyResolver(() => 'blob:corrupted');

    const src = await resolvePlayableSource(makeTrack(), { localFallback: false });
    expect(src).toBeNull();
  });

  it('provider succeeds ONLINE — local copy is never substituted', async () => {
    providerRegistry.register(fakeProvider(vi.fn().mockResolvedValue({
      kind: 'stream',
      streamUrl: 'https://fresh.example/stream',
      isLocalFile: false,
    })));
    cleanupProvider = true;
    const localResolver = vi.fn(() => 'blob:local-copy');
    registerLocalCopyResolver(localResolver);

    const src = await resolvePlayableSource(makeTrack());
    if (src!.kind === 'stream') expect(src!.streamUrl).toBe('https://fresh.example/stream');
    expect(localResolver).not.toHaveBeenCalled();
  });

  it('no resolver registered — resolution degrades to the pre-offline behavior', async () => {
    providerRegistry.register(fakeProvider(vi.fn().mockResolvedValue(null)));
    cleanupProvider = true;
    const src = await resolvePlayableSource(makeTrack());
    expect(src).toBeNull();
  });

  it('a resolver returning a REMOTE url is rejected (local copies only)', () => {
    registerLocalCopyResolver(() => 'https://not-local.example/x');
    expect(resolveLocalCopy(makeTrack())).toBeNull();
  });

  it('a throwing resolver never breaks resolution', () => {
    registerLocalCopyResolver(() => { throw new Error('boom'); });
    expect(resolveLocalCopy(makeTrack())).toBeNull();
  });
});
