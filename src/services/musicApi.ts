import { Song } from '../types/music';
import { sampleSongs } from '../data/sampleSongs';
import { api, apiFetch } from '../config/api';

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
    playCount: Math.floor(Math.random() * 50000),
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

export async function fetchSongs(): Promise<Song[]> {
  if (cachedSongs) return cachedSongs;
  try {
    const res = await apiFetch(api('/songs'));
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
      (s.title || '').toLowerCase().includes(q) ||
      (s.artist || '').toLowerCase().includes(q) ||
      (s.genre || '').toLowerCase().includes(q)
  );
}

export async function fetchYouTubeTrending(): Promise<Song[]> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const res = await apiFetch(api('/youtube/trending'), { timeout: 20_000 });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`Expected JSON, got ${contentType.slice(0, 40) || 'unknown'}`);
      }
      const data = await res.json();
      const results = (data.results || [])
        .filter((r: any) => r && r.id)
        .map((r: any) => ({
          id: 'trending-' + r.id,
          youtubeId: r.id,
          title: r.title || 'Unknown',
          artist: r.artist || 'Unknown',
          genre: 'Trending',
          duration: r.duration || 0,
          coverArt: r.thumbnail || '',
          album: '',
          audioUrl: '',
          releaseYear: 0,
        }));
      return results;
    } catch (err: any) {
      lastError = err;
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 800 * Math.pow(2, attempt)));
      }
    }
  }
  console.warn('[MusicApi] fetchYouTubeTrending failed after retries:', lastError?.message);
  return [];
}
