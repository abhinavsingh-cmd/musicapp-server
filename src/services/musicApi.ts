import { Song } from '../types/music';
import { api, apiFetch } from '../config/api';
import { cacheMetadata } from '../utils/downloadManager';

interface ApiSong {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  genre?: string;
  coverArt: string;
  audioUrl?: string;
  youtubeId: string;
}

function mapSong(s: ApiSong): Song {
  return {
    id: String(s.id),
    title: s.title || 'Unknown',
    artist: s.artist || 'Unknown',
    album: s.album || s.artist || 'Unknown',
    duration: s.duration || 0,
    genre: s.genre || 'Pop',
    coverArt: s.coverArt || '',
    audioUrl: s.youtubeId ? '' : (s.audioUrl || ''),
    youtubeId: s.youtubeId,
    releaseYear: 2024,
    isFavorite: false,
    playCount: 0,
  };
}

function dedupe(songs: Song[]): Song[] {
  const seen = new Set<string>();
  return songs.filter(s => {
    const key = `${(s.title || '').toLowerCase()}|${(s.artist || '').toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

let cachedSongs: Song[] | null = null;

export function invalidateSongsCache(): void {
  cachedSongs = null;
}

export async function fetchSongs(): Promise<Song[]> {
  if (cachedSongs && cachedSongs.length > 0) return cachedSongs;
  try {
    const res = await apiFetch(api('/songs'));
    const data = await res.json();
    const serverSongs = (data.details?.songs || data.songs || []).map(mapSong);
    const deduped = dedupe(serverSongs);
    if (deduped.length > 0) {
      cachedSongs = deduped;

      const defer = typeof requestIdleCallback === 'function'
        ? requestIdleCallback
        : (cb: IdleRequestCallback) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 0);
      defer(() => {
        for (const song of cachedSongs!) {
          cacheMetadata({
            id: song.id, title: song.title, artist: song.artist,
            album: song.album, genre: song.genre, duration: song.duration,
            coverArt: song.coverArt, youtubeId: song.youtubeId, releaseYear: song.releaseYear,
          }).catch(() => {});
        }
      });
    }
    return cachedSongs || [];
  } catch {
    return cachedSongs || [];
  }
}

export async function searchSongs(query: string): Promise<Song[]> {
  if (!query.trim()) return fetchSongs();
  const q = query.toLowerCase();
  const allSongs = await fetchSongs();
  return allSongs.filter(
    (s) =>
      (s.title || '').toLowerCase().includes(q) ||
      (s.artist || '').toLowerCase().includes(q) ||
      (s.genre || '').toLowerCase().includes(q)
  );
}
