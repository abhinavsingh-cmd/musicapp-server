/**
 * YouTube music provider.
 *
 * Wraps the existing YouTube implementations behind the TrackProvider
 * contract:
 *   - search            -> youtubeSearchService (server yt-dlp search,
 *                          Invidious fallback)
 *   - stream resolution -> youtubeAudioExtractor (server audio-info +
 *                          proxy, Invidious fallback)
 *   - embedded playback -> YouTube IFrame (when no direct stream exists)
 *   - charts            -> trendingService (server trending.json + builtin)
 *   - lyrics            -> lyricsService (LRCLib etc.)
 *   - downloads         -> server /api/download/{videoId} endpoint
 *
 * No behavior is changed here — existing implementations are reused as-is;
 * only the outward shape is normalized.
 */

import { api } from '../config/api';
import { lyricsService } from '../services/lyricsService';
import { trendingService } from '../services/trendingService';
import { youtubeSearch } from '../services/youtubeSearchService';
import { extractAudioUrl, invalidateAudioUrl } from '../services/youtubeAudioExtractor';
import { YTSong } from '../stores/searchStore';
import { toTrack } from './adapters';
import {
  DownloadDescriptor,
  PlayableSource,
  ProviderCapabilities,
  ResolveStreamOptions,
  SearchOptions,
  Track,
  TrackProvider,
} from './types';

const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const STREAM_TTL_MS = 25 * 60 * 1000;

const CAPABILITIES: ProviderCapabilities = {
  search: true,
  trackLookup: false,
  lyrics: true,
  charts: true,
  relatedTracks: false,
  downloads: true,
};

function isValidYoutubeId(id: string | undefined): id is string {
  return typeof id === 'string' && YT_ID_RE.test(id);
}

function ytSongToTrack(r: YTSong): Track {
  return {
    id: 'yt-' + r.id,
    provider: 'youtube',
    title: r.title || 'Unknown',
    artist: r.artist || 'Unknown',
    album: r.album || '',
    genre: 'YouTube',
    duration: r.duration || 0,
    artwork: r.thumbnail || '',
    externalId: r.id,
    playCount: r.viewCount || 0,
  };
}

class YouTubeProvider implements TrackProvider {
  readonly id = 'youtube' as const;
  readonly name = 'YouTube';
  readonly capabilities = CAPABILITIES;

  async search(query: string, options?: SearchOptions): Promise<Track[]> {
    if (!query.trim()) return [];
    const results = await youtubeSearch(query, options?.signal);
    const limited = options?.limit ? results.slice(0, options.limit) : results;
    return limited.filter(r => r && r.id).map(ytSongToTrack);
  }

  /**
   * YouTube tracks embed their metadata at search time; there is no
   * single-video metadata endpoint on the server, so lookup returns the
   * track unchanged.
   */
  async getTrack(track: Track): Promise<Track> {
    return track;
  }

  async resolveStream(
    track: Track,
    options?: ResolveStreamOptions,
  ): Promise<PlayableSource | null> {
    if (!isValidYoutubeId(track.externalId)) return null;

    if (options?.force) {
      invalidateAudioUrl(track.externalId);
    }

    const url = await extractAudioUrl(track.externalId);
    if (url) {
      return {
        kind: 'stream',
        track,
        streamUrl: url,
        isLocalFile: false,
        expiresInMs: STREAM_TTL_MS,
      };
    }

    // No direct stream available — offer the embedded IFrame path instead.
    return {
      kind: 'iframe',
      track,
      videoId: track.externalId,
    };
  }

  async resolveDownload(track: Track): Promise<DownloadDescriptor | null> {
    if (!isValidYoutubeId(track.externalId)) return null;
    return {
      url: api(`/download/${track.externalId}?title=${encodeURIComponent(track.title)}`),
      fileName: `${track.title || 'track'}.m4a`,
    };
  }

  async getCharts(options?: SearchOptions): Promise<Track[]> {
    const result = await trendingService.getTrending();
    const songs = options?.limit ? result.songs.slice(0, options.limit) : result.songs;
    return songs.map(s => toTrack(s)).map(t => ({
      ...t,
      provider: 'youtube' as const,
    }));
  }

  async getLyrics(track: Track): Promise<string | null> {
    const lines = await lyricsService.fetchLyrics(track.title, track.artist);
    if (lines.length === 0) return null;
    return lines.map(l => l.text).join('\n');
  }

  invalidateStream(track: Track): void {
    if (track.externalId) invalidateAudioUrl(track.externalId);
  }
}

export const youtubeProvider: TrackProvider = new YouTubeProvider();
