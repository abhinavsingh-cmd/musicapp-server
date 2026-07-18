import React, { memo } from 'react';
import { Album } from '../../types/music';
import { cn } from '../../utils/cn';
import { Music, Play } from 'lucide-react';

interface AlbumGridProps {
  albums: Album[];
  className?: string;
  onPlayAlbum?: (album: Album) => void;
}

const AlbumCard = memo(({ album, onPlayAlbum }: { album: Album; onPlayAlbum?: (album: Album) => void }) => (
  <div
    className={cn(
      "claymorphism p-5 rounded-2xl cursor-pointer relative overflow-hidden card-shine group",
      "transition-all duration-200 hover:-translate-y-2 hover:scale-[1.03] active:scale-[0.97]"
    )}
    onClick={() => onPlayAlbum?.(album)}
  >
    <div className="relative mb-4">
      {album.coverArt ? (
        <img
          src={album.coverArt}
          alt={album.title}
          loading="lazy"
          decoding="async"
          className="w-full aspect-square rounded-xl object-cover shadow-lg transition-transform duration-200 group-hover:rotate-1"
        />
      ) : (
        <div className="w-full aspect-square rounded-xl bg-gradient-to-br from-violet-500/20 to-pink-500/20 flex items-center justify-center">
          <Music size={48} className="text-violet-400" />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
      <button
        className="absolute bottom-2 right-2 w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 transition-all duration-200"
        onClick={(e) => {
          e.stopPropagation();
          onPlayAlbum?.(album);
        }}
      >
        <Play size={20} className="text-white ml-0.5" />
      </button>
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
  </div>
));
AlbumCard.displayName = 'AlbumCard';

export const AlbumGrid: React.FC<AlbumGridProps> = ({
  albums,
  className,
  onPlayAlbum
}) => {
  return (
    <div className={cn("grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6", className)}>
      {albums.map((album) => (
        <AlbumCard key={album.id} album={album} onPlayAlbum={onPlayAlbum} />
      ))}
    </div>
  );
};
