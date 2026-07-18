import React from 'react';
import { Album } from '../../types/music';
import { cn } from '../../utils/cn';
import { Music, Play } from 'lucide-react';
import { motion } from 'framer-motion';

interface AlbumGridProps {
  albums: Album[];
  className?: string;
  onPlayAlbum?: (album: Album) => void;
}

export const AlbumGrid: React.FC<AlbumGridProps> = ({
  albums,
  className,
  onPlayAlbum
}) => {
  return (
    <div className={cn("grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6", className)}>
      {albums.map((album, index) => (
        <motion.div
          key={album.id}
          initial={{ opacity: 0, y: 30, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{
            delay: index * 0.08,
            duration: 0.4,
            type: 'spring',
            stiffness: 200,
          }}
          whileHover={{
            y: -8,
            scale: 1.03,
            transition: { type: 'spring', stiffness: 400, damping: 15 },
          }}
          whileTap={{ scale: 0.97 }}
          className={cn(
            "claymorphism p-5 rounded-2xl cursor-pointer relative overflow-hidden card-shine",
            "group"
          )}
          onClick={() => onPlayAlbum?.(album)}
        >
          <div className="relative mb-4">
            {album.coverArt ? (
              <motion.img
                src={album.coverArt}
                alt={album.title}
                className="w-full aspect-square rounded-xl object-cover shadow-lg"
                whileHover={{ rotate: 2 }}
                transition={{ type: 'spring', stiffness: 300 }}
              />
            ) : (
              <div className="w-full aspect-square rounded-xl bg-gradient-to-br from-violet-500/20 to-pink-500/20 flex items-center justify-center">
                <Music size={48} className="text-violet-400" />
              </div>
            )}
            <motion.div
              className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent rounded-xl"
              initial={{ opacity: 0 }}
              whileHover={{ opacity: 1 }}
            />
            <motion.button
              className="absolute bottom-2 right-2 w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center shadow-lg"
              initial={{ opacity: 0, scale: 0, y: 10 }}
              whileHover={{ scale: 1.1 }}
              whileInView={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 300 }}
              onClick={(e) => {
                e.stopPropagation();
                onPlayAlbum?.(album);
              }}
            >
              <Play size={20} className="text-white ml-0.5" />
            </motion.button>
          </div>

          <div className="space-y-1">
            <h3 className="font-semibold text-gray-900 dark:text-white truncate text-sm">
              {album.title}
            </h3>
            <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
              {album.artist}
            </p>
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-500 pt-1">
              <span>{album.releaseYear}</span>
              <span className="flex items-center">
                <Music size={10} className="mr-1" />
                {album.trackCount}
              </span>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
};
