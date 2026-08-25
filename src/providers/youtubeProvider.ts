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
import { extractAudioUrl, invalidateAudioUrl, getStreamFallbackUrl } from '../services/youtubeAudioExtractor';
import { YTSong } from '../stores/searchStore';
import { toTrack } from './adapters';
import {
  DownloadDescriptor,
  PlayableSource,
  ProviderCapabilities,
  SearchOptions,
  ResolveStreamOptions,
  Track,
  TrackProvider,
} from './types';

const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const STREAM_TTL_MS = 25 * 60 * 1000;

// --- YouTube-owned network warmup (idempotent, injected once) ---
// Every warmup the app used to do for YouTube lives here: preconnecting the
// video/thumbnail CDNs and prefetching the IFrame API script. The generic
// engine and preload service call `provider.preconnect?.()` without knowing
// which provider they are warming.
let preconnectDone = false;

function preconnectYouTubeDomains(): void {
  if (preconnectDone || typeof document === 'undefined') return;
  preconnectDone = true;
  const domains = [
    'https://www.youtube.com',
    'https://i.ytimg.com',
    'https://s.ytimg.com',
    'https://www.google.com',
  ];
  for (const href of domains) {
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = href;
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  }
  // Also prefetch the YouTube IFrame API script
  const prefetch = document.createElement('link');
  prefetch.rel = 'preload';
  prefetch.as = 'script';
  prefetch.href = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(prefetch);
}

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

    // Keep a valid direct googlevideo URL across plays. Re-extracting on every
    // tap was the main source of startup latency. The direct URL is consumed by
    // native MediaPlayer on Android and starts immediately; /stream remains a
    // resilient server-piped fallback when extraction is unavailable.
    if (options?.force) invalidateAudioUrl(track.externalId);
    if (!options?.force) {
      const direct = await extractAudioUrl(track.externalId);
      if (direct) {
        // Proxy via server so the browser doesn't hit IP-locked googlevideo CDN.
        // The server's /proxy-audio fetches with its own IP and pipes to client.
        const proxyUrl = api(`/proxy-audio?url=${encodeURIComponent(direct)}&videoId=${track.externalId}`);
        return {
          kind: 'stream',
          track,
          streamUrl: proxyUrl,
          isLocalFile: false,
          expiresInMs: STREAM_TTL_MS,
        };
      }
    }

    return {
      kind: 'stream',
      track,
      streamUrl: getStreamFallbackUrl(track.externalId!),
      isLocalFile: false,
      expiresInMs: STREAM_TTL_MS,
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

  preconnect(): void {
    preconnectYouTubeDomains();
  }
}

export const youtubeProvider: TrackProvider = new YouTubeProvider();
