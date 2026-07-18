import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAudioStore } from '../stores/audioStore';
import { usePlaylistStore } from '../stores/playlistStore';
import { SongTable } from '../features/library/SongTable';
import { AlbumGrid } from '../features/album/AlbumGrid';
import { PlaylistCard } from '../features/playlist/PlaylistCard';
import { cn } from '../utils/cn';
import { Search, List, Grid, Plus, Music2 } from 'lucide-react';
import { Album, Song, Playlist } from '../types/music';
import { AnimatePresence, motion } from 'framer-motion';
import { fetchSongs } from '../services/musicApi';

const tabs = [
  { key: 'songs' as const, label: 'Songs' },
  { key: 'albums' as const, label: 'Albums' },
  { key: 'playlists' as const, label: 'Playlists' },
];

export const LibraryPage: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'songs' | 'albums' | 'playlists'>('songs');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const loadSong = useAudioStore((s) => s.loadSong);
  const { playlists: userPlaylists } = usePlaylistStore();
  const navigate = useNavigate();

  useEffect(() => {
    fetchSongs().then(s => { setSongs(s); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const filteredSongs = useMemo(() => songs.filter(song =>
    (song.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (song.artist || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (song.genre || '').toLowerCase().includes(searchQuery.toLowerCase())
  ), [songs, searchQuery]);

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
          duration: artistSongs.reduce((sum, s) => sum + s.duration, 0),
          genre: artistSongs[0].genre,
        });
        i++;
      }
    }
    return result;
  }, [songs]);

  const filteredAlbums = useMemo(() => albums.filter(a =>
    a.artist.toLowerCase().includes(searchQuery.toLowerCase()) || a.title.toLowerCase().includes(searchQuery.toLowerCase())
  ), [albums, searchQuery]);

  const handlePlayAlbum = (album: Album) => {
    const albumSongs = songs.filter(s => album.songIds.includes(s.id));
    if (albumSongs.length > 0) loadSong(albumSongs[0], albumSongs, 0);
  };

  const handlePlayPlaylist = (playlist: Playlist) => {
    const playlistSongs = songs.filter(s => playlist.songIds.includes(s.id));
    if (playlistSongs.length > 0) loadSong(playlistSongs[0], playlistSongs, 0);
  };

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-gray-400">Loading songs...</div>;
  }

  return (
    <div className="p-6 space-y-6">
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
              <SongTable songs={filteredSongs} />
            </div>
          )}
          {activeTab === 'albums' && (
            <div className="claymorphism p-6 rounded-2xl">
              <h2 className="text-lg font-bold text-white mb-4">{filteredAlbums.length} albums</h2>
              <AlbumGrid albums={filteredAlbums} onPlayAlbum={handlePlayAlbum} />
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
                    <PlaylistCard key={pl.id} playlist={pl} onPlayPlaylist={handlePlayPlaylist} />
                  ))}
                </div>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
      <div className="pb-20" />
    </div>
  );
};

export default LibraryPage;