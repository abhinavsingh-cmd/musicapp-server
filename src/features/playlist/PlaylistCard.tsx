import React, { memo } from 'react';
import { Playlist } from '../../types/music';
import { cn } from '../../utils/cn';
import { Music, Clock, Play } from 'lucide-react';

interface PlaylistCardProps {
  playlist: Playlist;
  className?: string;
  onPlayPlaylist?: (playlist: Playlist) => void;
  onViewPlaylist?: (playlist: Playlist) => void;
}

const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const PlaylistCard: React.FC<PlaylistCardProps> = memo(({
  playlist,
  className,
  onPlayPlaylist,
  onViewPlaylist,
}) => {
  return (
    <div
      className={cn(
        "claymorphism p-5 rounded-2xl cursor-pointer relative overflow-hidden card-shine group",
        "transition-all duration-200 hover:-translate-y-1.5 hover:scale-[1.02] active:scale-[0.97]",
        className
      )}
      onClick={() => onViewPlaylist?.(playlist) ?? onPlayPlaylist?.(playlist)}
    >
      <div className="relative mb-4">
        {playlist.coverArt ? (
          <img
            src={playlist.coverArt}
            alt={playlist.name}
            loading="lazy"
            decoding="async"
            className="w-full aspect-square rounded-xl object-cover shadow-lg transition-transform duration-200 group-hover:scale-105 group-hover:rotate-1"
          />
        ) : (
          <div className="w-full aspect-square rounded-xl bg-gradient-to-br from-violet-500/20 to-pink-500/20 flex items-center justify-center">
            <Music size={48} className="text-violet-400" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
        <button
          className="absolute bottom-2 right-2 w-12 h-12 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 transition-all duration-200"
          onClick={(e) => {
            e.stopPropagation();
            onPlayPlaylist?.(playlist);
          }}
        >
          <Play size={20} className="text-white ml-0.5" />
        </button>
      </div>

      <div className="space-y-1">
        <h3 className="font-semibold text-gray-900 dark:text-white truncate text-sm">
          {playlist.name}
        </h3>
        <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
          {playlist.description || 'Created playlist'}
        </p>
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-500 pt-1">
          <span className="flex items-center">
            <Music size={10} className="mr-1" />
            {playlist.trackCount} songs
          </span>
          <span className="flex items-center">
            <Clock size={10} className="mr-1" />
            {formatDuration(playlist.duration)}
          </span>
        </div>
      </div>
    </div>
  );
});
PlaylistCard.displayName = 'PlaylistCard';
