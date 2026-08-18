import { vi, describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Unified music-source abstraction tests — canonical keying, download-state
// merging, playable-URI resolution, and LOCAL/ONLINE PARITY (a downloaded
// library song must behave exactly like a downloaded YouTube song).
// ---------------------------------------------------------------------------
const dl = vi.hoisted(() => ({
  getBlobUrl: vi.fn((_key: string): string | null => null),
  isDownloaded: vi.fn((_key: string) => false),
  isDownloading: vi.fn((_key: string) => false),
  failedDownloads: [] as Array<{ song: any; message: string }>,
}));

vi.mock('../stores/downloadsStore', () => ({
  useDownloadsStore: { getState: () => dl },
}));

import {
  sourceKey,
  sourceTypeOf,
  isDownloadable,
  downloadKey,
  downloadStateOf,
  isDownloadedSong,
  resolvePlayableSong,
  stripStaleBlobUrl,
  ensureYouTubeArtwork,
  toMusicSource,
  buildShareUrl,
  downloadEntryToSong,
} from './musicSource';
import { favoriteKey } from '../utils/songIds';
import type { Song } from '../types/music';

function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    id: 'row-1',
    title: 'My Song',
    artist: 'Alice',
    album: 'Album',
    duration: 200,
    genre: 'Pop',
    coverArt: 'art',
    audioUrl: '',
    youtubeId: 'vid1',
    provider: 'youtube',
    releaseYear: 2020,
    ...overrides,
  } as Song;
}

beforeEach(() => {
  dl.getBlobUrl.mockReset().mockReturnValue(null);
  dl.isDownloaded.mockReset().mockReturnValue(false);
  dl.isDownloading.mockReset().mockReturnValue(false);
  dl.failedDownloads = [];
});

describe('canonical source keying', () => {
  it('prefers the provider-scoped id and falls back to the row id', () => {
    expect(sourceKey(makeSong())).toBe('vid1');
    expect(sourceKey(makeSong({ youtubeId: undefined }))).toBe('row-1');
  });

  it('favoriteKey is the same derivation (one implementation)', () => {
    const s = makeSong();
    expect(favoriteKey(s)).toBe(sourceKey(s));
  });

  it('download entries are keyed identically to songs — including library entries', () => {
    expect(downloadKey({ id: 'e1', youtubeId: 'vid1' })).toBe('vid1');
    // A LIBRARY download carries no youtubeId — its key is the entry id,
    // which is exactly sourceKey of the song that started the download.
    expect(downloadKey({ id: 'lib-9', youtubeId: undefined })).toBe('lib-9');
  });
});

describe('sourceTypeOf / isDownloadable', () => {
  it('explicit provider wins, then structural inference', () => {
    expect(sourceTypeOf(makeSong())).toBe('youtube');
    expect(sourceTypeOf(makeSong({ provider: 'library', youtubeId: undefined }))).toBe('library');
    expect(sourceTypeOf(makeSong({ provider: undefined, youtubeId: undefined }))).toBe('library');
    expect(sourceTypeOf(makeSong({ provider: undefined, youtubeId: 'abcdefghijk' }))).toBe('youtube');
  });

  it('downloadable when a backend can produce audio (youtube id or direct URL)', () => {
    expect(isDownloadable(makeSong())).toBe(true);
    expect(isDownloadable(makeSong({ youtubeId: undefined, audioUrl: 'https://lib/stream' }))).toBe(true);
    expect(isDownloadable(makeSong({ youtubeId: undefined, audioUrl: '' }))).toBe(false);
  });
});

describe('download state merging', () => {
  it('reports downloaded / downloading / failed / none', () => {
    const s = makeSong();
    expect(downloadStateOf(s)).toBe('none');

    dl.isDownloading.mockReturnValue(true);
    expect(downloadStateOf(s)).toBe('downloading');

    dl.isDownloaded.mockReturnValue(true);
    expect(downloadStateOf(s)).toBe('downloaded');

    dl.isDownloaded.mockReturnValue(false);
    dl.isDownloading.mockReturnValue(false);
    dl.failedDownloads = [{ song: s, message: 'boom' }];
    expect(downloadStateOf(s)).toBe('failed');
  });

  it('isDownloadedSong delegates through the canonical key', () => {
    dl.isDownloaded.mockImplementation((k: string) => k === 'vid1');
    expect(isDownloadedSong(makeSong())).toBe(true);
    expect(isDownloadedSong(makeSong({ youtubeId: 'other' }))).toBe(false);
    expect(dl.isDownloaded).toHaveBeenCalledWith('vid1');
  });
});

describe('resolvePlayableSong — local/online parity', () => {
  it('downloaded song plays from its local blob (no network URL)', () => {
    dl.getBlobUrl.mockImplementation((k: string) => (k === 'vid1' ? 'blob:local-1' : null));
    const out = resolvePlayableSong(makeSong({ audioUrl: 'https://remote/stream' }));
    expect(out.audioUrl).toBe('blob:local-1');
  });

  it('stale blob: URL without a backing download is dropped', () => {
    const out = resolvePlayableSong(makeSong({ audioUrl: 'blob:dead' }));
    expect(out.audioUrl).toBe('');
  });

  it('online song with no download passes through unchanged', () => {
    const song = makeSong({ audioUrl: 'https://remote/stream' });
    expect(resolvePlayableSong(song)).toBe(song); // same reference — untouched
  });

  it('PARITY: a downloaded LIBRARY song (no youtubeId) resolves locally too', () => {
    dl.getBlobUrl.mockImplementation((k: string) => (k === 'lib-9' ? 'blob:lib-9' : null));
    const lib = makeSong({ id: 'lib-9', youtubeId: undefined, provider: 'library', audioUrl: 'https://lib/stream' });
    expect(resolvePlayableSong(lib).audioUrl).toBe('blob:lib-9');
  });

  it('stripStaleBlobUrl only touches dead blob URLs', () => {
    expect(stripStaleBlobUrl(makeSong({ audioUrl: 'blob:x' })).audioUrl).toBe('');
    const remote = makeSong({ audioUrl: 'https://x' });
    expect(stripStaleBlobUrl(remote)).toBe(remote);
  });
});

describe('toMusicSource — unified view', () => {
  it('maps metadata, source identity, local URI, and download state', () => {
    dl.getBlobUrl.mockReturnValue('blob:local-1');
    dl.isDownloaded.mockReturnValue(true);
    const src = toMusicSource(makeSong());
    expect(src).toEqual({
      sourceType: 'youtube',
      sourceId: 'vid1',
      title: 'My Song',
      artist: 'Alice',
      album: 'Album',
      artwork: 'art',
      durationSec: 200,
      playableUri: 'blob:local-1',
      downloadState: 'downloaded',
    });
  });

  it('online song exposes its direct URL as the playable URI', () => {
    const src = toMusicSource(makeSong({ audioUrl: 'https://remote/stream' }));
    expect(src.playableUri).toBe('https://remote/stream');
    expect(src.downloadState).toBe('none');
  });

  it('a dead blob: URL is never reported as playable', () => {
    const src = toMusicSource(makeSong({ audioUrl: 'blob:dead' }));
    expect(src.playableUri).toBeNull();
  });

  it('PARITY: downloaded library song is indistinguishable in shape from downloaded youtube song', () => {
    dl.getBlobUrl.mockImplementation((k: string) => (k === 'lib-9' ? 'blob:lib' : null));
    dl.isDownloaded.mockReturnValue(true);
    const lib = toMusicSource(makeSong({ id: 'lib-9', youtubeId: undefined, provider: 'library' }));
    const yt = toMusicSource(makeSong());
    expect(lib.downloadState).toBe(yt.downloadState);
    expect(lib.playableUri?.startsWith('blob:')).toBe(true);
    expect(lib.sourceType).toBe('library');
    expect(lib.sourceId).toBe('lib-9');
  });
});

describe('ensureYouTubeArtwork', () => {
  it('synthesizes a YouTube thumbnail when coverArt is empty and youtubeId is valid', () => {
    const song = makeSong({ coverArt: '', youtubeId: 'dQw4w9WgXcQ' });
    const result = ensureYouTubeArtwork(song);
    expect(result.coverArt).toBe('https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg');
  });

  it('preserves existing coverArt — never overwrites a real thumbnail', () => {
    const song = makeSong({ coverArt: 'https://cdn.example.com/art.jpg', youtubeId: 'dQw4w9WgXcQ' });
    const result = ensureYouTubeArtwork(song);
    expect(result.coverArt).toBe('https://cdn.example.com/art.jpg');
  });

  it('returns song unchanged when both coverArt and youtubeId are missing', () => {
    const song = makeSong({ coverArt: '', youtubeId: undefined });
    const result = ensureYouTubeArtwork(song);
    expect(result.coverArt).toBe('');
  });

  it('returns song unchanged when youtubeId is not a valid 11-char YouTube id', () => {
    const song = makeSong({ coverArt: '', youtubeId: 'short' });
    const result = ensureYouTubeArtwork(song);
    expect(result.coverArt).toBe('');
  });

  it('handles youtubeId with underscores and hyphens correctly', () => {
    const song = makeSong({ coverArt: '', youtubeId: 'a-b_Cd12345' });
    const result = ensureYouTubeArtwork(song);
    expect(result.coverArt).toBe('https://img.youtube.com/vi/a-b_Cd12345/mqdefault.jpg');
  });

  it('does not block or mutate the original song object', () => {
    const original = makeSong({ coverArt: '', youtubeId: 'dQw4w9WgXcQ' });
    const result = ensureYouTubeArtwork(original);
    expect(original.coverArt).toBe(''); // original untouched
    expect(result).not.toBe(result === original ? original : null); // new object returned
  });
});

describe('buildShareUrl / downloadEntryToSong', () => {
  it('youtube songs share the video URL; others share the app URL', () => {
    expect(buildShareUrl(makeSong())).toBe('https://youtube.com/watch?v=vid1');
    expect(buildShareUrl(makeSong({ youtubeId: undefined }))).toBe(window.location.href);
  });

  it('download entries convert to playable Songs with safe defaults', () => {
    const song = downloadEntryToSong({ id: 'e1', youtubeId: 'vid1', title: 'T', artist: 'A', audioUrl: 'blob:x' });
    expect(song).toMatchObject({ id: 'e1', youtubeId: 'vid1', title: 'T', artist: 'A', audioUrl: 'blob:x' });
    const sparse = downloadEntryToSong({ id: 'e2' });
    expect(sparse).toMatchObject({ id: 'e2', youtubeId: undefined, title: 'Unknown', artist: 'Unknown' });
  });
});
