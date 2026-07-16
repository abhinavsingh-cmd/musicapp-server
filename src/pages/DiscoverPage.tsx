import React, { useState, useEffect, useMemo } from 'react';
import { SongTable } from '../features/library/SongTable';
import { Song } from '../types/music';
import { fetchSongs } from '../services/musicApi';
import { Compass, Sparkles, Flame } from 'lucide-react';

export const DiscoverPage: React.FC = () => {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);

  useEffect(() => { fetchSongs().then(s => { setSongs(s); setLoading(false); }); }, []);

  const genres = useMemo(() => {
    const map = new Map<string, number>();
    songs.forEach(s => map.set(s.genre, (map.get(s.genre) || 0) + 1));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [songs]);

  const filteredSongs = useMemo(() => {
    if (!selectedGenre) {
      const shuffled = [...songs].sort(() => 0.5 - Math.random());
      return shuffled.slice(0, 100);
    }
    return songs.filter(s => s.genre === selectedGenre);
  }, [songs, selectedGenre]);

  if (loading) return <div className="flex-1 flex items-center justify-center"><div className="animate-spin text-purple-500 text-xl">Loading...</div></div>;

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-3 mb-6">
          <span className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-900/20"><Compass size={20} className="text-indigo-500" /></span>
          Discover
        </h2>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Flame size={18} className="text-orange-500" /> Genres
        </h3>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedGenre(null)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${!selectedGenre ? 'bg-purple-500 text-white' : 'bg-[#1a1a2e] text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
          >
            All ({songs.length})
          </button>
          {genres.map(([genre, count]) => (
            <button
              key={genre}
              onClick={() => setSelectedGenre(genre)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${selectedGenre === genre ? 'bg-purple-500 text-white' : 'bg-[#1a1a2e] text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
            >
              {genre} ({count})
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Sparkles size={18} className="text-yellow-500" /> {selectedGenre || 'Random Picks'}
        </h3>
        <SongTable songs={filteredSongs} />
      </div>
    </div>
  );
};

export default DiscoverPage;
