import { Song } from '../types/music';
import { fetchSongs } from '../services/musicApi';

const RECENTLY_PLAYED_LIMIT = 100;
const RECOMMENDATION_COUNT = 50;
const PRELOAD_COUNT = 3;

interface RecommendationSource {
  name: string;
  weight: number;
  songs: Song[];
}

interface RecommendationOptions {
  seedSong?: Song;
  limit?: number;
  excludeIds?: Set<string>;
  useHistory?: boolean;
  useFavorites?: boolean;
  useQueue?: boolean;
}

function computeSimilarityScore(song: Song, seed: Song): number {
  let score = 0;
  
  if (song.artist.toLowerCase() === seed.artist.toLowerCase()) {
    score += 50;
  }
  
  if (song.genre.toLowerCase() === seed.genre.toLowerCase()) {
    score += 30;
  }
  
  const tempoDiff = Math.abs((song.duration || 0) - (seed.duration || 0));
  if (tempoDiff < 30) score += 15;
  else if (tempoDiff < 60) score += 10;
  else if (tempoDiff < 120) score += 5;
  
  return score;
}

async function getSameArtistSongs(artist: string, excludeIds: Set<string>, limit: number, allSongs: Song[]): Promise<Song[]> {
  return allSongs
    .filter(s => 
      s.artist.toLowerCase() === artist.toLowerCase() && 
      !excludeIds.has(s.id)
    )
    .slice(0, limit);
}

async function getSameGenreSongs(genre: string, excludeIds: Set<string>, limit: number, allSongs: Song[]): Promise<Song[]> {
  return allSongs
    .filter(s => 
      s.genre.toLowerCase() === genre.toLowerCase() && 
      !excludeIds.has(s.id)
    )
    .slice(0, limit);
}

async function getSimilarMoodSongs(seed: Song, excludeIds: Set<string>, limit: number, allSongs: Song[]): Promise<Song[]> {
  const scored = allSongs
    .filter(s => !excludeIds.has(s.id) && s.id !== seed.id)
    .map(s => ({ song: s, score: computeSimilarityScore(s, seed) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map(s => s.song);
}

async function getHistoryBasedSongs(excludeIds: Set<string>, limit: number, allSongs: Song[]): Promise<Song[]> {
  const { useHistoryStore } = await import('../stores/historyStore');
  const history = useHistoryStore.getState().history;
  const recentArtists = new Map<string, number>();
  const recentGenres = new Map<string, number>();
  
  for (const entry of history.slice(0, 50)) {
    recentArtists.set(entry.song.artist, (recentArtists.get(entry.song.artist) || 0) + 1);
    recentGenres.set(entry.song.genre, (recentGenres.get(entry.song.genre) || 0) + 1);
  }
  
  const topArtists = Array.from(recentArtists.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([artist]) => artist);
  
  const topGenres = Array.from(recentGenres.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([genre]) => genre);
  
  return allSongs
    .filter(s => 
      !excludeIds.has(s.id) &&
      (topArtists.includes(s.artist) || topGenres.includes(s.genre))
    )
    .slice(0, limit);
}

async function getFavoritesBasedSongs(excludeIds: Set<string>, limit: number, allSongs: Song[]): Promise<Song[]> {
  const { useAudioStore } = await import('../stores/audioStore');
  const favorites = useAudioStore.getState().favorites;
  const favSongs = allSongs.filter(s => favorites.includes(s.youtubeId || s.id));
  
  const genres = new Set(favSongs.map(s => s.genre));
  const artists = new Set(favSongs.map(s => s.artist));
  
  return allSongs
    .filter(s => 
      !excludeIds.has(s.id) &&
      (genres.has(s.genre) || artists.has(s.artist))
    )
    .slice(0, limit);
}

async function getQueueBasedSongs(excludeIds: Set<string>, limit: number, allSongs: Song[]): Promise<Song[]> {
  const { useQueueStore } = await import('../stores/queueStore');
  const queue = useQueueStore.getState().queue;
  if (queue.length === 0) return [];
  
  const genres = new Set(queue.map(s => s.genre));
  const artists = new Set(queue.map(s => s.artist));
  
  return allSongs
    .filter(s => 
      !excludeIds.has(s.id) &&
      (genres.has(s.genre) || artists.has(s.artist))
    )
    .slice(0, limit);
}

async function getPopularSongs(excludeIds: Set<string>, limit: number, allSongs: Song[]): Promise<Song[]> {
  return allSongs
    .filter(s => !excludeIds.has(s.id))
    .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
    .slice(0, limit);
}

function rankAndDedupe(sources: RecommendationSource[], excludeIds: Set<string>, limit: number): Song[] {
  const scored = new Map<string, { song: Song; score: number }>();
  
  for (const source of sources) {
    for (const song of source.songs) {
      if (excludeIds.has(song.id)) continue;
      
      const existing = scored.get(song.id);
      const newScore = source.weight;
      
      if (!existing || newScore > existing.score) {
        scored.set(song.id, { song, score: newScore });
      }
    }
  }
  
  return Array.from(scored.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.song);
}

export async function getRecommendations(options: RecommendationOptions = {}): Promise<Song[]> {
  const {
    seedSong,
    limit = RECOMMENDATION_COUNT,
    excludeIds = new Set(),
    useHistory = true,
    useFavorites = true,
    useQueue = true,
  } = options;

  const localExclude = new Set(excludeIds);
  if (seedSong) {
    localExclude.add(seedSong.id);
  }

  // Fetch ALL songs ONCE and pass to every helper — eliminates 6-7 redundant API calls.
  const allSongs = await fetchSongs();

  const recentlyPlayed = allSongs.slice(0, RECENTLY_PLAYED_LIMIT);  // use cached list
  recentlyPlayed.forEach(entry => localExclude.add(entry.id));

  const sources: RecommendationSource[] = [];

  if (seedSong) {
    const [sameArtist, sameGenre, similarMood] = await Promise.allSettled([
      getSameArtistSongs(seedSong.artist, localExclude, 10, allSongs),
      getSameGenreSongs(seedSong.genre, localExclude, 10, allSongs),
      getSimilarMoodSongs(seedSong, localExclude, 10, allSongs),
    ]);
    
    const artistSongs = sameArtist.status === 'fulfilled' ? sameArtist.value : [];
    const genreSongs = sameGenre.status === 'fulfilled' ? sameGenre.value : [];
    const moodSongs = similarMood.status === 'fulfilled' ? similarMood.value : [];

    if (artistSongs.length) sources.push({ name: 'sameArtist', weight: 50, songs: artistSongs });
    if (genreSongs.length) sources.push({ name: 'sameGenre', weight: 30, songs: genreSongs });
    if (moodSongs.length) sources.push({ name: 'similarMood', weight: 20, songs: moodSongs });
  }
  
  if (useQueue) {
    try {
      const queue = allSongs.slice(0, 50); // use cached list, limit size
      const queueSongs = await getQueueBasedSongs(localExclude, 15, queue);
      if (queueSongs.length) sources.push({ name: 'queueBased', weight: 25, songs: queueSongs });
    } catch {}
  }
  
  if (useHistory) {
    try {
      const historySongs = await getHistoryBasedSongs(localExclude, 15, allSongs);
      if (historySongs.length) sources.push({ name: 'historyBased', weight: 35, songs: historySongs });
    } catch {}
  }
  
  if (useFavorites) {
    try {
      const favSongs = await getFavoritesBasedSongs(localExclude, 10, allSongs);
      if (favSongs.length) sources.push({ name: 'favoritesBased', weight: 40, songs: favSongs });
    } catch {}
  }
  
  try {
    const popularSongs = await getPopularSongs(localExclude, 10, allSongs);
    if (popularSongs.length) sources.push({ name: 'popular', weight: 10, songs: popularSongs });
  } catch {}

  return rankAndDedupe(sources, localExclude, limit);
}

export async function preloadSongs(songs: Song[], count: number = PRELOAD_COUNT): Promise<void> {
  const toPreload = songs.slice(0, count);
  await Promise.all(
    toPreload.map(async (song) => {
      if (song.audioUrl && (song.audioUrl.startsWith('blob:') || song.audioUrl.startsWith('http'))) {
        const audio = new Audio();
        audio.preload = 'metadata';
        audio.src = song.audioUrl;
        try {
          await new Promise<void>((resolve) => {
            audio.onloadedmetadata = () => resolve();
            audio.onerror = () => resolve();
            setTimeout(resolve, 3000);
          });
        } finally {
          audio.removeAttribute('src');
          audio.load();
        }
      }
    })
  );
}

export function createExcludeSet(songs: Song[]): Set<string> {
  const set = new Set<string>();
  songs.forEach(s => set.add(s.id));
  return set;
}