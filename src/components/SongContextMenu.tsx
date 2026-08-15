import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Song } from '../types/music';
import { useAudioStore } from '../stores/audioStore';
import { useQueueStore } from '../stores/queueStore';
import { useSongDownloadState } from './DownloadButton';
import { usePlaylistStore } from '../stores/playlistStore';
import { favoriteKey } from '../utils/songIds';
import { buildShareUrl } from '../services/musicSource';
import {
  X, Heart, Download, Share2, ListPlus, SkipForward,
  Clock, User, Disc3, Check, RotateCw
} from 'lucide-react';

interface SongContextMenuProps {
  song: Song | null;
  position: { x: number; y: number } | null;
  onClose: () => void;
  onArtistClick?: (artist: string) => void;
  onAlbumClick?: (album: string) => void;
}

export default function SongContextMenu({ song, position, onClose, onArtistClick, onAlbumClick }: SongContextMenuProps) {
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggleFavorite = useAudioStore((s) => s.toggleFavorite);
  const favorites = useAudioStore((s) => s.favorites);
  const addNext = useQueueStore((s) => s.addNext);
  const addToQueue = useQueueStore((s) => s.addToQueue);
  // Shared download state machine — same system the row buttons use.
  const download = useSongDownloadState(song);
  const playlists = usePlaylistStore((s) => s.playlists);
  const addSongToPlaylist = usePlaylistStore((s) => s.addSong);

  useEffect(() => {
    if (!song) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [song, onClose]);

  const handleAction = useCallback((action: () => void) => {
    action();
    onClose();
  }, [onClose]);

  if (!song || !position) return null;

  const isFav = favorites.includes(favoriteKey(song));
  const downloaded = download.state === 'downloaded';
  const downloading = download.state === 'downloading';
  const failed = download.state === 'failed';

  const menuItems = [
    {
      icon: isFav ? <Heart size={16} fill="currentColor" className="text-red-400" /> : <Heart size={16} />,
      label: isFav ? 'Unlike' : 'Like',
      onClick: () => handleAction(() => toggleFavorite(favoriteKey(song))),
      className: isFav ? 'text-red-400' : '',
    },
    {
      icon: downloading ? <X size={16} /> : downloaded ? <Check size={16} className="text-emerald-400" /> : failed ? <RotateCw size={16} className="text-red-400" /> : <Download size={16} />,
      label: downloaded ? 'Downloaded' : downloading ? 'Cancel Download' : failed ? 'Retry Download' : 'Download',
      onClick: () => handleAction(() => download.toggle()),
      className: downloaded ? 'text-emerald-400' : downloading ? 'text-violet-400' : failed ? 'text-red-400' : '',
      disabled: downloaded,
    },
    {
      icon: <SkipForward size={16} />,
      label: 'Play Next',
      onClick: () => handleAction(() => addNext(song)),
    },
    {
      icon: <Clock size={16} />,
      label: 'Play Later',
      onClick: () => handleAction(() => addToQueue(song)),
    },
    {
      icon: <ListPlus size={16} />,
      label: 'Add to Playlist',
      onClick: () => setShowPlaylistPicker(true),
    },
    {
      icon: <Share2 size={16} />,
      label: 'Share',
      onClick: () => handleAction(() => {
        const shareData = {
          title: song.title,
          text: `${song.title} by ${song.artist}`,
          url: buildShareUrl(song),
        };
        if (navigator.share) {
          navigator.share(shareData).catch(() => {});
        } else {
          navigator.clipboard.writeText(shareData.url).catch(() => {});
        }
      }),
    },
    {
      icon: <User size={16} />,
      label: 'Go to Artist',
      onClick: () => handleAction(() => onArtistClick?.(song.artist)),
    },
    {
      icon: <Disc3 size={16} />,
      label: 'Go to Album',
      onClick: () => handleAction(() => onAlbumClick?.(song.album)),
    },
  ];

  return (
    <div className="fixed inset-0 z-[100]" onContextMenu={(e) => e.preventDefault()}>
      <div
        ref={menuRef}
        className="absolute bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-2xl shadow-black/50 py-2 min-w-[220px] max-h-[80vh] overflow-y-auto backdrop-blur-xl"
        style={{
          left: Math.min(position.x, window.innerWidth - 240),
          top: Math.min(position.y, window.innerHeight - (showPlaylistPicker ? 400 : 380)),
        }}
      >
        {showPlaylistPicker ? (
          <>
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/5">
              <span className="text-sm font-semibold text-white">Add to Playlist</span>
              <button onClick={() => setShowPlaylistPicker(false)} className="text-gray-400 hover:text-white">
                <X size={14} />
              </button>
            </div>
            {playlists.length === 0 ? (
              <div className="px-4 py-6 text-center text-gray-500 text-sm">
                No playlists yet
              </div>
            ) : (
              playlists.map((pl) => (
                <button
                  key={pl.id}
                  onClick={() => handleAction(() => addSongToPlaylist(pl.id, song))}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 transition-colors"
                >
                  <ListPlus size={14} className="text-gray-500 flex-shrink-0" />
                  <span className="truncate">{pl.name}</span>
                  <span className="text-[10px] text-gray-600 ml-auto">{pl.trackCount} songs</span>
                </button>
              ))
            )}
          </>
        ) : (
          <>
            <div className="px-4 py-2 border-b border-white/5 mb-1">
              <p className="text-xs text-gray-500 truncate">{song.title}</p>
              <p className="text-[10px] text-gray-600 truncate">{song.artist}</p>
            </div>
            {menuItems.map((item, i) => (
              <button
                key={i}
                onClick={item.onClick}
                disabled={item.disabled}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 transition-colors ${item.className || ''} ${item.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Hook to manage context menu state. Returns props to spread on song rows
 * and the rendered context menu component.
 */
export function useSongContextMenu(onArtistClick?: (artist: string) => void, onAlbumClick?: (album: string) => void) {
  const [contextMenu, setContextMenu] = useState<{ song: Song; position: { x: number; y: number } } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, song: Song) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ song, position: { x: e.clientX, y: e.clientY } });
  }, []);

  const handleLongPress = useCallback((e: React.TouchEvent, song: Song) => {
    const touch = e.touches[0];
    const timer = setTimeout(() => {
      setContextMenu({ song, position: { x: touch.clientX, y: touch.clientY } });
    }, 500);

    const clear = () => {
      clearTimeout(timer);
      document.removeEventListener('touchend', clear);
      document.removeEventListener('touchmove', clear);
    };
    document.addEventListener('touchend', clear, { once: true });
    document.addEventListener('touchmove', clear, { once: true });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const ContextMenu = useCallback(() => (
    <SongContextMenu
      song={contextMenu?.song ?? null}
      position={contextMenu?.position ?? null}
      onClose={closeContextMenu}
      onArtistClick={onArtistClick}
      onAlbumClick={onAlbumClick}
    />
  ), [contextMenu, closeContextMenu, onArtistClick, onAlbumClick]);

  return { handleContextMenu, handleLongPress, ContextMenu, closeContextMenu };
}
