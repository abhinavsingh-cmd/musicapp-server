import React, { useState, useEffect, useMemo } from 'react';
import { useAudioStore } from '../stores/audioStore';
import { SongTable } from '../features/library/SongTable';
import { Song } from '../types/music';
import { fetchSongs } from '../services/musicApi';
import { Heart } from 'lucide-react';

export const FavoritesPage: React.FC = () => {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const { favorites } = useAudioStore();

  useEffect(() => { fetchSongs().then(s => { setSongs(s); setLoading(false); }); }, []);

  const favSongs = useMemo(() => songs.filter(s => favorites.includes(s.id)), [songs, favorites]);

  if (loading) return <div className="flex-1 flex items-center justify-center"><div className="animate-spin text-purple-500 text-xl">Loading...</div></div>;

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold text-white flex items-center gap-3">
        <span className="p-2 rounded-xl bg-red-50 dark:bg-red-900/20"><Heart size={20} className="text-red-500" /></span>
        Favorites ({favSongs.length})
      </h2>

      {favSongs.length === 0 ? (
        <div className="text-center py-16">
          <Heart size={48} className="mx-auto text-gray-300 dark:text-gray-600 mb-4" />
          <p className="text-gray-400">No favorites yet. Click the heart icon on any song to add it here.</p>
        </div>
      ) : (
        <SongTable songs={favSongs} />
      )}
    </div>
  );
};

export default FavoritesPage;
