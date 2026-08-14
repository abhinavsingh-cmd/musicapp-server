/**
 * Adapters between the legacy `Song` shape (UI/store layer) and the
 * normalized `Track` shape (player/download layer).
 *
 * The app's stores, pages, queue, and persistence all keep using `Song`.
 * Tracks are produced at the boundary (audioService, downloadManager) via
 * `toTrack()`; the normalized shape then flows through the provider system.
 * `toSong()` converts back for anything that still expects `Song`.
 */

import { Song } from '../types/music';
import { ProviderId, Track } from './types';

const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Structural shape accepted by `toTrack`: the full `Song`, a normalized
 * `Track`, or any Song-like subset (e.g. the downloader's input).
 */
export type TrackLike = {
  id: string;
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  duration?: number;
  coverArt?: string;
  audioUrl?: string;
  youtubeId?: string;
  releaseYear?: number;
  lyrics?: string;
  isFavorite?: boolean;
  playCount?: number;
  addedAt?: string;
  // Normalized Track fields — present when the input is already a Track.
  provider?: ProviderId;
  artwork?: string;
  externalId?: string;
  streamUrl?: string;
  metadata?: Record<string, unknown>;
};

/** Infer the owning provider from legacy Song fields. */
export function inferProvider(song: {
  youtubeId?: string;
}): ProviderId {
  return song.youtubeId && YT_ID_RE.test(song.youtubeId) ? 'youtube' : 'library';
}

export function toTrack(input: TrackLike): Track {
  if (input.provider) {
    // Already normalized — pass through (idempotent).
    return {
      id: input.id,
      provider: input.provider,
      title: input.title || 'Unknown',
      artist: input.artist || 'Unknown',
      album: input.album ?? '',
      genre: input.genre ?? 'Unknown',
      duration: input.duration || 0,
      artwork: input.artwork ?? input.coverArt ?? '',
      releaseYear: input.releaseYear,
      externalId: input.externalId,
      streamUrl: input.streamUrl ?? input.audioUrl,
      lyrics: input.lyrics,
      isFavorite: input.isFavorite,
      playCount: input.playCount,
      addedAt: input.addedAt,
      metadata: input.metadata,
    };
  }

  return {
    id: input.id,
    provider: inferProvider(input),
    title: input.title || 'Unknown',
    artist: input.artist || 'Unknown',
    album: input.album || input.artist || '',
    genre: input.genre || 'Unknown',
    duration: input.duration || 0,
    artwork: input.coverArt || input.artwork || '',
    releaseYear: input.releaseYear,
    externalId: input.youtubeId,
    streamUrl: input.audioUrl || input.streamUrl,
    lyrics: input.lyrics,
    isFavorite: input.isFavorite,
    playCount: input.playCount,
    addedAt: input.addedAt,
  };
}

export function toSong(track: Track): Song {
  return {
    id: track.id,
    title: track.title || 'Unknown',
    artist: track.artist || 'Unknown',
    album: track.album || track.artist || 'Unknown',
    duration: track.duration || 0,
    genre: track.genre || 'Unknown',
    coverArt: track.artwork || '',
    audioUrl: track.streamUrl || '',
    // `youtubeId` is a YouTube-only legacy field — never masquerade another
    // provider's external id (e.g. a JioSaavn song id) as a YouTube id,
    // which would route it through YouTube download/playback paths.
    youtubeId: track.provider === 'youtube' ? track.externalId : undefined,
    releaseYear: track.releaseYear || 0,
    isFavorite: track.isFavorite,
    playCount: track.playCount,
    addedAt: track.addedAt,
    lyrics: track.lyrics,
  };
}

/** Stable key for download/lookup operations (provider-scoped id). */
export function trackKey(track: Track): string {
  return track.externalId || track.id;
}
