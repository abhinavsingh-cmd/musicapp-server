import React, { memo, useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { useAudioStore } from '../../stores/audioStore';
import { useDownloadsStore } from '../../stores/downloadsStore';
import { Song } from '../../types/music';
import { cn } from '../../utils/cn';
import { Heart, Play, Pause, Clock, Download, Check, Loader2 } from 'lucide-react';

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

const SongRow = memo(({ song, index, isActive, isCurrentlyPlaying, onClick, onFavToggle, isFav, isDownloaded, isDownloading, onDownload }: {
  song: Song; index: number; isActive: boolean; isCurrentlyPlaying: boolean;
  onClick: () => void; onFavToggle: () => void; isFav: boolean;
  isDownloaded: boolean; isDownloading: boolean; onDownload: () => void;
}) => {
  return (
    <div
      className={cn("grid grid-cols-12 gap-4 px-6 py-2 text-sm cursor-pointer song-row", isActive && "bg-violet-500/10", "group transition-colors duration-100")}
      style={{ height: ROW_HEIGHT }}
      onClick={onClick}
    >
      <div className="col-span-1 flex items-center">
        {isCurrentlyPlaying ? <Equalizer /> : isActive ? <div className="text-violet-400"><Pause size={16} /></div> : (
          <div className="text-gray-500 group-hover:text-violet-400 transition-colors">
            <span className="group-hover:hidden">{index + 1}</span>
            <Play size={14} className="hidden group-hover:block" />
          </div>
        )}
      </div>
      <div className="col-span-5 flex items-center space-x-3 min-w-0">
        <img src={song.coverArt} alt="" loading="lazy" className={cn("w-10 h-10 rounded-lg object-cover flex-shrink-0 transition-all duration-200", isCurrentlyPlaying && "ring-2 ring-violet-500 ring-offset-1 ring-offset-[var(--color-bg)] shadow-md shadow-violet-500/20")} />
        <div className="min-w-0">
          <div className={cn("font-medium truncate transition-colors", isActive ? "text-violet-400" : "text-white")}>{song.title}</div>
          <div className="text-sm text-gray-400 truncate">{song.artist}</div>
        </div>
      </div>
      <div className="col-span-3 hidden md:flex items-center text-sm text-gray-500 truncate">{song.album}</div>
      <div className="col-span-2 hidden sm:flex items-center text-sm text-gray-500"><Clock size={12} className="mr-1" />{fmt(song.duration)}</div>
      <div className="col-span-1 flex items-center justify-end gap-1">
        <button
          onClick={(e) => { e.stopPropagation(); if (!isDownloaded && !isDownloading && song.youtubeId) onDownload(); }}
          disabled={isDownloaded || isDownloading || !song.youtubeId}
          className={cn("p-1.5 rounded-lg transition-all", isDownloaded ? "text-emerald-400 opacity-100" : isDownloading ? "text-violet-400 opacity-100" : "text-gray-500 opacity-0 group-hover:opacity-100 hover:text-violet-400 hover:bg-white/5")}
          title={isDownloaded ? "Downloaded" : isDownloading ? "Downloading..." : "Download"}
        >
          {isDownloaded ? <Check size={14} /> : isDownloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
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
    && prev.isFav === next.isFav
    && prev.isDownloaded === next.isDownloaded
    && prev.isDownloading === next.isDownloading;
});
SongRow.displayName = 'SongRow';

export const SongTable: React.FC<SongTableProps> = memo(({ songs, className }) => {
  const currentSongId = useAudioStore((s) => s.currentSong?.id ?? null);
  const isPlaying = useAudioStore((s) => s.isPlaying);
  const loadSong = useAudioStore((s) => s.loadSong);
  const togglePlayPause = useAudioStore((s) => s.togglePlayPause);
  const toggleFavorite = useAudioStore((s) => s.toggleFavorite);
  const favorites = useAudioStore((s) => s.favorites);
  const downloadSong = useDownloadsStore((s) => s.downloadSong);
  const downloads = useDownloadsStore((s) => s.downloads);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const rafRef = useRef<number>(0);

  const favSet = useMemo(() => new Set(favorites), [favorites]);

  const downloadsMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of downloads) {
      if (d.youtubeId) m.set(d.youtubeId, d.audioUrl);
    }
    return m;
  }, [downloads]);

  const downloadingSet = useDownloadsStore((s) => {
    const ids = new Set<string>();
    for (const id of s.downloadingIds) ids.add(id);
    return ids;
  });

  const downloadedSet = useDownloadsStore((s) => {
    const ids = new Set<string>();
    for (const d of s.downloads) ids.add(d.youtubeId);
    return ids;
  });

  const handleScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      if (containerRef.current) {
        setScrollTop(containerRef.current.scrollTop);
      }
      rafRef.current = 0;
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', handleScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [handleScroll]);

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
  const visibleCount = Math.min(songs.length - startIndex, Math.ceil(600 / ROW_HEIGHT) + BUFFER * 2);
  const visibleSongs = songs.slice(startIndex, startIndex + visibleCount);

  const handleRowClick = useCallback((song: Song, index: number) => {
    if (currentSongId === song.id) { togglePlayPause(); }
    else {
      const dl = downloadsMap.get(song.youtubeId ?? '');
      const songToPlay = dl ? { ...song, audioUrl: dl } : song;
      const playlist = songs.map(s => {
        const audio = downloadsMap.get(s.youtubeId ?? '');
        return audio ? { ...s, audioUrl: audio } : s;
      });
      loadSong(songToPlay, playlist, index);
    }
  }, [currentSongId, loadSong, togglePlayPause, songs, downloadsMap]);

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
                <SongRow key={song.id} song={song} index={actualIndex} isActive={isActive} isCurrentlyPlaying={isActive && isPlaying}
                  onClick={() => handleRowClick(song, actualIndex)} onFavToggle={() => toggleFavorite(song.id)} isFav={favSet.has(song.id)}
                  isDownloaded={song.youtubeId ? downloadedSet.has(song.youtubeId) : false} isDownloading={song.youtubeId ? downloadingSet.has(song.youtubeId) : false}
                  onDownload={() => downloadSong(song)} />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});
SongTable.displayName = 'SongTable';
