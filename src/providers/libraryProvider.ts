/**
 * Library music provider.
 *
 * Backs the app's server-hosted catalog plus local/permanent audio sources
 * (library songs with direct audio URLs, downloaded blob URLs). Tracks from
 * this provider carry their audio URL directly (`streamUrl`), so stream
 * resolution is a pass-through.
 *
 *   - search       -> musicApi.searchSongs (server /api/songs catalog)
 *   - track lookup -> musicApi.fetchSongs catalog by id
 *   - lyrics       -> lyricsService (LRCLib etc.)
 *   - related      -> recommendationService (library-based similarity)
 *   - downloads    -> direct streamUrl (permanent file URLs)
 */

import { fetchSongs, searchSongs } from '../services/musicApi';
import { lyricsService } from '../services/lyricsService';
import { toSong, toTrack } from './adapters';
import {
  DownloadDescriptor,
  PlayableSource,
  ProviderCapabilities,
  SearchOptions,
  Track,
  TrackProvider,
} from './types';

const CAPABILITIES: ProviderCapabilities = {
  search: true,
  trackLookup: true,
  lyrics: true,
  charts: false,
  relatedTracks: true,
  downloads: true,
};

class LibraryProvider implements TrackProvider {
  readonly id = 'library' as const;
  readonly name = 'Library';
  readonly capabilities = CAPABILITIES;

  async search(query: string, options?: SearchOptions): Promise<Track[]> {
    const songs = await searchSongs(query);
    const limited = options?.limit ? songs.slice(0, options.limit) : songs;
    return limited.map(s => toTrack(s));
  }

  async getTrack(track: Track): Promise<Track> {
    try {
      const catalog = await fetchSongs();
      const match = catalog.find(s => s.id === track.id || s.id === track.externalId);
      if (match) {
        return {
          ...toTrack(match),
          id: track.id,
          streamUrl: track.streamUrl, // keep any local/downloaded URL
        };
      }
    } catch {
      // Catalog unavailable — return the input unchanged.
    }
    return track;
  }

  /**
   * Library tracks carry their audio URL directly on the track
   * (`streamUrl`); there is nothing to resolve on demand.
   */
  async resolveStream(track: Track): Promise<PlayableSource | null> {
    if (!track.streamUrl) return null;
    const isLocalFile =
      track.streamUrl.startsWith('blob:') ||
      track.streamUrl.startsWith('file:') ||
      track.streamUrl.startsWith('data:');
    return {
      kind: 'stream',
      track,
      streamUrl: track.streamUrl,
      isLocalFile,
    };
  }

  async resolveDownload(track: Track): Promise<DownloadDescriptor | null> {
    if (!track.streamUrl) return null;
    return {
      url: track.streamUrl,
      fileName: `${track.title || 'track'}.mp3`,
    };
  }

  async getLyrics(track: Track): Promise<string | null> {
    const lines = await lyricsService.fetchLyrics(track.title, track.artist);
    if (lines.length === 0) return null;
    return lines.map(l => l.text).join('\n');
  }

  async getRelated(track: Track, limit = 10): Promise<Track[]> {
    const { getRecommendations } = await import('../services/recommendationService');
    const songs = await getRecommendations({
      seedSong: toSong(track),
      limit,
      excludeIds: new Set([track.id, track.externalId || '']),
    });
    return songs.map(s => toTrack(s));
  }
}

export const libraryProvider: TrackProvider = new LibraryProvider();
