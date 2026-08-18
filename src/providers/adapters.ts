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

/**
 * Determine the owning provider. An explicit `provider` field (carried by
 * tracks produced through the provider system and preserved across queue /
 * localStorage persistence) always wins; legacy songs without it fall back
 * to structural inference from YouTube-specific fields.
 */
export function inferProvider(song: {
  provider?: ProviderId;
  youtubeId?: string;
}): ProviderId {
  if (song.provider) return song.provider;
  return song.youtubeId && YT_ID_RE.test(song.youtubeId) ? 'youtube' : 'library';
}

export function toTrack(input: TrackLike): Track {
  if (input.provider) {
    // Already normalized — pass through (idempotent).
    // Ensure artwork: when coverArt is empty but a YouTube id is available,
    // synthesize a thumbnail URL so the UI never shows a generic icon.
    let artwork = input.artwork ?? input.coverArt ?? '';
    if (!artwork && input.provider === 'youtube') {
      const ytId = input.externalId ?? input.youtubeId;
      if (ytId && YT_ID_RE.test(ytId)) {
        artwork = `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`;
      }
    }
    return {
      id: input.id,
      provider: input.provider,
      title: input.title || 'Unknown',
      artist: input.artist || 'Unknown',
      album: input.album ?? '',
      genre: input.genre ?? 'Unknown',
      duration: input.duration || 0,
      artwork,
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

  const provider = inferProvider(input);
  let inferredArtwork = input.coverArt || input.artwork || '';
  if (!inferredArtwork && provider === 'youtube' && input.youtubeId && YT_ID_RE.test(input.youtubeId)) {
    inferredArtwork = `https://img.youtube.com/vi/${input.youtubeId}/mqdefault.jpg`;
  }
  return {
    id: input.id,
    provider,
    title: input.title || 'Unknown',
    artist: input.artist || 'Unknown',
    album: input.album || input.artist || '',
    genre: input.genre || 'Unknown',
    duration: input.duration || 0,
    artwork: inferredArtwork,
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
    // Preserve provider identity across persistence boundaries (queue,
    // favorites, history) so a future provider's tracks never get
    // re-inferred as library tracks.
    provider: track.provider,
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
