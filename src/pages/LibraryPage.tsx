import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGoBack } from '../hooks/useGoBack';
import { useDebounce } from '../hooks/useDebounce';
import { useAudioStore } from '../stores/audioStore';
import { usePlaylistStore } from '../stores/playlistStore';
import { useSongsStore } from '../stores/songsStore';
import { SongTable } from '../features/library/SongTable';
import { AlbumGrid } from '../features/album/AlbumGrid';
import { PlaylistCard } from '../features/playlist/PlaylistCard';
import { cn } from '../utils/cn';
import { Search, List, Grid, Plus, Music2, ArrowLeft, AlertTriangle } from 'lucide-react';
import { Album, Song, Playlist } from '../types/music';
import { AnimatePresence, motion } from 'framer-motion';

const tabs = [
  { key: 'songs' as const, label: 'Songs' },
  { key: 'albums' as const, label: 'Albums' },
  { key: 'playlists' as const, label: 'Playlists' },
];

export const LibraryPage: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedQuery = useDebounce(searchQuery, 200);
  const [activeTab, setActiveTab] = useState<'songs' | 'albums' | 'playlists'>('songs');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [lastFetchAttempt, setLastFetchAttempt] = useState(0);
  const [fetchRetries, setFetchRetries] = useState(0);
  
  const songs = useSongsStore((s) => s.songs);
  const loading = useSongsStore((s) => s.loading);
  const error = useSongsStore((s) => s.error);
  const ensureLoaded = useSongsStore((s) => s.ensureLoaded);
  const loadSong = useAudioStore((s) => s.loadSong);
  const userPlaylists = usePlaylistStore((s) => s.playlists);
  const navigate = useNavigate();
  const goBack = useGoBack();

  const maxRetries = 3;
  // Matches the store's fetch deadline (60s): the deployed server can take
  // 30-60s to cold-start, and a shorter page-level kill-switch showed a
  // false "Failed to load library" while the fetch was still legitimately
  // in flight.
  const retryTimeout = 60000;
  const shouldRetryFetch = useMemo(() => {
    const timeSinceLastAttempt = Date.now() - lastFetchAttempt;
    return loading && (timeSinceLastAttempt >= retryTimeout || fetchRetries >= maxRetries);
  }, [loading, lastFetchAttempt, fetchRetries, retryTimeout, maxRetries]);

  useEffect(() => {
    const attemptFetch = () => {
      setLastFetchAttempt(Date.now());
      if (fetchRetries < maxRetries) {
        setFetchRetries(prev => prev + 1);
        ensureLoaded();
      }
    };
    
    if (!loading && songs.length === 0) {
      attemptFetch();
    }
  }, [loading, songs.length, ensureLoaded, fetchRetries, maxRetries]);

  const handleRetry = useCallback(() => {
    setFetchRetries(0);
    ensureLoaded();
  }, [ensureLoaded]);

  const filteredSongs = useMemo(() => songs.filter(song =>
    (song.title || '').toLowerCase().includes(debouncedQuery.toLowerCase()) ||
    (song.artist || '').toLowerCase().includes(debouncedQuery.toLowerCase()) ||
    (song.genre || '').toLowerCase().includes(debouncedQuery.toLowerCase())
  ), [songs, debouncedQuery]);

  const albums = useMemo(() => {
    const artistMap = new Map<string, Song[]>();
    songs.forEach(s => {
      const existing = artistMap.get(s.artist) || [];
      artistMap.set(s.artist, [...existing, s]);
    });
    const result: Album[] = [];
    let i = 0;
    for (const [artist, artistSongs] of artistMap) {
      if (artistSongs.length >= 2 && i < 12) {
        result.push({
          id: `lib-album-${i}`, title: `${artist} Collection`, artist,
          coverArt: artistSongs[0].coverArt, releaseYear: 2024,
          songIds: artistSongs.map(s => s.id), trackCount: artistSongs.length,
          duration: artistSongs.reduce((sum, s) => sum + (s.duration || 0), 0),
          genre: artistSongs[0].genre,
        });
        i++;
      }
    }
    return result;
  }, [songs]);

  const filteredAlbums = useMemo(() => albums.filter(a =>
    a.artist.toLowerCase().includes(debouncedQuery.toLowerCase()) || a.title.toLowerCase().includes(debouncedQuery.toLowerCase())
  ), [albums, debouncedQuery]);

  const handlePlayAlbum = (album: Album) => {
    const albumSongs = songs.filter(s => album.songIds.includes(s.id));
    if (albumSongs.length > 0) loadSong(albumSongs[0], albumSongs, 0);
  };

  const handlePlayPlaylist = (playlist: Playlist) => {
    const playlistSongs = songs.filter(s => playlist.songIds.includes(s.id));
    if (playlistSongs.length > 0) loadSong(playlistSongs[0], playlistSongs, 0);
  };

  const handleViewPlaylist = (playlist: Playlist) => {
    navigate(`/playlist/${playlist.id}`);
  };

  if (loading && songs.length === 0 && !shouldRetryFetch) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 rounded-full border-4 border-violet-500 border-t-transparent animate-spin mx-auto" />
          <p className="text-gray-400">Loading your library...</p>
        </div>
      </div>
    );
  }

  if (error || (loading && shouldRetryFetch)) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white mb-2">Failed to load library</h3>
            <p className="text-gray-400 text-sm mb-4">
              {error || `Loading timed out after ${retryTimeout / 1000}s. Unable to load your library.`}
            </p>
          </div>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={handleRetry}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 text-sm font-medium transition-all"
            >
              Try Again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white text-sm font-medium transition-all"
            >
              Reload App
            </button>
          </div>
          <p className="text-gray-600 text-xs">
            Retry attempts: {fetchRetries}/{maxRetries}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={goBack} className="p-2 rounded-xl hover:bg-white/5 transition-colors text-gray-400 hover:text-white" aria-label="Go back">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold text-white">Your Library</h1>
      </div>
      <div className="claymorphism p-6 rounded-2xl">
        <div className="relative max-w-2xl mx-auto">
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder={`Search ${songs.length} songs, artists, genres...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-3.5 rounded-xl border-2 border-white/5 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80 focus:ring-0 focus:border-purple-500 transition-all duration-300 outline-none"
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex space-x-1 claymorphism p-1 rounded-xl">
          {tabs.map((tab) => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={cn("px-5 py-2 rounded-lg transition-all duration-300 font-medium text-sm",
                activeTab === tab.key ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/25" : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              )}>
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center space-x-2">
          {[{ mode: 'list' as const, Icon: List }, { mode: 'grid' as const, Icon: Grid }].map(({ mode, Icon }) => (
            <button key={mode} onClick={() => setViewMode(mode)}
              className={cn("p-2.5 rounded-xl transition-all duration-300",
                viewMode === mode ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg" : "text-gray-600 dark:text-gray-400 claymorphism"
              )}>
              <Icon size={18} />
            </button>
          ))}
          {activeTab === 'playlists' && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => navigate('/create-playlist')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 text-white font-medium text-sm hover:shadow-lg hover:shadow-green-500/25 transition-all"
            >
              <Plus size={18} />
              <span>Create Playlist</span>
            </motion.button>
          )}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={activeTab} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.3 }} className="space-y-6">
          {activeTab === 'songs' && (
            <div className="claymorphism p-6 rounded-2xl">
              <h2 className="text-lg font-bold text-white mb-4">{filteredSongs.length} songs</h2>
              {filteredSongs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-3">
                    <Music2 size={28} className="text-gray-600" />
                  </div>
                  <p className="text-gray-400 font-medium mb-1">{searchQuery ? 'No songs match your search' : 'No songs in your library'}</p>
                  <p className="text-gray-600 text-sm">{searchQuery ? 'Try a different search term' : 'Browse Discover or Charts to find music'}</p>
                </div>
              ) : (
                <SongTable songs={filteredSongs} />
              )}
            </div>
          )}
          {activeTab === 'albums' && (
            <div className="claymorphism p-6 rounded-2xl">
              <h2 className="text-lg font-bold text-white mb-4">{filteredAlbums.length} albums</h2>
              {filteredAlbums.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-3">
                    <Grid size={28} className="text-gray-600" />
                  </div>
                  <p className="text-gray-400 font-medium mb-1">{searchQuery ? 'No albums match your search' : 'No albums yet'}</p>
                  <p className="text-gray-600 text-sm">{searchQuery ? 'Try a different search term' : 'Create an album to organize your music'}</p>
                </div>
              ) : (
                <AlbumGrid albums={filteredAlbums} onPlayAlbum={handlePlayAlbum} />
              )}
            </div>
          )}
          {activeTab === 'playlists' && (
            <div className="claymorphism p-6 rounded-2xl">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-white">{userPlaylists.length} playlists</h2>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => navigate('/create-playlist')}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 text-white font-medium text-sm hover:shadow-lg hover:shadow-green-500/25 transition-all"
                >
                  <Plus size={16} />
                  <span>New Playlist</span>
                </motion.button>
              </div>

              {userPlaylists.length === 0 ? (
                <div className="text-center py-12">
                  <Music2 className="w-16 h-16 mx-auto text-gray-600 dark:text-gray-500 mb-4" />
                  <p className="text-gray-400 mb-2">No playlists yet</p>
                  <p className="text-sm text-gray-500">Create your first playlist to organize your music</p>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => navigate('/create-playlist')}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 text-white font-medium hover:shadow-lg transition-all"
                  >
                    <Plus size={16} />
                    Create Playlist
                  </motion.button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {userPlaylists.map((pl) => (
                    <PlaylistCard key={pl.id} playlist={pl} onPlayPlaylist={handlePlayPlaylist} onViewPlaylist={handleViewPlaylist} />
                  ))}
                </div>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default LibraryPage;