import React from 'react';
import { useAudioStore } from '../../../stores/audioStore';
import { cn } from '../../../utils/cn';
import { Music } from 'lucide-react';
import CachedImage from '../../../components/CachedImage';

interface SongInfoProps {
  className?: string;
}

function formatDuration(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const SongInfo: React.FC<SongInfoProps> = React.memo(({ className }) => {
  const title = useAudioStore((s) => s.currentSong?.title);
  const artist = useAudioStore((s) => s.currentSong?.artist);
  const coverArt = useAudioStore((s) => s.currentSong?.coverArt);
  const isPlaying = useAudioStore((s) => s.isPlaying);
  const duration = useAudioStore((s) => s.duration);

  return (
    <div className={cn("flex items-center gap-3 overflow-hidden", className)}>
      <div className="relative flex-shrink-0">
        <div
          className={cn(
            "w-11 h-11 rounded-lg overflow-hidden bg-gradient-to-br from-purple-500 to-pink-500 shadow-md transition-all duration-300",
            isPlaying && "animate-[pulse_2s_ease-in-out_infinite]"
          )}
        >
          {coverArt ? (
            <CachedImage
              src={coverArt}
              alt={title || 'Now playing'}
              className="w-full h-full object-cover"
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
          {title || 'No song selected'}
        </p>
        <div className="flex items-center gap-1.5 text-xs text-gray-400 truncate">
          <span className="truncate">{artist || 'Select a song to play'}</span>
          {duration > 0 && (
            <>
              <span className="flex-shrink-0">·</span>
              <span className="flex-shrink-0">{formatDuration(duration)}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
});
SongInfo.displayName = 'SongInfo';
