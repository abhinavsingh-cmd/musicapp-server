import React, { useEffect, useMemo } from 'react';
import { useDownloadsStore } from '../stores/downloadsStore';
import { useAudioStore } from '../stores/audioStore';
import { Song } from '../types/music';
import { Download, Trash2, Play, HardDrive, Loader2, WifiOff } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export const DownloadsPage: React.FC = () => {
  const downloads = useDownloadsStore((s) => s.downloads);
  const loading = useDownloadsStore((s) => s.loading);
  const loadDownloads = useDownloadsStore((s) => s.loadDownloads);
  const removeSong = useDownloadsStore((s) => s.removeSong);
  const isOnline = useDownloadsStore((s) => s.isOnline);
  const cacheSize = useDownloadsStore((s) => s.cacheSize);
  const progressMap = useDownloadsStore((s) => s.progressMap);
  const downloadingIds = useDownloadsStore((s) => s.downloadingIds);
  const loadSong = useAudioStore((s) => s.loadSong);
  const currentSong = useAudioStore((s) => s.currentSong);
  const isPlaying = useAudioStore((s) => s.isPlaying);

  useEffect(() => { loadDownloads(); }, [loadDownloads]);

  const handlePlay = (d: typeof downloads[0]) => {
    const song: Song = {
      id: d.id, youtubeId: d.youtubeId, title: d.title, artist: d.artist,
      genre: d.genre, duration: d.duration, coverArt: d.coverArt,
      album: '', audioUrl: d.audioUrl, releaseYear: 0,
    };
    const playlist = downloads.map(dl => ({
      id: dl.id, youtubeId: dl.youtubeId, title: dl.title, artist: dl.artist,
      genre: dl.genre, duration: dl.duration, coverArt: dl.coverArt,
      album: '', audioUrl: dl.audioUrl, releaseYear: 0,
    } as Song));
    loadSong(song, playlist, downloads.findIndex(dl => dl.id === d.id));
  };

  const formatSize = (bytes: number) => bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : (bytes / 1024).toFixed(0) + ' KB';
  const formatDuration = (s: number) => Math.floor(s / 60) + ':' + Math.floor(s % 60).toString().padStart(2, '0');
  const totalSize = useMemo(() => downloads.reduce((acc, d) => acc + d.size, 0), [downloads]);

  // Active downloads (in-progress)
  const activeDownloads = useMemo(() =>
    Array.from(downloadingIds).map(ytId => ({ youtubeId: ytId, progress: progressMap[ytId] })),
    [downloadingIds, progressMap]
  );

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-white flex items-center gap-3">
            <span className="p-2.5 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg shadow-violet-500/25">
              <Download size={22} className="text-white" />
            </span>
            Downloads
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            {downloads.length} songs · {formatSize(totalSize || cacheSize)}
          </p>
        </div>
        {!isOnline && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20">
            <WifiOff size={12} className="text-amber-400" />
            <span className="text-xs font-medium text-amber-300">Offline</span>
          </div>
        )}
      </div>

      {/* Active downloads with progress */}
      {activeDownloads.length > 0 && (
        <div className="space-y-2">
          {activeDownloads.map(({ youtubeId, progress }) => (
            <div key={youtubeId} className="flex items-center gap-3 p-3 rounded-xl bg-violet-500/5 border border-violet-500/10">
              <Loader2 size={16} className="animate-spin text-violet-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-gray-400 truncate">Downloading...</div>
                <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all duration-300"
                    style={{ width: `${progress?.percent || 0}%` }}
                  />
                </div>
              </div>
              <span className="text-xs text-gray-500 flex-shrink-0">{progress?.percent || 0}%</span>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-3 text-gray-400 py-12">
          <Loader2 size={20} className="animate-spin text-violet-400" />
          Loading downloads...
        </div>
      ) : downloads.length === 0 && activeDownloads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-20 h-20 rounded-3xl bg-[#1a1a2e] flex items-center justify-center mb-4">
            <HardDrive size={32} className="text-gray-600" />
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">No downloads yet</h3>
          <p className="text-gray-400 text-sm max-w-sm">
            Tap the download icon on any song to save it for offline listening.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {downloads.map((d, i) => {
              const isActive = currentSong?.id === d.id;
              return (
                <motion.div
                  key={d.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -100 }}
                  transition={{ delay: i * 0.02 }}
                  className={`flex items-center gap-3 p-3 rounded-xl transition-all group cursor-pointer ${isActive ? 'bg-violet-500/10' : 'hover:bg-white/5'}`}
                  onClick={() => handlePlay(d)}
                >
                  <div className="relative w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-[#1a1a2e]">
                    <img src={d.coverArt} alt={d.title} loading="lazy" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Play size={16} fill="white" className="text-white" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium truncate ${isActive ? 'text-violet-400' : 'text-white'}`}>{d.title}</div>
                    <div className="text-xs text-gray-400 truncate">{d.artist}</div>
                    <div className="flex items-center gap-2 text-[10px] text-gray-500 mt-0.5">
                      <span>{formatDuration(d.duration)}</span>
                      <span>·</span>
                      <span>{formatSize(d.size)}</span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeSong(d.id); }}
                    className="p-2 rounded-lg text-gray-500 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all"
                    title="Remove"
                  >
                    <Trash2 size={14} />
                  </button>
                  {isActive && isPlaying && (
                    <div className="playing-indicator text-violet-400 flex items-end gap-[2px] h-4">
                      {[1, 2, 3].map((i) => (
                        <span key={i} style={{ display: 'block', width: 3, background: 'currentColor', borderRadius: 2, animation: `eqBounce 0.8s ${i * 0.1}s infinite ease-in-out` }} />
                      ))}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};

export default DownloadsPage;
