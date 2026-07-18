import { Song } from '../types/music';
import { useHistoryStore } from '../stores/historyStore';
import { useQueueStore } from '../stores/queueStore';
import { useAudioStore } from '../stores/audioStore';
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

async function getSameArtistSongs(artist: string, excludeIds: Set<string>, limit: number): Promise<Song[]> {
  const allSongs = await fetchSongs();
  return allSongs
    .filter(s => 
      s.artist.toLowerCase() === artist.toLowerCase() && 
      !excludeIds.has(s.id)
    )
    .slice(0, limit);
}

async function getSameGenreSongs(genre: string, excludeIds: Set<string>, limit: number): Promise<Song[]> {
  const allSongs = await fetchSongs();
  return allSongs
    .filter(s => 
      s.genre.toLowerCase() === genre.toLowerCase() && 
      !excludeIds.has(s.id)
    )
    .slice(0, limit);
}

async function getSimilarMoodSongs(seed: Song, excludeIds: Set<string>, limit: number): Promise<Song[]> {
  const allSongs = await fetchSongs();
  const scored = allSongs
    .filter(s => !excludeIds.has(s.id) && s.id !== seed.id)
    .map(s => ({ song: s, score: computeSimilarityScore(s, seed) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map(s => s.song);
}

async function getHistoryBasedSongs(excludeIds: Set<string>, limit: number): Promise<Song[]> {
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
  
  const allSongs = await fetchSongs();
  return allSongs
    .filter(s => 
      !excludeIds.has(s.id) &&
      (topArtists.includes(s.artist) || topGenres.includes(s.genre))
    )
    .slice(0, limit);
}

async function getFavoritesBasedSongs(excludeIds: Set<string>, limit: number): Promise<Song[]> {
  const favorites = useAudioStore.getState().favorites;
  const allSongs = await fetchSongs();
  const favSongs = allSongs.filter(s => favorites.includes(s.id));
  
  const genres = new Set(favSongs.map(s => s.genre));
  const artists = new Set(favSongs.map(s => s.artist));
  
  return allSongs
    .filter(s => 
      !excludeIds.has(s.id) &&
      (genres.has(s.genre) || artists.has(s.artist))
    )
    .slice(0, limit);
}

async function getQueueBasedSongs(excludeIds: Set<string>, limit: number): Promise<Song[]> {
  const queue = useQueueStore.getState().queue;
  if (queue.length === 0) return [];
  
  const genres = new Set(queue.map(s => s.genre));
  const artists = new Set(queue.map(s => s.artist));
  const allSongs = await fetchSongs();
  
  return allSongs
    .filter(s => 
      !excludeIds.has(s.id) &&
      (genres.has(s.genre) || artists.has(s.artist))
    )
    .slice(0, limit);
}

async function getPopularSongs(excludeIds: Set<string>, limit: number): Promise<Song[]> {
  const allSongs = await fetchSongs();
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

  if (seedSong) {
    excludeIds.add(seedSong.id);
  }

  const recentlyPlayed = useHistoryStore.getState().getRecent(RECENTLY_PLAYED_LIMIT);
  recentlyPlayed.forEach(entry => excludeIds.add(entry.song.id));

  const sources: RecommendationSource[] = [];
  
  if (seedSong) {
    const [sameArtist, sameGenre, similarMood] = await Promise.all([
      getSameArtistSongs(seedSong.artist, excludeIds, 10),
      getSameGenreSongs(seedSong.genre, excludeIds, 10),
      getSimilarMoodSongs(seedSong, excludeIds, 10),
    ]);
    
    if (sameArtist.length) sources.push({ name: 'sameArtist', weight: 50, songs: sameArtist });
    if (sameGenre.length) sources.push({ name: 'sameGenre', weight: 30, songs: sameGenre });
    if (similarMood.length) sources.push({ name: 'similarMood', weight: 20, songs: similarMood });
  }
  
  if (useQueue) {
    const queueSongs = await getQueueBasedSongs(excludeIds, 15);
    if (queueSongs.length) sources.push({ name: 'queueBased', weight: 25, songs: queueSongs });
  }
  
  if (useHistory) {
    const historySongs = await getHistoryBasedSongs(excludeIds, 15);
    if (historySongs.length) sources.push({ name: 'historyBased', weight: 35, songs: historySongs });
  }
  
  if (useFavorites) {
    const favSongs = await getFavoritesBasedSongs(excludeIds, 10);
    if (favSongs.length) sources.push({ name: 'favoritesBased', weight: 40, songs: favSongs });
  }
  
  const popularSongs = await getPopularSongs(excludeIds, 10);
  if (popularSongs.length) sources.push({ name: 'popular', weight: 10, songs: popularSongs });
  
  return rankAndDedupe(sources, excludeIds, limit);
}

export async function preloadSongs(songs: Song[], count: number = PRELOAD_COUNT): Promise<void> {
  const toPreload = songs.slice(0, count);
  await Promise.all(
    toPreload.map(async (song) => {
      if (song.audioUrl && (song.audioUrl.startsWith('blob:') || song.audioUrl.startsWith('http'))) {
        try {
          const audio = new Audio();
          audio.preload = 'metadata';
          audio.src = song.audioUrl;
          await new Promise<void>((resolve) => {
            audio.onloadedmetadata = () => resolve();
            audio.onerror = () => resolve();
            setTimeout(resolve, 3000);
          });
        } catch {}
      }
    })
  );
}

export function createExcludeSet(songs: Song[]): Set<string> {
  const set = new Set<string>();
  songs.forEach(s => set.add(s.id));
  return set;
}