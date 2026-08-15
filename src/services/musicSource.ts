/**
 * Unified music-source abstraction.
 *
 * The ONE place that knows how YouTube, library, and locally downloaded
 * songs differ — and how they are the same. UI components, pages, and
 * stores consume the helpers/types below instead of branching on
 * `youtubeId`, `blob:` URLs, or provider fields themselves, so a
 * downloaded song and an online song behave identically everywhere.
 *
 *   MusicSource        – normalized view of any playable item: source type,
 *                        source id, metadata, playable URI, download state.
 *   sourceKey/downloadKey – canonical key derivation (single implementation).
 *   resolvePlayableSong   – injects the local blob for downloaded songs and
 *                        strips dead `blob:` URLs (offline parity).
 *   isDownloadable / downloadStateOf / buildShareUrl – the formerly
 *                        scattered source-specific checks, unified here.
 *
 * Layering: this service sits above utils and the download store and below
 * the UI; it never imports React.
 */

import type { Song } from '../types/music';
import type { ProviderId } from '../providers/types';
import { inferProvider } from '../providers/adapters';
import { useDownloadsStore } from '../stores/downloadsStore';
import { sourceKey } from '../utils/songIds';

export { sourceKey };

/** Which backend owns a track. Downloaded copies keep their origin type —
 * locality is expressed via `downloadState`, never by mutating the type. */
export type MusicSourceType = ProviderId;

export type MusicDownloadState = 'none' | 'downloading' | 'downloaded' | 'failed';

/** One unified view of a playable item, whatever its origin. */
export interface MusicSource {
  /** Owning backend (youtube / library / …). */
  sourceType: MusicSourceType;
  /** Canonical provider-scoped id (see sourceKey). */
  sourceId: string;
  title: string;
  artist: string;
  album: string;
  artwork: string;
  /** Duration in seconds. */
  durationSec: number;
  /**
   * Ready-to-play URI: the local blob for downloaded songs, the direct URL
   * for online songs that carry one, or null when the stream still needs
   * provider resolution at play time.
   */
  playableUri: string | null;
  downloadState: MusicDownloadState;
}

/** Structural shape of one stored download entry (downloadsStore items). */
export interface DownloadEntryLike {
  id: string;
  youtubeId?: string | null;
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  duration?: number;
  coverArt?: string;
  audioUrl?: string;
}

/** Owning backend of a song — the provider field wins, then inference. */
export function sourceTypeOf(song: Pick<Song, 'provider' | 'youtubeId'>): MusicSourceType {
  return inferProvider(song);
}

/**
 * A song is downloadable when some backend can produce its audio: a YouTube
 * id (server download endpoint) or a direct audioUrl (library stream).
 */
export function isDownloadable(song: Song): boolean {
  return !!(song.youtubeId || song.audioUrl);
}

/** Canonical key for a stored download entry (same derivation as songs). */
export function downloadKey(entry: DownloadEntryLike): string {
  return entry.youtubeId || entry.id;
}

/** Local blob URL for a downloaded song, or null (validates the blob). */
export function localPlayableUri(song: Song): string | null {
  try {
    return useDownloadsStore.getState().getBlobUrl(sourceKey(song));
  } catch {
    return null;
  }
}

/** Current download state for a song — the unified state-machine view. */
export function downloadStateOf(song: Song): MusicDownloadState {
  try {
    const s = useDownloadsStore.getState();
    const key = sourceKey(song);
    if (s.isDownloaded(key)) return 'downloaded';
    if (s.isDownloading(key)) return 'downloading';
    for (let i = s.failedDownloads.length - 1; i >= 0; i--) {
      const f = s.failedDownloads[i];
      if (f && sourceKey(f.song) === key) return 'failed';
    }
  } catch {
    // Download system unavailable — treat as not downloaded.
  }
  return 'none';
}

/** Downloaded-state predicate for services that must stay store-free. */
export function isDownloadedSong(song: Song): boolean {
  try {
    return useDownloadsStore.getState().isDownloaded(sourceKey(song));
  } catch {
    return false;
  }
}

/** Drop a dead blob: URL that has no backing download; otherwise unchanged. */
export function stripStaleBlobUrl(song: Song): Song {
  if (typeof song.audioUrl === 'string' && song.audioUrl.startsWith('blob:')) {
    return { ...song, audioUrl: '' };
  }
  return song;
}

/**
 * Resolve a song's playable URL with download parity: downloaded songs get
 * their local blob injected (offline playback); a stale `blob:` URL with no
 * backing download is dropped so a fresh stream resolves instead of a URL
 * that is guaranteed to fail. Online songs pass through unchanged.
 */
export function resolvePlayableSong(song: Song): Song {
  const blobUrl = localPlayableUri(song);
  if (blobUrl) return { ...song, audioUrl: blobUrl };
  return stripStaleBlobUrl(song);
}

/** Full unified view of a song, merging live download state. */
export function toMusicSource(song: Song): MusicSource {
  const local = localPlayableUri(song);
  let playableUri: string | null = local;
  if (!playableUri && song.audioUrl && !song.audioUrl.startsWith('blob:')) {
    playableUri = song.audioUrl; // a dead blob: URL is never a playable URI
  }
  return {
    sourceType: sourceTypeOf(song),
    sourceId: sourceKey(song),
    title: song.title,
    artist: song.artist,
    album: song.album,
    artwork: song.coverArt,
    durationSec: song.duration,
    playableUri,
    downloadState: downloadStateOf(song),
  };
}

/**
 * External/share URL for a song's origin. YouTube tracks link to the video;
 * everything else shares the app URL — no source checks leak into the UI.
 */
export function buildShareUrl(song: Song): string {
  if (song.youtubeId) return `https://youtube.com/watch?v=${song.youtubeId}`;
  return typeof window !== 'undefined' ? window.location.href : '';
}

/** Convert a stored download entry into a playable Song (downloads page). */
export function downloadEntryToSong(entry: DownloadEntryLike): Song {
  return {
    id: entry.id,
    youtubeId: entry.youtubeId ?? undefined,
    title: entry.title || 'Unknown',
    artist: entry.artist || 'Unknown',
    album: entry.album || '',
    genre: entry.genre || 'Unknown',
    duration: entry.duration || 0,
    coverArt: entry.coverArt || '',
    audioUrl: entry.audioUrl || '',
    releaseYear: 0,
  };
}
