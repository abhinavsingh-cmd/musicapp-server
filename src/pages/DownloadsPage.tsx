import React, { useEffect, useMemo, useCallback, useState, useRef } from 'react';
import { useGoBack } from '../hooks/useGoBack';
import { useVirtualList } from '../hooks/useVirtualList';
import { useDownloadsStore } from '../stores/downloadsStore';
import { useAudioStore } from '../stores/audioStore';
import { downloadEntryToSong } from '../services/musicSource';
import { Song } from '../types/music';
import {
  Download, Trash2, Play, HardDrive, Loader2, WifiOff, ArrowLeft, X, RotateCcw,
  AlertCircle, Pause, PlayCircle, ChevronUp, Database, Image, Info,
  Trash,
} from 'lucide-react';

function formatSize(bytes: number): string {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}

function formatDuration(s: number): string {
  return Math.floor(s / 60) + ':' + Math.floor(s % 60).toString().padStart(2, '0');
}

const EMPTY_DOWNLOADS: never[] = [];
const EMPTY_MAP: Record<string, unknown> = {};
const EMPTY_SET = new Set<string>();

// Downloaded-song rows: 48px thumb + p-3 padding = 72px tall, 4px gap → 76px
// stride. The list grows with every download, so it is windowed like the
// library — downloading many songs must not remount every row on each
// progress tick.
const DL_ROW_HEIGHT = 72;
const DL_STRIDE = 76;

const DownloadsPage: React.FC = () => {
  const goBack = useGoBack();
  const downloads = useDownloadsStore((s) => s.downloads) ?? EMPTY_DOWNLOADS;
  const loading = useDownloadsStore((s) => s.loading);
  const loadDownloads = useDownloadsStore((s) => s.loadDownloads);
  const removeSong = useDownloadsStore((s) => s.removeSong);
  const cancelDownload = useDownloadsStore((s) => s.cancelDownload);
  const pauseDownloadAction = useDownloadsStore((s) => s.pauseDownloadAction);
  const resumeDownloadAction = useDownloadsStore((s) => s.resumeDownloadAction);
  const retryDownload = useDownloadsStore((s) => s.retryDownload);
  const failedDownloads = useDownloadsStore((s) => s.failedDownloads);
  const clearFailed = useDownloadsStore((s) => s.clearFailed);
  const isOnline = useDownloadsStore((s) => s.isOnline);
  const cacheSize = useDownloadsStore((s) => s.cacheSize);
  const progressMap = useDownloadsStore((s) => s.progressMap) ?? EMPTY_MAP;
  const downloadingIds = useDownloadsStore((s) => s.downloadingIds) ?? EMPTY_SET;
  const pausedIds = useDownloadsStore((s) => s.pausedIds) ?? EMPTY_SET;
  const downloadQueue = useDownloadsStore((s) => s.downloadQueue);
  const storageBreakdown = useDownloadsStore((s) => s.storageBreakdown);
  const refreshStorageBreakdown = useDownloadsStore((s) => s.refreshStorageBreakdown);
  const clearDownloads = useDownloadsStore((s) => s.clearDownloads);
  const clearThumbnailCacheAction = useDownloadsStore((s) => s.clearThumbnailCacheAction);
  const loadSong = useAudioStore((s) => s.loadSong);
  const currentSong = useAudioStore((s) => s.currentSong);
  const isPlaying = useAudioStore((s) => s.isPlaying);

  const [showStorage, setShowStorage] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const dlListRef = useRef<HTMLDivElement>(null);
  const dlWin = useVirtualList(downloads.length, DL_STRIDE, dlListRef);

  useEffect(() => {
    loadDownloads();
    refreshStorageBreakdown();
  }, [loadDownloads, refreshStorageBreakdown]);

  const handlePlay = useCallback((d: typeof downloads[0]) => {
    const song: Song = downloadEntryToSong(d);
    const playlist = downloads.map(downloadEntryToSong) as Song[];
    loadSong(song, playlist, downloads.findIndex(dl => dl.id === d.id));
  }, [loadSong, downloads]);

  const handleRemove = useCallback((id: string) => {
    removeSong(id);
  }, [removeSong]);

  const totalSize = useMemo(() => downloads.reduce((acc, d) => acc + d.size, 0), [downloads]);

  const activeDownloads = useMemo(() =>
    Array.from(downloadingIds).map(ytId => ({
      youtubeId: ytId,
      progress: progressMap[ytId],
      isPaused: pausedIds.has(ytId),
    })),
    [downloadingIds, progressMap, pausedIds]
  );

  const currentSongId = currentSong?.id;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={goBack} className="p-2 rounded-xl hover:bg-white/5 transition-colors text-gray-400 hover:text-white" aria-label="Go back">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-2xl sm:text-3xl font-black text-white flex items-center gap-3">
            <span className="p-2.5 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg shadow-violet-500/25">
              <Download size={22} className="text-white" />
            </span>
            Downloads
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            {downloads.length} songs · {formatSize(downloads.length > 0 ? totalSize : 0)}{downloads.length === 0 && cacheSize > 1024*1024 ? ` · ${formatSize(cacheSize)} cache` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isOnline && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20">
              <WifiOff size={12} className="text-amber-400" />
              <span className="text-xs font-medium text-amber-300">Offline</span>
            </div>
          )}
          <button
            onClick={() => setShowStorage(!showStorage)}
            className="p-2 rounded-xl hover:bg-white/5 transition-colors text-gray-400 hover:text-white"
            title="Storage management"
          >
            <Database size={18} />
          </button>
        </div>
      </div>

      {/* Storage Management Panel */}
      {showStorage && (
        <div className="claymorphism rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <HardDrive size={14} /> Storage Management
            </h3>
            <button onClick={() => setShowStorage(false)} className="text-gray-500 hover:text-white">
              <ChevronUp size={14} />
            </button>
          </div>

          {storageBreakdown && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Songs</span>
                <span className="text-white font-medium">{formatSize(storageBreakdown.songs)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Thumbnails</span>
                <span className="text-white font-medium">{formatSize(storageBreakdown.thumbnails)}</span>
              </div>
              <div className="h-px bg-white/5" />
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400 font-medium">Total</span>
                <span className="text-white font-bold">{formatSize(storageBreakdown.total)}</span>
              </div>

              {/* Usage bar */}
              <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full flex">
                  <div
                    className="bg-gradient-to-r from-violet-500 to-fuchsia-500"
                    style={{ width: `${storageBreakdown.total > 0 ? (storageBreakdown.songs / storageBreakdown.total) * 100 : 0}%` }}
                  />
                  <div
                    className="bg-gradient-to-r from-blue-500 to-cyan-500"
                    style={{ width: `${storageBreakdown.total > 0 ? (storageBreakdown.thumbnails / storageBreakdown.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={clearThumbnailCacheAction}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-medium transition-all"
            >
              <Image size={12} /> Clear Thumbnails
            </button>
            <button
              onClick={() => setConfirmClear(true)}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium transition-all"
            >
              <Trash size={12} /> Clear All
            </button>
          </div>

          {confirmClear && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-center space-y-2">
              <p className="text-xs text-red-300">Delete all downloads? This cannot be undone.</p>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => { clearDownloads(); setConfirmClear(false); }}
                  className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-300 text-xs font-medium hover:bg-red-500/30"
                >
                  Yes, delete all
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  className="px-3 py-1.5 rounded-lg bg-white/5 text-gray-400 text-xs font-medium hover:bg-white/10"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Download Queue */}
      {downloadQueue.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-violet-400">
            <Info size={12} />
            Download Queue ({downloadQueue.length} waiting)
          </div>
          {downloadQueue.map((item, i) => (
            <div key={`${item.song.id}-${i}`} className="flex items-center gap-3 p-3 rounded-xl bg-violet-500/5 border border-violet-500/10">
              <div className="w-5 text-center text-xs text-gray-500">{i + 1}</div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-white truncate">{item.song.title}</div>
                <div className="text-[10px] text-gray-500 truncate">{item.song.artist}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Active Downloads */}
      {activeDownloads.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-violet-400">
            Downloading ({activeDownloads.filter(d => !d.isPaused).length} active, {activeDownloads.filter(d => d.isPaused).length} paused)
          </div>
          {activeDownloads.map(({ youtubeId, progress, isPaused }) => (
            <div key={youtubeId} className="flex items-center gap-3 p-3 rounded-xl bg-violet-500/5 border border-violet-500/10">
              {isPaused ? (
                <Pause size={16} className="text-amber-400 flex-shrink-0" />
              ) : (
                <Loader2 size={16} className="animate-spin text-violet-400 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs text-gray-400 truncate">
                  {isPaused ? 'Paused' : 'Downloading...'}
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
                    style={{ width: `${progress?.percent || 0}%`, transition: 'width 300ms ease' }}
                  />
                </div>
              </div>
              <span className="text-xs text-gray-500 flex-shrink-0 w-10 text-right">{progress?.percent || 0}%</span>
              <button
                onClick={() => isPaused ? resumeDownloadAction(youtubeId) : pauseDownloadAction(youtubeId)}
                className="p-1.5 rounded-lg text-gray-500 hover:text-amber-400 hover:bg-amber-500/10 transition-all flex-shrink-0"
                title={isPaused ? 'Resume' : 'Pause'}
              >
                {isPaused ? <PlayCircle size={14} /> : <Pause size={14} />}
              </button>
              <button
                onClick={() => cancelDownload(youtubeId)}
                className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-all flex-shrink-0"
                title="Cancel"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Failed Downloads */}
      {failedDownloads.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium text-red-400">
              <AlertCircle size={12} />
              Failed Downloads
            </div>
            <button onClick={clearFailed} className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors">
              Clear all
            </button>
          </div>
          {failedDownloads.map((f, i) => (
            <div key={`${f.song.id}-${i}`} className="flex items-center gap-3 p-3 rounded-xl bg-red-500/5 border border-red-500/10">
              <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white truncate">{f.song.title}</div>
                <div className="text-[10px] text-red-400/70 truncate">{f.message}</div>
              </div>
              {isOnline && (
                <button
                  onClick={() => retryDownload(f.song)}
                  className="p-1.5 rounded-lg text-violet-400 hover:bg-violet-500/10 transition-all flex-shrink-0"
                  title="Retry"
                >
                  <RotateCcw size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Downloaded List */}
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
        <div>
          <div className="text-xs font-medium text-gray-500 mb-2">
            {downloads.length} downloaded songs
          </div>
          <div ref={dlListRef} style={{ position: 'relative', height: dlWin.totalHeight }}>
          {downloads.slice(dlWin.start, dlWin.end).map((d, i) => {
            const index = dlWin.start + i;
            const isActive = currentSongId === d.id;
            return (
              <div
                key={d.id}
                style={{ position: 'absolute', top: index * DL_STRIDE, left: 0, right: 0, height: DL_ROW_HEIGHT }}
                className={`flex items-center gap-3 p-3 rounded-xl transition-colors group cursor-pointer ${isActive ? 'bg-violet-500/10' : 'hover:bg-white/5'}`}
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
                onClick={(e) => { e.stopPropagation(); handleRemove(d.id); }}
                className="p-2 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-all sm:opacity-0 sm:group-hover:opacity-100"
                title="Remove"
              >
                <Trash2 size={14} />
              </button>
                {isActive && isPlaying && (
                  <div className="playing-indicator text-violet-400 flex items-end gap-[2px] h-4">
                    {[1, 2, 3].map((i) => (
                      <span key={i} className="eq-bar" style={{ display: 'block', width: 3, background: 'currentColor', borderRadius: 2, animationDelay: `${i * 0.1}s` }} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          </div>
        </div>
      )}
    </div>
  );
};

export default DownloadsPage;
