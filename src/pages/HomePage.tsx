import React, { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { useAudioStore } from '../stores/audioStore';
import { useSongsStore } from '../stores/songsStore';
import { SongTable } from '../features/library/SongTable';
import { PlaylistDetail } from '../features/playlist/PlaylistDetail';
import { Song, Playlist } from '../types/music';
import { trendingService, getInitialTrending, fetchYouTubeTrending } from '../services/trendingService';
import { motion, AnimatePresence } from 'framer-motion';
import { Disc3, TrendingUp, Play, Music, Sparkles, Radio, Zap, Globe, RefreshCw } from 'lucide-react';
import { performanceMonitor } from '../utils/performanceMonitor';
import { renderMonitor } from '../utils/renderMonitor';
import { logger } from '../utils/logger';

const INITIAL_DEFER_MS = 1500;

const SkeletonBlock: React.FC<{ className?: string }> = ({ className }) => (
  <div className={`animate-pulse rounded-xl bg-white/5 ${className || ''}`} />
);

const HERO_GRADIENTS = [
  'from-violet-600 via-fuchsia-500 to-orange-400',
  'from-indigo-600 via-violet-500 to-fuchsia-500',
  'from-blue-600 via-indigo-500 to-cyan-400',
  'from-rose-600 via-pink-500 to-violet-500',
];

const HeroSection = memo(({ songCount, onPlayAll, onPlayTrending }: { songCount: number; onPlayAll: () => void; onPlayTrending: () => void }) => {
  const [heroIdx, setHeroIdx] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setHeroIdx(i => (i + 1) % HERO_GRADIENTS.length), 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="relative overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.div
          key={heroIdx}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1, ease: 'easeInOut' }}
          className={`absolute inset-0 bg-gradient-to-br ${HERO_GRADIENTS[heroIdx]}`}
        />
      </AnimatePresence>
      
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/40" />
      
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-10 left-10 w-40 h-40 rounded-full bg-white/10 blur-2xl will-transform" />
        <div className="absolute bottom-10 right-20 w-56 h-56 rounded-full bg-white/5 blur-3xl will-transform" />
        <div className="absolute top-1/2 left-1/2 w-32 h-32 rounded-full bg-violet-500/20 blur-2xl will-transform" />
      </div>
      
      <motion.div 
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="relative z-10 px-4 sm:px-8 py-12 sm:py-16 max-w-2xl will-transform"
      >
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 text-white/90 text-sm font-medium mb-4 sm:mb-6 will-transform"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <Sparkles size={14} className="text-violet-300" />
          <span>{songCount} songs + live YouTube trending</span>
        </motion.div>
        
        <motion.h1 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="text-3xl sm:text-5xl font-black text-white mb-3 sm:mb-4 leading-tight will-transform"
        >
          Your Music,<br />
          <span className="text-gradient-aurora">Your Mood</span>
        </motion.h1>
        
        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="text-white/70 text-sm sm:text-lg mb-6 sm:mb-8 max-w-md will-transform"
        >
          Stream trending hits from YouTube, discover new artists, create playlists.
        </motion.p>
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="flex gap-3 will-transform"
        >
          <motion.button
            whileHover={{ scale: 1.05, boxShadow: '0 20px 40px rgba(255, 255, 255, 0.2)' }}
            whileTap={{ scale: 0.95 }}
            onClick={onPlayAll}
            className="flex items-center gap-2 px-6 sm:px-8 py-3 sm:py-3.5 rounded-full bg-white text-gray-900 font-bold text-sm sm:text-base transition-all duration-300 will-transform"
          >
            <Play size={18} fill="currentColor" />
            Play All
          </motion.button>
          
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onPlayTrending}
            className="flex items-center gap-2 px-6 sm:px-8 py-3 sm:py-3.5 rounded-full bg-white/10 text-white font-bold text-sm sm:text-base transition-all duration-300 will-transform"
          >
            <Zap size={18} />
            Trending
          </motion.button>
        </motion.div>
      </motion.div>
    </div>
  );
});
HeroSection.displayName = 'HeroSection';

const initialTrending = getInitialTrending();

export const HomePage: React.FC = memo(() => {
  const renderStart = performance.now();

  useEffect(() => {
    performanceMonitor.trackRender('HomePage', performance.now() - renderStart);
    renderMonitor.trackRender('HomePage', performance.now() - renderStart);
  });
  const songs = useSongsStore((s) => s.songs);
  const [trending, setTrending] = useState<Song[]>(initialTrending.songs);
  const [trendingLoading, setTrendingLoading] = useState(false);
  const [trendingSource, setTrendingSource] = useState<string>(initialTrending.source);
  const [trendingLastUpdated, setTrendingLastUpdated] = useState<number | null>(initialTrending.lastUpdated);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const loadSong = useAudioStore((s) => s.loadSong);

  // Initialize trending service and start background refresh
  useEffect(() => {
    trendingService.init();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const defer = typeof requestIdleCallback === 'function'
      ? requestIdleCallback
      : (cb: IdleRequestCallback) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 0);

    // Initial refresh after 1.5 seconds — keeps previous data visible while loading
    defer(() => {
      if (cancelled) return;
      timeoutId = setTimeout(() => {
        if (cancelled) return;
        logger.debug('[HomePage] Fetching trending after deferred load...');
        setTrendingLoading(true);
        fetchYouTubeTrending()
          .then(result => {
            if (cancelled) return;
            logger.debug(`[HomePage] Trending loaded: ${result.songs.length} songs, source=${result.source}`);
            setTrending(result.songs);
            setTrendingSource(result.source);
            setTrendingLastUpdated(result.lastUpdated);
            setTrendingLoading(false);
          })
          .catch(() => {
            // On failure, keep previous data visible — just stop loading
            logger.warn('[HomePage] Trending fetch failed, keeping previous data');
            if (!cancelled) setTrendingLoading(false);
          });
      }, INITIAL_DEFER_MS);
    });

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  const loadTrending = useCallback(() => {
    let cancelled = false;
    setTrendingLoading(true);
    fetchYouTubeTrending()
      .then(result => {
        if (!cancelled) {
          setTrending(result.songs);
          setTrendingSource(result.source);
          setTrendingLastUpdated(result.lastUpdated);
          setTrendingLoading(false);
        }
      })
      .catch(() => {
        // On failure, keep previous data visible — just stop loading
        if (!cancelled) setTrendingLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const playlists = useMemo(() => {
    if (songs.length === 0) return [];
    const genres = [...new Set(songs.map(s => s.genre))];
    return genres.slice(0, 8).map((genre, i) => {
      const gSongs = songs.filter(s => s.genre === genre).slice(0, 50);
      const emoji = ['🎵', '🎸', '🎤', '🎧', '🎶', '🎙️', '🎹', '🎷'][i % 8];
      return {
        id: `pl-${i}`,
        name: `${genre} Hits`,
        description: `Best ${genre} songs`,
        coverArt: gSongs[0]?.coverArt || '',
        songIds: gSongs.map(s => s.id),
        trackCount: gSongs.length,
        duration: gSongs.reduce((sum, s) => sum + (s.duration || 0), 0),
        createdAt: new Date().toISOString(),
        isPublic: false,
        emoji,
        gradient: HERO_GRADIENTS[i % HERO_GRADIENTS.length],
      } as Playlist & { emoji: string; gradient: string };
    });
  }, [songs]);

  const topArtists = useMemo(() => {
    const map = new Map<string, { count: number; song: Song }>();
    songs.forEach(s => {
      const existing = map.get(s.artist);
      if (!existing || (s.playCount || 0) > (existing.song.playCount || 0)) {
        map.set(s.artist, { count: (existing?.count || 0) + 1, song: s });
      }
    });
    return Array.from(map.entries())
      .filter(([_, v]) => v.count >= 2)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([artist, v]) => ({ artist, coverArt: v.song.coverArt, songCount: v.count }));
  }, [songs]);

  const filteredSongs = useMemo(() => {
    if (!selectedArtist) return songs;
    return songs.filter(s => s.artist === selectedArtist);
  }, [songs, selectedArtist]);

  const handlePlayAll = useCallback(() => {
    const allSongs = [...songs].sort(() => 0.5 - Math.random()).slice(0, 50);
    if (allSongs.length > 0) loadSong(allSongs[0], allSongs, 0);
  }, [songs, loadSong]);

  const handlePlayTrending = useCallback(() => {
    if (trending.length > 0) loadSong(trending[0], trending, 0);
  }, [trending, loadSong]);

  const handlePlayArtist = useCallback((artist: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const artistSongs = songs.filter(s => s.artist === artist);
    if (artistSongs.length > 0) loadSong(artistSongs[0], artistSongs, 0);
  }, [songs, loadSong]);

  const handleArtistClick = useCallback((artist: string) => {
    setSelectedArtist(prev => prev === artist ? null : artist);
  }, []);

  const handlePlayPlaylist = useCallback((playlist: any) => {
    setSelectedPlaylist(playlist);
  }, []);

  return (
    <div className="pb-8">
      <HeroSection songCount={songs.length} onPlayAll={handlePlayAll} onPlayTrending={handlePlayTrending} />

      <div className="px-4 sm:px-6 space-y-8 sm:space-y-10 mt-6 sm:mt-8">

        <section>
          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2 sm:gap-3">
              <span className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl bg-gradient-to-br from-red-500 to-orange-500 shadow-lg shadow-red-500/25">
                <TrendingUp size={18} className="text-white sm:w-5 sm:h-5" />
              </span>
              Trending Now
            </h2>
            <div className="flex items-center gap-3">
              {trendingLastUpdated && !trendingLoading && (
                <span className="text-xs text-gray-500 flex items-center gap-1">
                  <Globe size={12} className="text-red-400" />
                   {trendingSource === 'LIVE' ? 'Live from YouTube' :
                   trendingSource === 'CACHED' ? 'Cached' :
                   trendingSource === 'LIBRARY' ? 'From Library' :
                   trendingSource === 'BUILT_IN' ? 'Offline' : 'Loading'}
                  {' · '}
                  {(() => {
                    const diff = Date.now() - trendingLastUpdated;
                    if (diff < 60000) return 'Just now';
                    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
                    return `${Math.floor(diff / 3600000)}h ago`;
                  })()}
                </span>
              )}
              <button
                onClick={loadTrending}
                disabled={trendingLoading}
                className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-gray-400 hover:text-white disabled:opacity-50"
                title="Refresh trending"
              >
                <RefreshCw size={14} className={trendingLoading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
          {trendingLoading && trending.length === 0 ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map(i => (
                <SkeletonBlock key={i} className="h-14 w-full rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="bg-white/10 rounded-xl sm:rounded-2xl p-1 sm:p-2">
              <SongTable songs={trending} />
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2 sm:gap-3">
              <span className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg shadow-violet-500/25">
                <Music size={18} className="text-white sm:w-5 sm:h-5" />
              </span>
              Playlists
            </h2>
          </div>
          {playlists.length === 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {[1, 2, 3, 4].map(i => (
                <SkeletonBlock key={i} className="aspect-square rounded-2xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {playlists.map((pl) => (
                <div
                  key={pl.id}
                  onClick={() => handlePlayPlaylist(pl)}
                  className="group cursor-pointer bg-white/10 rounded-xl sm:rounded-2xl p-3 sm:p-4 transition-all duration-300 hover:scale-[1.03] hover:-translate-y-1"
                >
                  <div className={`w-full aspect-square rounded-lg sm:rounded-xl bg-gradient-to-br ${pl.gradient} mb-2 sm:mb-3 flex items-center justify-center shadow-lg relative overflow-hidden`}>
                    <span className="text-2xl sm:text-4xl">{pl.emoji}</span>
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 transition-all duration-300 shadow-xl">
                        <Play size={16} fill="currentColor" className="text-gray-900 ml-0.5 sm:w-5 sm:h-5" />
                      </div>
                    </div>
                  </div>
                  <h3 className="font-bold text-white text-xs sm:text-sm truncate">{pl.name}</h3>
                  <p className="text-[10px] sm:text-xs text-gray-400 mt-0.5">{pl.trackCount} songs</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {topArtists.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4 sm:mb-6">
              <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2 sm:gap-3">
                <span className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl bg-gradient-to-br from-orange-500 to-red-500 shadow-lg shadow-orange-500/25">
                  <Radio size={18} className="text-white sm:w-5 sm:h-5" />
                </span>
                Top Artists
              </h2>
              {selectedArtist && (
                <button
                  onClick={() => setSelectedArtist(null)}
                  className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                >
                  Clear filter
                </button>
              )}
            </div>
            <div className="flex gap-4 sm:gap-5 overflow-x-auto pb-4 -mx-2 px-2" style={{scrollbarWidth:'none',msOverflowStyle:'none',WebkitOverflowScrolling:'touch'}}>
              {topArtists.map((a) => (
                <div 
                  key={a.artist}
                  className={`flex-shrink-0 text-center group cursor-pointer transition-transform hover:scale-105 hover:-translate-y-1 ${selectedArtist === a.artist ? 'ring-2 ring-violet-500 rounded-full' : ''}`}
                >
                  <div className="relative mb-2">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full overflow-hidden mx-auto bg-white/10 p-1 group-hover:shadow-glow transition-all duration-300" onClick={() => handleArtistClick(a.artist)}>
                      <img 
                        src={a.coverArt} 
                        alt={a.artist} 
                        className="w-full h-full rounded-full object-cover" 
                        loading="lazy" 
                      />
                    </div>
                    <button
                      onClick={(e) => handlePlayArtist(a.artist, e)}
                      className="absolute bottom-0 right-0 w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-violet-500 flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-all duration-200 translate-y-1 group-hover:translate-y-0"
                      title={`Play ${a.artist}`}
                    >
                      <Play size={10} fill="white" className="text-white ml-0.5" />
                    </button>
                  </div>
                  <p className="text-[10px] sm:text-xs font-semibold text-white truncate max-w-[70px] sm:max-w-[80px]">{a.artist}</p>
                  <p className="text-[9px] sm:text-[10px] text-gray-500">{a.songCount} songs</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2 sm:gap-3">
              <span className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 shadow-lg shadow-emerald-500/25">
                <Disc3 size={18} className="text-white sm:w-5 sm:h-5" />
              </span>
              {selectedArtist ? `Songs by ${selectedArtist}` : 'All Songs'}
            </h2>
            <span className="text-xs sm:text-sm text-gray-400 font-medium">{filteredSongs.length} tracks</span>
          </div>
          {filteredSongs.length === 0 ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <SkeletonBlock key={i} className="h-14 w-full rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="bg-white/10 rounded-xl sm:rounded-2xl p-1 sm:p-2">
              <SongTable songs={filteredSongs} />
            </div>
          )}
        </section>
      </div>

      <AnimatePresence>
        {selectedPlaylist && (
          <PlaylistDetail
            playlist={selectedPlaylist}
            onClose={() => setSelectedPlaylist(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
});
HomePage.displayName = 'HomePage';

export default HomePage;
