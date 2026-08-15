/**
 * JioSaavn provider tests.
 *
 * Covers the provider against mocked /api/jiosaavn passthrough responses:
 *   - successful search / lookup / stream resolution
 *   - failure cases (HTTP errors, network failures, aborts)
 *   - malformed responses (non-JSON, wrong shapes, missing fields)
 *   - unavailable tracks (empty details, missing entries)
 *   - missing artwork / missing or malformed duration / missing year
 *   - stream-resolution failure (encrypted-only URLs are never decrypted)
 *
 * The YouTube provider's own tests are untouched and must keep passing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../config/api';
import { jiosaavnProvider } from './jiosaavnProvider';
import {
  playableToEngineParams,
  providerRegistry,
  resolveDownloadDescriptor,
  resolvePlayableSource,
  toSong,
  toTrack,
} from '../providers';
import type { Track } from './types';

vi.mock('../config/api', () => ({
  api: (path: string) => `https://app.test/api${path}`,
  apiFetch: vi.fn(),
}));

const mockedApiFetch = vi.mocked(apiFetch);

const JSN_ID = 'rjkrTnma';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockJson(body: unknown): void {
  mockedApiFetch.mockResolvedValue(jsonResponse(body));
}

/** A realistic search.getResults (api_version=4) item. */
const JSN_SEARCH_RESULT = {
  id: JSN_ID,
  title: 'Kesariya',
  subtitle: 'Pritam, Arijit Singh, Amitabh Bhattacharya - Brahmastra',
  type: 'song',
  perma_url: 'https://www.jiosaavn.com/song/kesariya/AgIAQyBeWlI',
  image: 'https://c.saavncdn.com/871/cover-150x150.jpg',
  language: 'hindi',
  year: '2022',
  duration: '268',
  play_count: '212370947',
  explicit_content: 0,
  more_info: {
    music: 'Pritam',
    album_id: '38845390',
    album: 'Brahmastra',
    label: 'Sony Music Entertainment India Pvt. Ltd.',
  },
};

const JSN_TRACK: Track = {
  id: 'jsn-' + JSN_ID,
  provider: 'jiosaavn',
  title: 'Kesariya',
  artist: 'Pritam, Arijit Singh, Amitabh Bhattacharya',
  album: 'Brahmastra',
  genre: 'Unknown',
  duration: 268,
  artwork: 'https://c.saavncdn.com/871/cover-500x500.jpg',
  releaseYear: 2022,
  externalId: JSN_ID,
};

const SEARCH_URL =
  'https://app.test/api/jiosaavn?__call=search.getResults&api_version=4&_format=json&q=kesariya';
const DETAILS_URL = (pids: string) =>
  `https://app.test/api/jiosaavn?__call=song.getDetails&api_version=2&_format=json&pids=${pids}`;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe('jiosaavnProvider.search', () => {
  it('returns normalized Tracks from a valid response', async () => {
    mockJson({ total: 1, start: 0, results: [JSN_SEARCH_RESULT] });
    const tracks = await jiosaavnProvider.search('kesariya');

    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      id: 'jsn-rjkrTnma',
      provider: 'jiosaavn',
      title: 'Kesariya',
      artist: 'Pritam, Arijit Singh, Amitabh Bhattacharya',
      album: 'Brahmastra',
      genre: 'Unknown',
      duration: 268,
      artwork: 'https://c.saavncdn.com/871/cover-500x500.jpg',
      releaseYear: 2022,
      externalId: 'rjkrTnma',
      playCount: 212370947,
    });
    expect(tracks[0].streamUrl).toBeUndefined();
    expect(tracks[0].metadata).toMatchObject({
      language: 'hindi',
      music: 'Pritam',
      albumId: '38845390',
      label: 'Sony Music Entertainment India Pvt. Ltd.',
      permaUrl: 'https://www.jiosaavn.com/song/kesariya/AgIAQyBeWlI',
    });
  });

  it('requests the server passthrough with the JioSaavn search call', async () => {
    mockJson({ results: [] });
    await jiosaavnProvider.search('kesariya');
    expect(mockedApiFetch.mock.calls[0][0]).toBe(SEARCH_URL);
  });

  it('URL-encodes the query', async () => {
    mockJson({ results: [] });
    await jiosaavnProvider.search('shape of you');
    expect(mockedApiFetch.mock.calls[0][0]).toContain('q=shape+of+you');
  });

  it('passes page and limit through to the upstream call', async () => {
    mockJson({ results: [] });
    await jiosaavnProvider.search('kesariya', { limit: 5, page: 2 });
    const url = String(mockedApiFetch.mock.calls[0][0]);
    expect(url).toContain('page=2');
    expect(url).toContain('n=5');
  });

  it('returns an empty list for a blank query without fetching', async () => {
    expect(await jiosaavnProvider.search('   ')).toEqual([]);
    expect(await jiosaavnProvider.search('')).toEqual([]);
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });

  it('returns an empty list when there are no results', async () => {
    mockJson({ total: 0, start: 0, results: [] });
    expect(await jiosaavnProvider.search('kesariya')).toEqual([]);
  });

  it('filters out non-song results', async () => {
    mockJson({
      results: [
        JSN_SEARCH_RESULT,
        { id: 'artist-1', title: 'Arijit Singh', subtitle: 'Arijit Singh', type: 'artist' },
        { id: 'album-1', title: 'Brahmastra', subtitle: 'Various Artists', type: 'album' },
      ],
    });
    const tracks = await jiosaavnProvider.search('kesariya');
    expect(tracks).toHaveLength(1);
    expect(tracks[0].externalId).toBe(JSN_ID);
  });

  it('skips results that lack an id or title', async () => {
    mockJson({
      results: [JSN_SEARCH_RESULT, { title: 'No id here' }, { id: 'no-title-here' }, 42, null],
    });
    const tracks = await jiosaavnProvider.search('kesariya');
    expect(tracks).toHaveLength(1);
  });

  it('returns an empty list for a malformed JSON body', async () => {
    mockedApiFetch.mockResolvedValue(new Response('{"total":', { status: 200 }));
    expect(await jiosaavnProvider.search('kesariya')).toEqual([]);
  });

  it('returns an empty list for a non-JSON body', async () => {
    mockedApiFetch.mockResolvedValue(new Response('<html>captcha</html>', { status: 200 }));
    expect(await jiosaavnProvider.search('kesariya')).toEqual([]);
  });

  it('returns an empty list when the response shape is unexpected', async () => {
    mockJson([JSN_SEARCH_RESULT]);
    expect(await jiosaavnProvider.search('kesariya')).toEqual([]);
    vi.clearAllMocks();
    mockJson({ error: { code: 'INPUT_MISSING', msg: 'bad' } });
    expect(await jiosaavnProvider.search('kesariya')).toEqual([]);
  });

  it('returns an empty list when the backend request fails', async () => {
    mockedApiFetch.mockRejectedValue(new Error('Network down'));
    expect(await jiosaavnProvider.search('kesariya')).toEqual([]);
  });

  it('returns an empty list when the HTTP status is an error', async () => {
    mockedApiFetch.mockRejectedValue(Object.assign(new Error('HTTP 502'), { name: 'ApiError' }));
    expect(await jiosaavnProvider.search('kesariya')).toEqual([]);
  });

  it('returns an empty list for aborted requests', async () => {
    mockedApiFetch.mockRejectedValue(new DOMException('The user aborted a request.', 'AbortError'));
    const controller = new AbortController();
    controller.abort();
    expect(await jiosaavnProvider.search('kesariya', { signal: controller.signal })).toEqual([]);
  });

  it('defaults missing artwork to an empty string', async () => {
    mockJson({
      results: [{ ...JSN_SEARCH_RESULT, image: undefined }],
    });
    const tracks = await jiosaavnProvider.search('kesariya');
    expect(tracks[0].artwork).toBe('');
  });

  it('defaults missing or malformed duration to 0', async () => {
    mockJson({
      results: [
        { ...JSN_SEARCH_RESULT, id: 'abc123', duration: undefined },
        { ...JSN_SEARCH_RESULT, id: 'def456', duration: 'not-a-number' },
        { ...JSN_SEARCH_RESULT, id: 'ghi789', duration: '-5' },
      ],
    });
    const tracks = await jiosaavnProvider.search('kesariya');
    expect(tracks.map(t => t.duration)).toEqual([0, 0, 0]);
  });

  it('leaves releaseYear undefined when the year is missing or invalid', async () => {
    mockJson({
      results: [
        { ...JSN_SEARCH_RESULT, id: 'abc123', year: undefined },
        { ...JSN_SEARCH_RESULT, id: 'def456', year: 'N/A' },
      ],
    });
    const tracks = await jiosaavnProvider.search('kesariya');
    expect(tracks.map(t => t.releaseYear)).toEqual([undefined, undefined]);
  });

  it('maps a single-segment subtitle entirely to the artist', async () => {
    mockJson({
      results: [{ ...JSN_SEARCH_RESULT, id: 'abc123', subtitle: 'Arijit Singh' }],
    });
    const tracks = await jiosaavnProvider.search('kesariya');
    expect(tracks[0].artist).toBe('Arijit Singh');
    expect(tracks[0].album).toBe('Brahmastra');
  });

  it('decodes HTML entities in title, artist, and album', async () => {
    mockJson({
      results: [{
        ...JSN_SEARCH_RESULT,
        id: 'abc123',
        title: 'Main &quot;Title&quot; Song &amp; More',
        subtitle: 'Singer A &amp; Singer B - Rockstar &#039;20&#039;',
        more_info: { album: 'Album &lt;Deluxe&gt;' },
      }],
    });
    const tracks = await jiosaavnProvider.search('kesariya');
    expect(tracks[0].title).toBe('Main "Title" Song & More');
    expect(tracks[0].artist).toBe('Singer A & Singer B');
    expect(tracks[0].album).toBe("Album <Deluxe>");
  });

  it('decodes numeric and hex character references', async () => {
    mockJson({
      results: [{ ...JSN_SEARCH_RESULT, id: 'abc123', title: 'Song &#8211; Remix &#x26; Edit' }],
    });
    const tracks = await jiosaavnProvider.search('kesariya');
    expect(tracks[0].title).toBe('Song \u2013 Remix & Edit');
  });

  it('leaves unknown entities untouched instead of corrupting them', async () => {
    mockJson({
      results: [{ ...JSN_SEARCH_RESULT, id: 'abc123', title: 'Song &unknownentity; Here' }],
    });
    const tracks = await jiosaavnProvider.search('kesariya');
    expect(tracks[0].title).toBe('Song &unknownentity; Here');
  });

  it('skips results with an empty id or a whitespace-only title', async () => {
    mockJson({
      results: [
        { ...JSN_SEARCH_RESULT, id: '' },
        { ...JSN_SEARCH_RESULT, id: 'abc123', title: '   ' },
      ],
    });
    expect(await jiosaavnProvider.search('kesariya')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getTrack (lookup / metadata)
// ---------------------------------------------------------------------------

describe('jiosaavnProvider.getTrack', () => {
  it('merges fresher details onto the track', async () => {
    mockJson({
      [JSN_ID]: {
        song: 'Kesariya (From Brahmastra)',
        album: 'Brahmastra',
        year: '2022',
        duration: '268',
        image: 'https://c.saavncdn.com/871/detail-150x150.jpg',
        language: 'hindi',
        label: 'Sony Music Entertainment India Pvt. Ltd.',
        singers: 'Pritam, Arijit Singh, Amitabh Bhattacharya',
        music: 'Pritam',
        play_count: '212370947',
        perma_url: 'https://www.jiosaavn.com/song/kesariya/AgIAQyBeWlI',
        release_date: '2022-07-17',
        has_lyrics: 'true',
        is_drm: false,
        rights: { code: '1' },
      },
    });

    const fresher = await jiosaavnProvider.getTrack(JSN_TRACK);

    expect(fresher).toMatchObject({
      id: 'jsn-rjkrTnma',
      provider: 'jiosaavn',
      title: 'Kesariya (From Brahmastra)',
      album: 'Brahmastra',
      duration: 268,
      artwork: 'https://c.saavncdn.com/871/detail-500x500.jpg',
      releaseYear: 2022,
      playCount: 212370947,
    });
    expect(fresher.metadata).toMatchObject({
      singers: 'Pritam, Arijit Singh, Amitabh Bhattacharya',
      music: 'Pritam',
      label: 'Sony Music Entertainment India Pvt. Ltd.',
      language: 'hindi',
      releaseDate: '2022-07-17',
      permaUrl: 'https://www.jiosaavn.com/song/kesariya/AgIAQyBeWlI',
      hasLyrics: 'true',
      isDrm: false,
      rightsCode: '1',
    });
  });

  it('requests song details with the track id as pids', async () => {
    mockJson({});
    await jiosaavnProvider.getTrack(JSN_TRACK);
    expect(mockedApiFetch.mock.calls[0][0]).toBe(DETAILS_URL(JSN_ID));
  });

  it('returns the input unchanged when the song is unavailable', async () => {
    mockJson({});
    const out = await jiosaavnProvider.getTrack(JSN_TRACK);
    expect(out).toBe(JSN_TRACK);
  });

  it('returns the input unchanged for a malformed details body', async () => {
    mockedApiFetch.mockResolvedValue(new Response('not json at all', { status: 200 }));
    expect(await jiosaavnProvider.getTrack(JSN_TRACK)).toBe(JSN_TRACK);
  });

  it('returns the input unchanged when the details request fails', async () => {
    mockedApiFetch.mockRejectedValue(new Error('Network down'));
    expect(await jiosaavnProvider.getTrack(JSN_TRACK)).toBe(JSN_TRACK);
  });

  it('does not fetch when the track has no external id', async () => {
    const noExternal = toTrack({ ...JSN_TRACK, externalId: undefined });
    expect(await jiosaavnProvider.getTrack(noExternal)).toBe(noExternal);
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });

  it('decodes entities in detail titles and ignores malformed entries', async () => {
    mockJson({
      [JSN_ID]: { song: 'Kesariya &quot;Lofi&quot;', album: 'Brahmastra &#038; Beyond' },
    });
    const fresher = await jiosaavnProvider.getTrack(JSN_TRACK);
    expect(fresher.title).toBe('Kesariya "Lofi"');
    expect(fresher.album).toBe('Brahmastra & Beyond');

    vi.clearAllMocks();
    // Entry present but not an object — input comes back unchanged.
    mockJson({ [JSN_ID]: 'corrupted-entry' });
    expect(await jiosaavnProvider.getTrack(JSN_TRACK)).toBe(JSN_TRACK);
  });

  it('keeps existing fields when details carry junk values', async () => {
    mockJson({
      [JSN_ID]: {
        song: '',
        album: null,
        year: 'unknown',
        duration: 'NaN',
        image: 42,
        play_count: 'not-a-count',
      },
    });
    const fresher = await jiosaavnProvider.getTrack(JSN_TRACK);
    expect(fresher.title).toBe('Kesariya');
    expect(fresher.album).toBe('Brahmastra');
    expect(fresher.releaseYear).toBe(2022);
    expect(fresher.duration).toBe(268);
    expect(fresher.artwork).toBe('https://c.saavncdn.com/871/cover-500x500.jpg');
    expect(fresher.playCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resolveStream
// ---------------------------------------------------------------------------

describe('jiosaavnProvider.resolveStream', () => {
  it('resolves a direct media_url as a full stream', async () => {
    mockJson({
      [JSN_ID]: {
        media_url: 'https://aac.saavncdn.com/871/song.mp4',
        encrypted_media_url: 'ENCRYPTED-PAYLOAD',
      },
    });
    const playable = await jiosaavnProvider.resolveStream(JSN_TRACK);
    expect(playable).not.toBeNull();
    expect(playable).toMatchObject({
      kind: 'stream',
      streamUrl: 'https://aac.saavncdn.com/871/song.mp4',
      isLocalFile: false,
    });
    if (playable?.kind === 'stream') {
      expect(playable.isPreview).toBeUndefined();
    } else {
      expect.unreachable('expected a stream source');
    }
  });

  it('falls back to the official preview URL, flagged isPreview, when the full audio is encrypted', async () => {
    mockJson({
      [JSN_ID]: {
        encrypted_media_url: 'ENCRYPTED-PAYLOAD',
        media_preview_url: 'https://preview.saavncdn.com/871/preview_p.mp4',
      },
    });
    const playable = await jiosaavnProvider.resolveStream(JSN_TRACK);
    expect(playable).toMatchObject({
      kind: 'stream',
      streamUrl: 'https://preview.saavncdn.com/871/preview_p.mp4',
      isLocalFile: false,
      isPreview: true,
    });
  });

  it('returns null when the full audio is encrypted and no preview exists', async () => {
    mockJson({ [JSN_ID]: { encrypted_media_url: 'ENCRYPTED-PAYLOAD' } });
    expect(await jiosaavnProvider.resolveStream(JSN_TRACK)).toBeNull();
  });

  it('returns null when media_url is present but not an http(s) URL', async () => {
    mockJson({ [JSN_ID]: { media_url: 'ID2ieOjCrwfgWvL5sXl4B1ImC5QfbsDy' } });
    expect(await jiosaavnProvider.resolveStream(JSN_TRACK)).toBeNull();
  });

  it('returns null when only a non-http preview URL exists', async () => {
    mockJson({ [JSN_ID]: { media_preview_url: 'ENCRYPTED-PREVIEW-BLOB' } });
    expect(await jiosaavnProvider.resolveStream(JSN_TRACK)).toBeNull();
  });

  it('returns null when details are unavailable for the track', async () => {
    mockJson({});
    expect(await jiosaavnProvider.resolveStream(JSN_TRACK)).toBeNull();
    vi.clearAllMocks();
    mockJson({ some_other_song: { media_url: 'https://aac.saavncdn.com/other.mp4' } });
    expect(await jiosaavnProvider.resolveStream(JSN_TRACK)).toBeNull();
  });

  it('returns null when the details request fails', async () => {
    mockedApiFetch.mockRejectedValue(new Error('Network down'));
    expect(await jiosaavnProvider.resolveStream(JSN_TRACK)).toBeNull();
  });

  it('returns null without fetching for tracks without an external id', async () => {
    const noExternal = toTrack({ ...JSN_TRACK, externalId: undefined });
    expect(await jiosaavnProvider.resolveStream(noExternal)).toBeNull();
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });

  it('bypasses the response cache for forced re-resolves', async () => {
    mockJson({ [JSN_ID]: { media_preview_url: 'https://preview.saavncdn.com/871/p.mp4' } });
    await jiosaavnProvider.resolveStream(JSN_TRACK, { force: true });
    expect(mockedApiFetch.mock.calls[0][1]?.cacheTTL).toBe(0);

    vi.clearAllMocks();
    mockJson({ [JSN_ID]: { media_preview_url: 'https://preview.saavncdn.com/871/p.mp4' } });
    await jiosaavnProvider.resolveStream(JSN_TRACK);
    expect(mockedApiFetch.mock.calls[0][1]?.cacheTTL).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Provider integration (registry + resolution + normalization boundary)
// ---------------------------------------------------------------------------

describe('JioSaavn provider integration', () => {
  it('is registered by the barrel and plays through the shared resolution path', async () => {
    expect(providerRegistry.has('jiosaavn')).toBe(true);
    expect(providerRegistry.get('jiosaavn')).toBe(jiosaavnProvider);
    expect(jiosaavnProvider.capabilities).toEqual({
      search: true,
      trackLookup: true,
      lyrics: false,
      charts: false,
      relatedTracks: false,
      downloads: false,
    });

    mockJson({
      [JSN_ID]: {
        encrypted_media_url: 'ENCRYPTED-PAYLOAD',
        media_preview_url: 'https://preview.saavncdn.com/871/preview_p.mp4',
      },
    });
    const playable = await resolvePlayableSource(JSN_TRACK);
    expect(playable?.kind).toBe('stream');
    if (playable?.kind === 'stream') {
      expect(playable.isPreview).toBe(true);
      // The engine needs exactly the same params as any other provider.
      expect(playableToEngineParams(playable)).toEqual({
        mode: 'html',
        src: 'https://preview.saavncdn.com/871/preview_p.mp4',
        isLocalFile: false,
        expiresInMs: undefined,
      });
    }
  });

  it('leaves downloads unsupported rather than faking a download path', async () => {
    expect(await resolveDownloadDescriptor(JSN_TRACK)).toBeNull();
  });

  it('never maps a JioSaavn external id to a youtubeId at the Song boundary', async () => {
    const song = toSong(JSN_TRACK);
    expect(song.youtubeId).toBeUndefined();
    expect(song.title).toBe('Kesariya');
    expect(song.id).toBe('jsn-rjkrTnma');
  });

  it('is idempotent through toTrack, preserving provider metadata', async () => {
    expect(toTrack(JSN_TRACK)).toEqual(JSN_TRACK);
  });

  it('lazily re-registers the provider when a downstream consumer resolves a JioSaavn track', async () => {
    providerRegistry.unregister('jiosaavn');
    try {
      mockJson({
        [JSN_ID]: {
          encrypted_media_url: 'ENCRYPTED-PAYLOAD',
          media_preview_url: 'https://preview.saavncdn.com/871/preview_p.mp4',
        },
      });
      const playable = await resolvePlayableSource(JSN_TRACK);
      expect(playable?.kind).toBe('stream');
      if (playable?.kind === 'stream') {
        expect(playable.streamUrl).toBe('https://preview.saavncdn.com/871/preview_p.mp4');
      }
      expect(providerRegistry.has('jiosaavn')).toBe(true);
    } finally {
      if (!providerRegistry.has('jiosaavn')) providerRegistry.register(jiosaavnProvider);
    }
  });
});