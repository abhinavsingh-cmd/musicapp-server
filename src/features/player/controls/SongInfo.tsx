import React, { memo } from 'react';
import { useAudioStore } from '../../../stores/audioStore';
import { cn } from '../../../utils/cn';
import { Music } from 'lucide-react';

interface SongInfoProps {
  className?: string;
}

export const SongInfo: React.FC<SongInfoProps> = memo(({ className }) => {
  const currentSong = useAudioStore((s) => s.currentSong);
  const isPlaying = useAudioStore((s) => s.isPlaying);

  return (
    <div className={cn("flex items-center gap-3 overflow-hidden", className)}>
      <div className="relative flex-shrink-0">
        <div
          className={cn(
            "w-11 h-11 rounded-lg overflow-hidden bg-gradient-to-br from-purple-500 to-pink-500 shadow-md transition-all duration-300",
            isPlaying && "animate-[pulse_2s_ease-in-out_infinite]"
          )}
        >
          {currentSong ? (
            <img
              src={currentSong.coverArt}
              alt={currentSong.title}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : null}
          <div className="absolute inset-0 flex items-center justify-center">
            <Music size={18} className="text-white/80" />
          </div>
        </div>
        {isPlaying && (
          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-[#0d0d1a]" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white truncate">
          {currentSong?.title || 'No song selected'}
        </p>
        <p className="text-xs text-gray-400 truncate">
          {currentSong?.artist || 'Select a song to play'}
        </p>
      </div>
    </div>
  );
});
SongInfo.displayName = 'SongInfo';
