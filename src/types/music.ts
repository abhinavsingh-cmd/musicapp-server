import type { ProviderId } from '../providers/types';

export interface Song {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // in seconds
  genre: string;
  coverArt: string;
  audioUrl: string;
  youtubeId?: string;
  /**
   * Owning music-source provider. Optional for backward compatibility with
   * persisted queues/favorites predating the provider architecture; when
   * absent it is inferred (youtubeId → 'youtube', otherwise 'library').
   * New tracks always carry it so provider identity survives persistence.
   */
  provider?: ProviderId;
  releaseYear: number;
  isFavorite?: boolean;
  playCount?: number;
  addedAt?: string;
  lyrics?: string;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  coverArt: string;
  songIds: string[];
  trackCount: number;
  duration: number;
  createdAt: string;
  updatedAt?: string;
  isPublic: boolean;
  isFavorite?: boolean;
  collaborative?: boolean;
  shareToken?: string;
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  coverArt: string;
  releaseYear: number;
  songIds: string[];
  trackCount: number;
  duration: number;
  genre: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
  plan: 'free' | 'premium' | 'pro';
}