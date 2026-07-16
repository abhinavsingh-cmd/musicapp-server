import { Song } from '../types/music';
import { sampleSongs } from '../data/sampleSongs';
import { api } from '../config/api';

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
    title: s.title,
    artist: s.artist,
    album: s.album || s.artist,
    duration: s.duration,
    genre: s.genre || 'Pop',
    coverArt: s.coverArt,
    audioUrl: s.youtubeId ? '' : (s.audioUrl || ''),
    youtubeId: s.youtubeId,
    releaseYear: 2024,
    isFavorite: false,
    playCount: Math.floor(Math.random() * 50000),
  };
}

function dedupe(songs: Song[]): Song[] {
  const seen = new Set<string>();
  return songs.filter(s => {
    const key = `${s.title.toLowerCase()}|${s.artist.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

let cachedSongs: Song[] | null = null;

export async function fetchSongs(): Promise<Song[]> {
  if (cachedSongs) return cachedSongs;
  try {
    const res = await fetch(api('/songs'));
    if (!res.ok) throw new Error('Server unavailable');
    const data = await res.json();
    const serverSongs = (data.songs || []).map(mapSong);
    cachedSongs = dedupe([...sampleSongs, ...serverSongs]);
    return cachedSongs;
  } catch {
    cachedSongs = [...sampleSongs];
    return cachedSongs;
  }
}

export async function searchSongs(query: string): Promise<Song[]> {
  if (!query.trim()) return fetchSongs();
  const q = query.toLowerCase();
  const allSongs = await fetchSongs();
  return allSongs.filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      s.artist.toLowerCase().includes(q) ||
      s.genre.toLowerCase().includes(q)
  );
}

export async function fetchYouTubeTrending(): Promise<Song[]> {
  try {
    const res = await fetch(api('/youtube/trending'));
    if (!res.ok) throw new Error('Failed to fetch trending');
    const data = await res.json();
    return (data.results || []).map((r: any) => ({
      id: 'trending-' + r.id,
      youtubeId: r.id,
      title: r.title,
      artist: r.artist,
      genre: 'Trending',
      duration: r.duration,
      coverArt: r.thumbnail,
      album: '',
      audioUrl: '',
      releaseYear: 0,
    }));
  } catch {
    return [];
  }
}
