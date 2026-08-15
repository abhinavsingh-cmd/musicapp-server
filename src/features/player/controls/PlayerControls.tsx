import React, { memo, useRef } from 'react';
import { useAudioStore } from '../../../stores/audioStore';
import { useQueueStore } from '../../../stores/queueStore';
import { useSongDownloadState } from '../../../components/DownloadButton';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '../../../utils/cn';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Volume1, Shuffle, Repeat, Repeat1, Heart, Download, Check, Loader2, RotateCw } from 'lucide-react';
import { favoriteKey } from '../../../utils/songIds';

interface PlayerControlsProps { className?: string; }

const Spinner: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg
    className="animate-spin"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
  >
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

export const PlayerControls: React.FC<PlayerControlsProps> = React.memo(({ className }) => {
  const { isPlaying, isLoading, currentSong, volume, favorites, togglePlayPause, nextSong, previousSong, setVolume, toggleFavorite } = useAudioStore(useShallow((s) => ({
    isPlaying: s.isPlaying,
    isLoading: s.isLoading,
    currentSong: s.currentSong,
    volume: s.volume,
    favorites: s.favorites,
    togglePlayPause: s.togglePlayPause,
    nextSong: s.nextSong,
    previousSong: s.previousSong,
    setVolume: s.setVolume,
    toggleFavorite: s.toggleFavorite,
  })));
  const { isShuffled, repeatMode, toggleShuffle, cycleRepeat } = useQueueStore(useShallow((s) => ({
    isShuffled: s.isShuffled,
    repeatMode: s.repeatMode,
    toggleShuffle: s.toggleShuffle,
    cycleRepeat: s.cycleRepeat,
  })));
  // Shared download state machine (idle/downloading/downloaded/failed) —
  // same system every song row uses, styled here for the player bar.
  const download = useSongDownloadState(currentSong);
  const lastSkipRef = useRef(0);

  const handleSkip = (fn: () => void) => {
    const now = Date.now();
    if (now - lastSkipRef.current < 300) return;
    lastSkipRef.current = now;
    fn();
  };

  const isFav = currentSong ? favorites.includes(favoriteKey(currentSong)) : false;
  const RepeatIcon = repeatMode === 'one' ? Repeat1 : Repeat;
  const downloaded = download.state === 'downloaded';
  const downloading = download.state === 'downloading';

  return (
    <div className={cn("flex items-center justify-between px-2", className)}>
      <div className="flex items-center space-x-1 sm:space-x-2">
        <button
          onClick={toggleShuffle}
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 active:scale-90",
            isShuffled
              ? "bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-glow"
              : "text-gray-500 hover:text-white hover:bg-white/10"
          )}
          title={isShuffled ? "Shuffle On" : "Shuffle Off"}
        >
          <Shuffle size={16} />
        </button>

        <button
          onClick={() => handleSkip(previousSong)}
          disabled={!currentSong}
          className="w-9 h-9 rounded-full flex items-center justify-center text-gray-300 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 active:scale-90"
        >
          <SkipBack size={18} fill="currentColor" />
        </button>

        <button
          onClick={togglePlayPause}
          disabled={!currentSong}
          className={cn(
            "w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 active:scale-90",
            "bg-gradient-to-br from-violet-500 to-fuchsia-500",
            "shadow-[0_0_30px_rgba(139,92,246,0.5)]",
            "hover:shadow-[0_0_40px_rgba(139,92,246,0.7)]"
          )}
        >
          {isLoading ? (
            <Spinner size={24} />
          ) : isPlaying ? (
            <Pause size={24} fill="white" />
          ) : (
            <Play size={24} fill="white" className="ml-1" />
          )}
        </button>

        <button
          onClick={() => handleSkip(nextSong)}
          disabled={!currentSong}
          className="w-9 h-9 rounded-full flex items-center justify-center text-gray-300 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 active:scale-90"
        >
          <SkipForward size={18} fill="currentColor" />
        </button>

        <button
          onClick={cycleRepeat}
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 active:scale-90 relative",
            repeatMode !== 'off'
              ? "bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.4)]"
              : "text-gray-500 hover:text-white hover:bg-white/10"
          )}
          title={`Repeat: ${repeatMode}`}
        >
          <RepeatIcon size={16} />
          {repeatMode === 'one' && (
            <span className="absolute -top-1 -right-1 text-[8px] font-bold bg-white text-emerald-600 rounded-full w-4 h-4 flex items-center justify-center">
              1
            </span>
          )}
        </button>
      </div>

      <div className="flex items-center space-x-1 sm:space-x-2">
        <button
          onClick={() => currentSong && toggleFavorite(favoriteKey(currentSong))}
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 active:scale-90",
            isFav
              ? "bg-gradient-to-br from-red-500 to-pink-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.4)]"
              : "text-gray-500 hover:text-red-400 hover:bg-white/10"
          )}
          disabled={!currentSong}
        >
          <Heart size={16} fill={isFav ? "currentColor" : "none"} />
        </button>

        <button
          onClick={download.toggle}
          data-state={download.state === 'unavailable' ? 'idle' : download.state}
          aria-label={
            downloaded ? 'Downloaded'
            : downloading ? 'Downloading — tap to cancel'
            : download.state === 'failed' ? `Download failed${download.errorMessage ? `: ${download.errorMessage}` : ''} — tap to retry`
            : 'Download'
          }
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 active:scale-90",
            downloaded
              ? "bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.4)]"
              : downloading
                ? "text-violet-400 bg-violet-500/15"
                : download.state === 'failed'
                  ? "text-red-400 bg-red-500/15"
                  : "text-gray-500 hover:text-violet-400 hover:bg-white/10"
          )}
          disabled={!currentSong || download.state === 'unavailable' || downloaded}
          title={downloaded ? "Downloaded" : downloading ? "Cancel download" : download.state === 'failed' ? "Retry download" : "Download"}
        >
          {downloaded ? <Check size={16} /> : downloading ? <Loader2 size={16} className="animate-spin" /> : download.state === 'failed' ? <RotateCw size={16} /> : <Download size={16} />}
        </button>

        <VolumeIcon volume={volume} />

        <div className="relative group">
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="w-20 sm:w-24 h-1.5 rounded-full appearance-none cursor-pointer bg-white/10 group-hover:bg-white/20 transition-all"
            style={{
              background: `linear-gradient(to right, rgb(139 92 246) 0%, rgb(139 92 246) ${volume * 100}%, rgba(255,255,255,0.1) ${volume * 100}%, rgba(255,255,255,0.1) 100%)`,
            }}
          />
        </div>
      </div>
    </div>
  );
});
PlayerControls.displayName = 'PlayerControls';

const VolumeIcon = memo(function VolumeIcon({ volume }: { volume: number }) {
  if (volume === 0) return <VolumeX size={16} className="text-gray-500" />;
  if (volume < 0.5) return <Volume1 size={16} className="text-gray-500" />;
  return <Volume2 size={16} className="text-gray-500" />;
});
