import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Smart-replacement service tests — strict identity matching, bounded
// candidate verification, probe-based play verification, total budget,
// offline short-circuit, and metadata preservation.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock('../providers', () => ({
  searchProviders: mocks.search,
  resolvePlayableSource: mocks.resolve,
  toTrack: (s: any) => ({
    id: s.id,
    provider: s.provider || 'youtube',
    title: s.title,
    artist: s.artist,
    album: s.album,
    genre: s.genre,
    duration: s.duration,
    artwork: s.coverArt,
    externalId: s.youtubeId,
    streamUrl: s.audioUrl || undefined,
  }),
  toSong: (t: any) => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    duration: t.duration,
    genre: t.genre || 'Unknown',
    coverArt: t.artwork || '',
    audioUrl: t.streamUrl || '',
    youtubeId: t.provider === 'youtube' ? t.externalId : undefined,
    provider: t.provider,
    releaseYear: t.releaseYear || 0,
  }),
}));

import { findVerifiedReplacement, isSameTrackIdentity } from './smartReplaceService';
import type { Song } from '../types/music';

/** Deterministic stand-in for the probe's throwaway HTMLAudioElement. */
class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  src = '';
  preload = '';
  paused = true;
  constructor() {
    super();
    FakeAudio.instances.push(this);
  }
  play(): Promise<void> { this.paused = false; return Promise.resolve(); }
  pause(): void { this.paused = true; }
  load(): void {}
  removeAttribute(name: string): void { if (name === 'src') this.src = ''; }
}

function makeFailedSong(overrides: Partial<Song> = {}): Song {
  return {
    id: 's1',
    title: 'My Song',
    artist: 'Alice',
    album: 'Original Album',
    duration: 200,
    genre: 'Pop',
    coverArt: 'orig-art',
    audioUrl: '',
    youtubeId: 'vid1',
    provider: 'youtube',
    releaseYear: 2020,
    ...overrides,
  } as Song;
}

function makeCandidate(id: string, overrides: Record<string, any> = {}) {
  return {
    id,
    provider: 'youtube',
    title: 'My Song',
    artist: 'Alice',
    album: 'Some Album',
    genre: 'Pop',
    duration: 205,
    artwork: `art-${id}`,
    externalId: id,
    ...overrides,
  };
}

function searchResult(tracks: any[]) {
  return [{ providerId: 'youtube', providerName: 'YouTube', tracks }];
}

async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

function lastProbe(): FakeAudio {
  return FakeAudio.instances[FakeAudio.instances.length - 1];
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

const realAudio = globalThis.Audio;

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as any).Audio = FakeAudio;
  FakeAudio.instances = [];
  mocks.search.mockReset();
  mocks.resolve.mockReset();
  setOnline(true);
});

afterEach(() => {
  vi.useRealTimers();
  (globalThis as any).Audio = realAudio;
});

describe('isSameTrackIdentity — strict matching', () => {
  const base = makeCandidate('x', { externalId: 'vid9' });

  it('matches identical titles ignoring punctuation/case', () => {
    expect(isSameTrackIdentity(base as any, makeCandidate('y', { title: 'my song!' }) as any)).toBe(true);
  });

  it('rejects a similar title with a different artist', () => {
    expect(isSameTrackIdentity(base as any, makeCandidate('y', { artist: 'Bob' }) as any)).toBe(false);
  });

  it('accepts artist containment (feat. / formatting variants)', () => {
    expect(isSameTrackIdentity(base as any, makeCandidate('y', { artist: 'Alice & Friends' }) as any)).toBe(true);
  });

  it('rejects a wildly different duration (same title, different song)', () => {
    expect(isSameTrackIdentity(base as any, makeCandidate('y', { duration: 60 }) as any)).toBe(false);
  });

  it('rejects an empty or missing title', () => {
    expect(isSameTrackIdentity(base as any, makeCandidate('y', { title: '' }) as any)).toBe(false);
  });
});

describe('findVerifiedReplacement', () => {
  it('offline: short-circuits without any search', async () => {
    setOnline(false);
    const result = await findVerifiedReplacement(makeFailedSong());
    expect(result.status).toBe('offline');
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it('success: replaces with the verified match, excludes the failed source, preserves metadata', async () => {
    const unrelated = makeCandidate('u1', { artist: 'Bob' });        // similar title only
    const failedSource = makeCandidate('vid1', { externalId: 'vid1' }); // the failed stream itself
    const exact = makeCandidate('vid2');
    mocks.search.mockResolvedValue(searchResult([unrelated, failedSource, exact]));
    mocks.resolve.mockImplementation((track: any) => Promise.resolve({
      kind: 'stream', track, streamUrl: `https://cdn/alt-${track.externalId}`, isLocalFile: false,
    }));

    const pending = findVerifiedReplacement(makeFailedSong());
    await flush();
    // Probe the candidate stream — it reaches canplay, so it is verified.
    expect(lastProbe().src).toBe('https://cdn/alt-vid2');
    lastProbe().dispatchEvent(new Event('canplay'));
    const result = await pending;

    expect(result.status).toBe('replaced');
    // Only the exact match was resolved — unrelated + failed source skipped.
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(mocks.resolve.mock.calls[0][0].externalId).toBe('vid2');
    // Metadata preserved from the FAILED song; only the source changed.
    const r = result.replacement!;
    expect(r.id).toBe('s1');
    expect(r.title).toBe('My Song');
    expect(r.artist).toBe('Alice');
    expect(r.album).toBe('Original Album');
    expect(r.coverArt).toBe('orig-art');
    expect(r.youtubeId).toBe('vid2');
    expect(r.audioUrl).toBe('https://cdn/alt-vid2');
    // The probe element was neutralized after verification.
    expect(lastProbe().src).toBe('');
  });

  it('unavailable: only similar-title candidates are never used', async () => {
    mocks.search.mockResolvedValue(searchResult([
      makeCandidate('u1', { artist: 'Bob' }),
      makeCandidate('u2', { title: 'My Song (Cover)', artist: 'Alice' }),
    ]));

    const result = await findVerifiedReplacement(makeFailedSong());

    expect(result.status).toBe('unavailable');
    expect(mocks.resolve).not.toHaveBeenCalled(); // nothing passed the identity filter
  });

  it('unavailable: empty search results', async () => {
    mocks.search.mockResolvedValue(searchResult([]));
    const result = await findVerifiedReplacement(makeFailedSong());
    expect(result.status).toBe('unavailable');
  });

  it('unavailable: search throws — reported as unavailable, never a crash', async () => {
    mocks.search.mockRejectedValue(new Error('network down'));
    const result = await findVerifiedReplacement(makeFailedSong());
    expect(result.status).toBe('unavailable');
  });

  it('unavailable: candidates exist but none resolve to a playable source', async () => {
    mocks.search.mockResolvedValue(searchResult([makeCandidate('vid2'), makeCandidate('vid3')]));
    mocks.resolve.mockResolvedValue(null);

    const result = await findVerifiedReplacement(makeFailedSong());

    expect(result.status).toBe('unavailable');
    expect(mocks.resolve).toHaveBeenCalledTimes(2); // bounded by MAX_CANDIDATE_ATTEMPTS
  });

  it('probe failure: skips the dead candidate and verifies the next one', async () => {
    mocks.search.mockResolvedValue(searchResult([makeCandidate('vid2'), makeCandidate('vid3')]));
    mocks.resolve.mockImplementation((track: any) => Promise.resolve({
      kind: 'stream', track, streamUrl: `https://cdn/alt-${track.externalId}`, isLocalFile: false,
    }));

    const pending = findVerifiedReplacement(makeFailedSong());
    await flush();
    expect(lastProbe().src).toBe('https://cdn/alt-vid2');
    lastProbe().dispatchEvent(new Event('error')); // first candidate does not play
    await flush();
    expect(lastProbe().src).toBe('https://cdn/alt-vid3');
    lastProbe().dispatchEvent(new Event('canplay')); // second one does
    const result = await pending;

    expect(result.status).toBe('replaced');
    expect(result.replacement!.youtubeId).toBe('vid3');
    expect(mocks.resolve).toHaveBeenCalledTimes(2);
  });

  it('never verifies more than the bounded number of candidates', async () => {
    mocks.search.mockResolvedValue(searchResult([
      makeCandidate('vid2'), makeCandidate('vid3'), makeCandidate('vid4'), makeCandidate('vid5'),
    ]));
    mocks.resolve.mockImplementation((track: any) => Promise.resolve({
      kind: 'stream', track, streamUrl: `https://cdn/alt-${track.externalId}`, isLocalFile: false,
    }));

    const pending = findVerifiedReplacement(makeFailedSong());
    await flush();
    lastProbe().dispatchEvent(new Event('error'));
    await flush();
    lastProbe().dispatchEvent(new Event('error'));
    const result = await pending;

    expect(result.status).toBe('unavailable');
    expect(mocks.resolve).toHaveBeenCalledTimes(2); // hard cap — not 4
  });

  it('timeout: a hung search is cut off by the total budget', async () => {
    mocks.search.mockImplementation(() => new Promise(() => {})); // never settles

    const pending = findVerifiedReplacement(makeFailedSong());
    await vi.advanceTimersByTimeAsync(15_000 + 100);
    const result = await pending;

    expect(result.status).toBe('timeout');
    // The search was handed an abort signal so the hung call is cancelled.
    expect(mocks.search.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('probe timeout: a candidate that never reaches canplay is rejected by budget', async () => {
    mocks.search.mockResolvedValue(searchResult([makeCandidate('vid2')]));
    mocks.resolve.mockImplementation((track: any) => Promise.resolve({
      kind: 'stream', track, streamUrl: 'https://cdn/hangs', isLocalFile: false,
    }));

    const pending = findVerifiedReplacement(makeFailedSong());
    await flush();
    expect(lastProbe().src).toBe('https://cdn/hangs');
    // The probe never fires canplay — its own timeout rejects it.
    await vi.advanceTimersByTimeAsync(5_000 + 100);
    const result = await pending;

    expect(result.status).toBe('unavailable');
  });
});
