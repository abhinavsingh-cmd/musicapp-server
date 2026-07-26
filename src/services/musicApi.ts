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
  if (cachedSongs) return cachedSongs;
  try {
    const res = await apiFetch(api('/songs'));
    const data = await res.json();
    const serverSongs = (data.songs || []).map(mapSong);
    cachedSongs = dedupe(serverSongs);

    // Cache metadata in background — never block the caller
    const songsToCache = cachedSongs;
    const defer = typeof requestIdleCallback === 'function'
      ? requestIdleCallback
      : (cb: IdleRequestCallback) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 0);
    defer(() => {
      for (const song of songsToCache) {
        cacheMetadata({
          id: song.id, title: song.title, artist: song.artist,
          album: song.album, genre: song.genre, duration: song.duration,
          coverArt: song.coverArt, youtubeId: song.youtubeId, releaseYear: song.releaseYear,
        }).catch(() => {});
      }
    });

    return cachedSongs;
  } catch {
    cachedSongs = null;
    return [];
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

export interface TrendingResult {
  songs: Song[];
  source: string;
  lastUpdated: number | null;
}

// --- Hardcoded trending fallback (always available, zero network) ---
const BUILTIN_TRENDING: TrendingResult = {
  source: 'builtin',
  lastUpdated: Date.now(),
  songs: [
    { id:'t-kN6HHzEXKFU', youtubeId:'kN6HHzEXKFU', title:'Pushpa Pushpa', artist:'Devi Sri Prasad', genre:'Trending', duration:230, coverArt:'https://img.youtube.com/vi/kN6HHzEXKFU/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-BddP6PYo2gs', youtubeId:'BddP6PYo2gs', title:'Kesariya', artist:'Arijit Singh', genre:'Trending', duration:268, coverArt:'https://img.youtube.com/vi/BddP6PYo2gs/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-u_wB6byrl5k', youtubeId:'u_wB6byrl5k', title:'Oo Antava', artist:'Devi Sri Prasad', genre:'Trending', duration:226, coverArt:'https://img.youtube.com/vi/u_wB6byrl5k/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-VAdGW7QDJiU', youtubeId:'VAdGW7QDJiU', title:'Chaleya', artist:'Arijit Singh', genre:'Trending', duration:231, coverArt:'https://img.youtube.com/vi/VAdGW7QDJiU/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-hcMzwMrr1tE', youtubeId:'hcMzwMrr1tE', title:'Srivalli', artist:'Javed Ali', genre:'Trending', duration:228, coverArt:'https://img.youtube.com/vi/hcMzwMrr1tE/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-WWZxDA81JFk', youtubeId:'WWZxDA81JFk', title:'Tum Hi Ho', artist:'Arijit Singh', genre:'Trending', duration:262, coverArt:'https://img.youtube.com/vi/WWZxDA81JFk/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-284Ov7ysmfA', youtubeId:'284Ov7ysmfA', title:'Channa Mereya', artist:'Arijit Singh', genre:'Trending', duration:279, coverArt:'https://img.youtube.com/vi/284Ov7ysmfA/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-JGwWNGJdvx8', youtubeId:'JGwWNGJdvx8', title:'Shape of You', artist:'Ed Sheeran', genre:'Trending', duration:234, coverArt:'https://img.youtube.com/vi/JGwWNGJdvx8/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-CevxZvSJLk8', youtubeId:'CevxZvSJLk8', title:'Roar', artist:'Katy Perry', genre:'Trending', duration:223, coverArt:'https://img.youtube.com/vi/CevxZvSJLk8/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-OPf0YbXqDm0', youtubeId:'OPf0YbXqDm0', title:'Finesse', artist:'Bruno Mars', genre:'Trending', duration:200, coverArt:'https://img.youtube.com/vi/OPf0YbXqDm0/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-LXb3EKWsInQ', youtubeId:'LXb3EKWsInQ', title:'Calm Down', artist:'Rema', genre:'Trending', duration:219, coverArt:'https://img.youtube.com/vi/LXb3EKWsInQ/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-hT_nvWreIhg', youtubeId:'hT_nvWreIhg', title:'Counting Stars', artist:'OneRepublic', genre:'Trending', duration:257, coverArt:'https://img.youtube.com/vi/hT_nvWreIhg/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-dQw4w9WgXcQ', youtubeId:'dQw4w9WgXcQ', title:'Never Gonna Give You Up', artist:'Rick Astley', genre:'Trending', duration:213, coverArt:'https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-e-ORhEE9VVg', youtubeId:'e-ORhEE9VVg', title:'Thank U Next', artist:'Ariana Grande', genre:'Trending', duration:207, coverArt:'https://img.youtube.com/vi/e-ORhEE9VVg/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-kJQP7kiw5Fk', youtubeId:'kJQP7kiw5Fk', title:'Despacito', artist:'Luis Fonsi', genre:'Trending', duration:228, coverArt:'https://img.youtube.com/vi/kJQP7kiw5Fk/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-4NRXx6U8ABQ', youtubeId:'4NRXx6U8ABQ', title:'Save Your Tears', artist:'The Weeknd', genre:'Trending', duration:215, coverArt:'https://img.youtube.com/vi/4NRXx6U8ABQ/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-nfWlot6h_JM', youtubeId:'nfWlot6h_JM', title:'Shallow', artist:'Lady Gaga', genre:'Trending', duration:216, coverArt:'https://img.youtube.com/vi/nfWlot6h_JM/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-BmllggGO4pM', youtubeId:'BmllggGO4pM', title:'Senorita', artist:'Shawn Mendes', genre:'Trending', duration:191, coverArt:'https://img.youtube.com/vi/BmllggGO4pM/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-50VNCymT-Cs', youtubeId:'50VNCymT-Cs', title:'Let Me Down Slowly', artist:'Alec Benjamin', genre:'Trending', duration:157, coverArt:'https://img.youtube.com/vi/50VNCymT-Cs/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
    { id:'t-kffacxfA7G4', youtubeId:'kffacxfA7G4', title:'Baby', artist:'Justin Bieber', genre:'Trending', duration:214, coverArt:'https://img.youtube.com/vi/kffacxfA7G4/mqdefault.jpg', album:'', audioUrl:'', releaseYear:0, isFavorite:false, playCount:0 },
  ],
};

// --- In-memory cache (30 min TTL) ---
let trendingCache: TrendingResult | null = null;
let trendingCacheTime = 0;
const TRENDING_CACHE_TTL = 30 * 60 * 1000;

function buildLocalTrending(): TrendingResult {
  const all = cachedSongs || [];
  if (all.length === 0) return BUILTIN_TRENDING;
  const shuffled = [...all].sort(() => Math.random() - 0.5).slice(0, 20);
  return {
    songs: shuffled.map(s => ({ ...s, id: 'trending-' + s.id, genre: 'Trending' as const })),
    source: 'builtin',
    lastUpdated: Date.now(),
  };
}

export async function fetchYouTubeTrending(): Promise<TrendingResult> {
  // 1. Return cache if fresh (<30 min)
  if (trendingCache && Date.now() - trendingCacheTime < TRENDING_CACHE_TTL) {
    return trendingCache;
  }

  // 2. Try server: 5s timeout, up to 2 retries (3 total), hard 8s cap
  const startTime = Date.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (Date.now() - startTime > 8_000) break;
    try {
      const res = await apiFetch(api('/charts/trending.json'), { timeout: 5_000, retries: 0 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) throw new Error('Not JSON');
      const data = await res.json();
      const results = (data.results || [])
        .filter((r: any) => r && r.id)
        .map((r: any) => ({
          id: 'trending-' + r.id,
          youtubeId: r.id,
          title: r.title || 'Unknown',
          artist: r.artist || 'Unknown',
          genre: 'Trending' as const,
          duration: r.duration || 0,
          coverArt: r.thumbnail || '',
          album: '',
          audioUrl: '',
          releaseYear: 0,
          isFavorite: false,
          playCount: 0,
        }));
      if (results.length > 0) {
        const result: TrendingResult = {
          songs: results,
          source: data.source || 'none',
          lastUpdated: data.lastUpdated || Date.now(),
        };
        trendingCache = result;
        trendingCacheTime = Date.now();
        return result;
      }
    } catch { /* retry */ }
    if (attempt < 2) await new Promise(r => setTimeout(r, 500));
  }

  // 3. Fallback: local songs → builtin
  const fallback = buildLocalTrending();
  trendingCache = fallback;
  trendingCacheTime = Date.now();
  return fallback;
}
