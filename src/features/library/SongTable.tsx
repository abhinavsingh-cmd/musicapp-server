import React, { memo, useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAudioStore } from '../../stores/audioStore';
import { useDownloadsStore } from '../../stores/downloadsStore';
import { Song } from '../../types/music';
import { cn } from '../../utils/cn';
import { Heart, Play, Pause, Clock, Download, Check, X, AlertTriangle } from 'lucide-react';
import CachedImage from '../../components/CachedImage';
import { useSongContextMenu } from '../../components/SongContextMenu';

interface SongTableProps {
  songs: Song[];
  className?: string;
}

const ROW_HEIGHT = 56;
const BUFFER = 10;

const Equalizer: React.FC = memo(() => (
  <div className="playing-indicator text-violet-400 flex items-end gap-[2px] h-4">
    {[1, 2, 3, 4].map((i) => (
      <span key={i} className="eq-bar" style={{ display: 'block', width: 3, background: 'currentColor', borderRadius: 2, animationDelay: `${i * 0.1}s` }} />
    ))}
  </div>
));
Equalizer.displayName = 'Equalizer';

const fmt = (s: number) => Math.floor(s / 60) + ':' + Math.floor(s % 60).toString().padStart(2, '0');

const SongRow = memo(({ song, index, isActive, isCurrentlyPlaying, isLoading, onClick, onFavToggle, isFav, isDownloaded, isDownloading, onDownload, onCancelDownload, onContextMenu, onTouchStart }: {
  song: Song; index: number; isActive: boolean; isCurrentlyPlaying: boolean; isLoading: boolean;
  onClick: () => void; onFavToggle: () => void; isFav: boolean;
  isDownloaded: boolean; isDownloading: boolean; onDownload: () => void; onCancelDownload: () => void;
  onContextMenu: (e: React.MouseEvent) => void; onTouchStart: (e: React.TouchEvent) => void;
}) => {
  return (
    <div
      className={cn("grid grid-cols-12 gap-4 px-6 py-2 text-sm cursor-pointer song-row", isActive && "bg-violet-500/10", "group transition-colors duration-100")}
      style={{ height: ROW_HEIGHT }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onTouchStart={onTouchStart}
    >
      <div className="col-span-1 flex items-center">
        {isCurrentlyPlaying ? <Equalizer /> : isActive && isLoading ? (
          <div className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
        ) : isActive ? <div className="text-violet-400"><Pause size={16} /></div> : (
          <div className="text-gray-500 group-hover:text-violet-400 transition-colors">
            <span className="group-hover:hidden">{index + 1}</span>
            <Play size={14} className="hidden group-hover:block" />
          </div>
        )}
      </div>
      <div className="col-span-5 flex items-center space-x-3 min-w-0">
        <CachedImage src={song.coverArt} alt="" className={cn("w-10 h-10 rounded-lg object-cover flex-shrink-0 transition-all duration-200", isCurrentlyPlaying && "ring-2 ring-violet-500 ring-offset-1 ring-offset-[var(--color-bg)] shadow-md shadow-violet-500/20")} />
        <div className="min-w-0">
          <div className={cn("font-medium truncate transition-colors", isActive ? "text-violet-400" : "text-white")}>{song.title}</div>
          <div className="text-sm text-gray-400 truncate">{song.artist}</div>
        </div>
      </div>
      <div className="col-span-3 hidden md:flex items-center text-sm text-gray-500 truncate">{song.album}</div>
      <div className="col-span-2 hidden sm:flex items-center text-sm text-gray-500"><Clock size={12} className="mr-1" />{fmt(song.duration)}</div>
      <div className="col-span-1 flex items-center justify-end gap-1">
        <button
          onClick={(e) => { e.stopPropagation(); if (isDownloading) onCancelDownload(); else if (!isDownloaded) onDownload(); }}
          disabled={isDownloaded && !isDownloading}
          className={cn("p-1.5 rounded-lg transition-all", isDownloaded ? "text-emerald-400 opacity-100" : isDownloading ? "text-violet-400 opacity-100" : "text-gray-500 opacity-0 group-hover:opacity-100 hover:text-violet-400 hover:bg-white/5")}
          title={isDownloaded ? "Downloaded" : isDownloading ? "Cancel download" : "Download"}
        >
          {isDownloaded ? <Check size={14} /> : isDownloading ? <X size={14} /> : <Download size={14} />}
        </button>
        <button className={cn("transition-all duration-200 p-1.5 rounded-lg", isFav ? "text-red-500" : "text-gray-500 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-white/5")} onClick={(e) => { e.stopPropagation(); onFavToggle(); }}>
          <Heart size={14} fill={isFav ? "currentColor" : "none"} />
        </button>
      </div>
    </div>
  );
}, (prev, next) => {
  return prev.song.id === next.song.id
    && prev.index === next.index
    && prev.isActive === next.isActive
    && prev.isCurrentlyPlaying === next.isCurrentlyPlaying
    && prev.isLoading === next.isLoading
    && prev.isFav === next.isFav
    && prev.isDownloaded === next.isDownloaded
    && prev.isDownloading === next.isDownloading;
});
SongRow.displayName = 'SongRow';

interface RetryState {
  lastRetryTime: number;
  retryCount: number;
  isRetrying: boolean;
  error: string | null;
  timeout: number;
}

const RETRY_TIMEOUT_MS = 30_000;
const MAX_RETRY_ATTEMPTS = 3;

export const SongTable: React.FC<SongTableProps> = memo(({ songs, className }) => {
  const navigate = useNavigate();
  const currentSongId = useAudioStore((s) => s.currentSong?.id ?? null);
  const isPlaying = useAudioStore((s) => s.isPlaying);
  const isLoading = useAudioStore((s) => s.isLoading);
  const loadSong = useAudioStore((s) => s.loadSong);
  const togglePlayPause = useAudioStore((s) => s.togglePlayPause);
  const toggleFavorite = useAudioStore((s) => s.toggleFavorite);
  const favorites = useAudioStore((s) => s.favorites);
  const downloadSong = useDownloadsStore((s) => s.downloadSong);
  const cancelDownload = useDownloadsStore((s) => s.cancelDownload);
  const downloads = useDownloadsStore((s) => s.downloads);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const rafRef = useRef<number>(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryStateRef = useRef<RetryState>({
    lastRetryTime: 0,
    retryCount: 0,
    isRetrying: false,
    error: null,
    timeout: RETRY_TIMEOUT_MS
  });

  const { handleContextMenu, handleLongPress, ContextMenu } = useSongContextMenu(
    (artist) => navigate(`/search?q=${encodeURIComponent(artist)}`),
    (album) => navigate(`/search?q=${encodeURIComponent(album)}`),
  );

  const favSet = useMemo(() => new Set(favorites), [favorites]);

  const downloadsMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of downloads) {
      if (d.youtubeId) m.set(d.youtubeId, d.audioUrl);
    }
    return m;
  }, [downloads]);

  const downloadingIds = useDownloadsStore((s) => s.downloadingIds);

  const downloadingSet = useMemo(() => {
    const ids = new Set<string>();
    for (const id of downloadingIds) ids.add(id);
    return ids;
  }, [downloadingIds]);

  const downloadedSet = useMemo(() => {
    const ids = new Set<string>();
    for (const d of downloads) ids.add(d.youtubeId);
    return ids;
  }, [downloads]);

  const handleScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      if (containerRef.current) {
        setScrollTop(containerRef.current.scrollTop);
      }
      rafRef.current = 0;
    });
  }, [containerRef]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', handleScroll);
      observer.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [handleScroll, containerRef]);

  useEffect(() => {
    if (isLoading && songs.length === 0) {
      retryStateRef.current = {
        ...retryStateRef.current,
        lastRetryTime: Date.now(),
        error: null,
        isRetrying: false
      };
    }
  }, [isLoading, songs.length]);

  const shouldShowRetry = useMemo(() => {
    const state = retryStateRef.current;
    const now = Date.now();
    const timeSinceLastRetry = now - state.lastRetryTime;
    const isTimeout = timeSinceLastRetry >= state.timeout;
    const maxRetriesReached = state.retryCount >= MAX_RETRY_ATTEMPTS;
    
    return songs.length === 0 && isLoading && (isTimeout || maxRetriesReached);
  }, [songs.length, isLoading]);

  const handleRetry = useCallback(() => {
    retryStateRef.current = {
      ...retryStateRef.current,
      isRetrying: true,
      error: null
    };
    
    timeoutRef.current = setTimeout(() => {
      retryStateRef.current = {
        ...retryStateRef.current,
        isRetrying: false,
        retryCount: retryStateRef.current.retryCount + 1,
        lastRetryTime: Date.now()
      };
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('retry-library'));
      }
    }, 1000);
  }, []);

  const handleTimeout = useCallback(() => {
    retryStateRef.current = {
      ...retryStateRef.current,
      error: `Loading timed out after ${RETRY_TIMEOUT_MS / 1000}s. Unable to load your library.`,
      isRetrying: false
    };
    
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  useEffect(() => {
    if (shouldShowRetry && !retryStateRef.current.isRetrying) {
      handleTimeout();
    }
  }, [shouldShowRetry, handleTimeout]);

  const startIndex = useMemo(() => {
    return Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
  }, [scrollTop]);

  const visibleCount = useMemo(() => {
    return Math.min(songs.length - startIndex, Math.ceil(containerHeight / ROW_HEIGHT) + BUFFER * 2);
  }, [songs.length, startIndex, containerHeight]);

  const visibleSongs = useMemo(() => {
    return songs.slice(startIndex, startIndex + visibleCount);
  }, [songs, startIndex, visibleCount]);

  const isLoadingRef = useRef(false);

  const handleRowClick = useCallback((song: Song, index: number) => {
    if (isLoadingRef.current) return;
    if (currentSongId === song.id) { togglePlayPause(); }
    else {
      const dl = downloadsMap.get(song.youtubeId ?? '');
      const songToPlay = dl ? { ...song, audioUrl: dl } : song;
      isLoadingRef.current = true;
      loadSong(songToPlay, songs, index);
      setTimeout(() => { isLoadingRef.current = false; }, 500);
    }
  }, [currentSongId, loadSong, togglePlayPause, songs]);

  if (songs.length === 0 && isLoading && !shouldShowRetry) {
    return (
      <div className={cn("w-full flex items-center justify-center py-16", className)}>
        <div className="text-center space-y-4">
          <div className="w-12 h-12 rounded-full border-4 border-violet-500 border-t-transparent animate-spin mx-auto" />
          <p className="text-gray-400">Loading your library...</p>
        </div>
      </div>
    );
  }

  if (songs.length === 0 && retryStateRef.current.error && !retryStateRef.current.isRetrying) {
    return (
      <div className={cn("w-full flex items-center justify-center py-16", className)}>
        <div className="max-w-md w-full text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white mb-2">Failed to load library</h3>
            <p className="text-gray-400 text-sm mb-4">{retryStateRef.current.error}</p>
          </div>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={handleRetry}
              disabled={retryStateRef.current.isRetrying}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 text-sm font-medium transition-all disabled:opacity-50"
            >
              {retryStateRef.current.isRetrying ? (
                <div className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                "Try Again"
              )}
            </button>
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white text-sm font-medium transition-all"
            >
              Reload App
            </button>
          </div>
          <p className="text-gray-600 text-xs">
            Retry attempts: {retryStateRef.current.retryCount}/{MAX_RETRY_ATTEMPTS}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)}>
      <div className="grid grid-cols-12 gap-4 px-6 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500 border-b border-white/5">
        <div className="col-span-1">#</div>
        <div className="col-span-5">TITLE</div>
        <div className="col-span-3 hidden md:block">ALBUM</div>
        <div className="col-span-2 hidden sm:block">DURATION</div>
        <div className="col-span-1 text-right"><Download size={14} className="inline" /></div>
      </div>
      <div ref={containerRef} style={{ maxHeight: '70vh', overflowY: 'auto' }}>
        <div style={{ height: songs.length * ROW_HEIGHT, position: 'relative' }}>
          <div style={{ transform: `translateY(${startIndex * ROW_HEIGHT}px)` }}>
            {visibleSongs.map((song, i) => {
              const actualIndex = startIndex + i;
              const isActive = currentSongId === song.id;
              return (
                <SongRow key={song.id} song={song} index={actualIndex} isActive={isActive} isCurrentlyPlaying={isActive && isPlaying} isLoading={isActive && isLoading}
                  onClick={() => handleRowClick(song, actualIndex)} onFavToggle={() => toggleFavorite(song.id)} isFav={favSet.has(song.id)}
                  isDownloaded={song.youtubeId ? downloadedSet.has(song.youtubeId) : false} isDownloading={song.youtubeId ? downloadingSet.has(song.youtubeId) : false}
                  onDownload={() => downloadSong(song)} onCancelDownload={() => song.youtubeId && cancelDownload(song.youtubeId)}
                  onContextMenu={(e) => handleContextMenu(e, song)} onTouchStart={(e) => handleLongPress(e, song)} />
              );
            })}
          </div>
        </div>
      </div>
      <ContextMenu />
    </div>
  );
});
SongTable.displayName = 'SongTable';
