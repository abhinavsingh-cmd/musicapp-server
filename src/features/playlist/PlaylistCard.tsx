import React from 'react';
import { Playlist } from '../../types/music';
import { cn } from '../../utils/cn';
import { Music, Clock, Play } from 'lucide-react';
import { motion } from 'framer-motion';

interface PlaylistCardProps {
  playlist: Playlist;
  className?: string;
  onPlayPlaylist?: (playlist: Playlist) => void;
}

export const PlaylistCard: React.FC<PlaylistCardProps> = ({
  playlist,
  className,
  onPlayPlaylist
}) => {
  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{
        y: -6,
        scale: 1.02,
        transition: { type: 'spring', stiffness: 400, damping: 15 },
      }}
      whileTap={{ scale: 0.97 }}
      className={cn(
        "claymorphism p-5 rounded-2xl cursor-pointer relative overflow-hidden card-shine",
        "group",
        className
      )}
      onClick={() => onPlayPlaylist?.(playlist)}
    >
      <div className="relative mb-4">
        <motion.img
          src={playlist.coverArt}
          alt={playlist.name}
          className="w-full aspect-square rounded-xl object-cover shadow-lg"
          whileHover={{ scale: 1.05, rotate: 1 }}
          transition={{ type: 'spring', stiffness: 300 }}
        />
        <motion.div
          className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent rounded-xl"
          initial={{ opacity: 0 }}
          whileHover={{ opacity: 1 }}
        />
        <motion.button
          className="absolute bottom-2 right-2 w-12 h-12 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center shadow-lg"
          initial={{ opacity: 0, scale: 0 }}
          whileHover={{ scale: 1.1 }}
          whileInView={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 300 }}
          onClick={(e) => {
            e.stopPropagation();
            onPlayPlaylist?.(playlist);
          }}
        >
          <Play size={20} className="text-white ml-0.5" />
        </motion.button>
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
    </motion.div>
  );
};
