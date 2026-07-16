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

export interface AudioState {
  currentSong: Song | null;
  playlist: Song[];
  currentIndex: number;
  isPlaying: boolean;
  volume: number;
  isShuffled: boolean;
  repeatMode: 'off' | 'all' | 'one';
  isLoading: boolean;
  error: string | null;
  progress: number;
  duration: number;
  favorites: string[];
  shuffleHistory: number[];
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
  plan: 'free' | 'premium' | 'pro';
}