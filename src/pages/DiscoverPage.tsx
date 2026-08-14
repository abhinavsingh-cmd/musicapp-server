import React, { useState, useEffect, useMemo } from 'react';
import { useGoBack } from '../hooks/useGoBack';
import { useSongsStore } from '../stores/songsStore';
import { SongTable } from '../features/library/SongTable';
import { Compass, Sparkles, Flame, ArrowLeft } from 'lucide-react';

export const DiscoverPage: React.FC = () => {
  const goBack = useGoBack();
  const songs = useSongsStore((s) => s.songs);
  const loading = useSongsStore((s) => s.loading);
  const ensureLoaded = useSongsStore((s) => s.ensureLoaded);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);

  useEffect(() => { ensureLoaded(); }, [ensureLoaded]);

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

  if (loading) return (
    <div className="p-6 space-y-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-white/5 animate-pulse" />
        <div className="space-y-2">
          <div className="h-6 w-32 rounded bg-white/10 animate-pulse" />
          <div className="h-3 w-20 rounded bg-white/5 animate-pulse" />
        </div>
      </div>
      <div>
        <div className="h-5 w-24 rounded bg-white/10 animate-pulse mb-4" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-9 w-20 rounded-full bg-white/5 animate-pulse" style={{ animationDelay: `${i * 30}ms` }} />
          ))}
        </div>
      </div>
      <div>
        <div className="h-5 w-32 rounded bg-white/10 animate-pulse mb-4" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 py-2 animate-pulse" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="w-12 h-12 rounded-lg bg-white/10" />
            <div className="flex-1 space-y-2">
              <div className="h-4 rounded bg-white/10 w-2/3" />
              <div className="h-3 rounded bg-white/10 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );

return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-3 mb-6">
          <button onClick={goBack} className="p-2 rounded-xl hover:bg-white/5 transition-colors text-gray-400 hover:text-white" aria-label="Go back">
            <ArrowLeft size={20} />
          </button>
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
