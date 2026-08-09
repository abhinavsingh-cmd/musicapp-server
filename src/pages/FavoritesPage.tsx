import React, { useEffect, useMemo } from 'react';
import { useGoBack } from '../hooks/useGoBack';
import { useAudioStore } from '../stores/audioStore';
import { useSongsStore } from '../stores/songsStore';
import { favoriteKey } from '../utils/songIds';
import { SongTable } from '../features/library/SongTable';
import { Heart, ArrowLeft } from 'lucide-react';

const SkeletonRows = () => (
  <div className="space-y-1">
    {Array.from({ length: 6 }).map((_, i) => (
      <div key={i} className="flex items-center gap-4 px-6 py-2 animate-pulse" style={{ animationDelay: `${i * 40}ms` }}>
        <div className="w-5 h-4 rounded bg-white/10" />
        <div className="w-10 h-10 rounded-lg bg-white/10" />
        <div className="flex-1 space-y-2">
          <div className="h-4 rounded bg-white/10 w-2/3" />
          <div className="h-3 rounded bg-white/10 w-1/3" />
        </div>
        <div className="w-8 h-4 rounded bg-white/10" />
      </div>
    ))}
  </div>
);

export const FavoritesPage: React.FC = () => {
  const goBack = useGoBack();
  const songs = useSongsStore((s) => s.songs);
  const loading = useSongsStore((s) => s.loading);
  const ensureLoaded = useSongsStore((s) => s.ensureLoaded);
  const favorites = useAudioStore((s) => s.favorites);

  useEffect(() => { ensureLoaded(); }, [ensureLoaded]);

  const favSongs = useMemo(() => songs.filter(s => favorites.includes(favoriteKey(s))), [songs, favorites]);

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold text-white flex items-center gap-3">
        <button onClick={goBack} className="p-2 rounded-xl hover:bg-white/5 transition-colors text-gray-400 hover:text-white" aria-label="Go back">
          <ArrowLeft size={20} />
        </button>
        <span className="p-2 rounded-xl bg-red-50 dark:bg-red-900/20"><Heart size={20} className="text-red-500" /></span>
        Favorites ({favSongs.length})
      </h2>

      {loading && favSongs.length === 0 ? (
        <SkeletonRows />
      ) : favSongs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-20 h-20 rounded-3xl bg-red-500/10 flex items-center justify-center mb-4">
            <Heart size={32} className="text-red-400" />
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">No favorites yet</h3>
          <p className="text-gray-400 text-sm max-w-sm">Tap the heart icon on any song to save it here for quick access.</p>
        </div>
      ) : (
        <SongTable songs={favSongs} />
      )}
    </div>
  );
};

export default FavoritesPage;
