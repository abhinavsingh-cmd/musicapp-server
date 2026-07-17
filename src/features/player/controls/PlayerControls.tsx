import React, { memo, useRef } from 'react';
import { useAudioStore } from '../../../stores/audioStore';
import { useDownloadsStore } from '../../../stores/downloadsStore';
import { cn } from '../../../utils/cn';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Volume1, Shuffle, Repeat, Repeat1, Heart, Download, Check, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';

interface PlayerControlsProps { className?: string; }

export const PlayerControls: React.FC<PlayerControlsProps> = memo(({ className }) => {
  const isPlaying = useAudioStore((s) => s.isPlaying);
  const currentSong = useAudioStore((s) => s.currentSong);
  const isShuffled = useAudioStore((s) => s.isShuffled);
  const repeatMode = useAudioStore((s) => s.repeatMode);
  const volume = useAudioStore((s) => s.volume);
  const favorites = useAudioStore((s) => s.favorites);
  const togglePlayPause = useAudioStore((s) => s.togglePlayPause);
  const nextSong = useAudioStore((s) => s.nextSong);
  const previousSong = useAudioStore((s) => s.previousSong);
  const toggleShuffle = useAudioStore((s) => s.toggleShuffle);
  const cycleRepeat = useAudioStore((s) => s.cycleRepeat);
  const setVolume = useAudioStore((s) => s.setVolume);
  const toggleFavorite = useAudioStore((s) => s.toggleFavorite);
  const downloadSong = useDownloadsStore((s) => s.downloadSong);
  const isDownloaded = useDownloadsStore((s) => s.isDownloaded);
  const isDownloading = useDownloadsStore((s) => s.isDownloading);
  const lastSkipRef = useRef(0);

  const handleSkip = (fn: () => void) => {
    const now = Date.now();
    if (now - lastSkipRef.current < 300) return;
    lastSkipRef.current = now;
    fn();
  };

  const isFav = currentSong ? favorites.includes(currentSong.id) : false;
  const RepeatIcon = repeatMode === 'one' ? Repeat1 : Repeat;
  const downloaded = currentSong?.youtubeId ? isDownloaded(currentSong.youtubeId) : false;
  const downloading = currentSong?.youtubeId ? isDownloading(currentSong.youtubeId) : false;

  return (
    <div className={cn("flex items-center justify-between px-2", className)}>
      <div className="flex items-center space-x-1 sm:space-x-2">
        {/* Shuffle */}
        <motion.button 
          onClick={toggleShuffle} 
          whileHover={{ scale: 1.15 }} 
          whileTap={{ scale: 0.85 }} 
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300",
            isShuffled 
              ? "bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-glow" 
              : "text-gray-500 hover:text-white hover:bg-white/10"
          )}
          title={isShuffled ? "Shuffle On" : "Shuffle Off"}
        >
          <Shuffle size={16} />
        </motion.button>

        {/* Previous */}
        <motion.button 
          onClick={() => handleSkip(previousSong)} 
          whileHover={{ scale: 1.15 }} 
          whileTap={{ scale: 0.85 }} 
          disabled={!currentSong} 
          className="w-9 h-9 rounded-full flex items-center justify-center text-gray-300 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-300"
        >
          <SkipBack size={18} fill="currentColor" />
        </motion.button>

        {/* Play/Pause - Main Button */}
        <motion.button 
          onClick={togglePlayPause} 
          whileHover={{ scale: 1.1 }} 
          whileTap={{ scale: 0.9 }} 
          disabled={!currentSong} 
          className={cn(
            "w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-300",
            "bg-gradient-to-br from-violet-500 to-fuchsia-500",
            "shadow-[0_0_30px_rgba(139,92,246,0.5)]",
            "hover:shadow-[0_0_40px_rgba(139,92,246,0.7)]"
          )}
        >
          <motion.div 
            key={isPlaying ? 'pause' : 'play'} 
            initial={{ scale: 0, rotate: -90 }} 
            animate={{ scale: 1, rotate: 0 }} 
            transition={{ type: 'spring', stiffness: 500, damping: 20 }}
          >
            {isPlaying ? <Pause size={24} fill="white" /> : <Play size={24} fill="white" className="ml-1" />}
          </motion.div>
        </motion.button>

        {/* Next */}
        <motion.button 
          onClick={() => handleSkip(nextSong)} 
          whileHover={{ scale: 1.15 }} 
          whileTap={{ scale: 0.85 }} 
          disabled={!currentSong} 
          className="w-9 h-9 rounded-full flex items-center justify-center text-gray-300 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-300"
        >
          <SkipForward size={18} fill="currentColor" />
        </motion.button>

        {/* Repeat */}
        <motion.button 
          onClick={cycleRepeat} 
          whileHover={{ scale: 1.15 }} 
          whileTap={{ scale: 0.85 }} 
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300 relative",
            repeatMode !== 'off' 
              ? "bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.4)]" 
              : "text-gray-500 hover:text-white hover:bg-white/10"
          )} 
          title={`Repeat: ${repeatMode}`}
        >
          <RepeatIcon size={16} />
          {repeatMode === 'one' && (
            <motion.span 
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -top-1 -right-1 text-[8px] font-bold bg-white text-emerald-600 rounded-full w-4 h-4 flex items-center justify-center"
            >
              1
            </motion.span>
          )}
        </motion.button>
      </div>

      <div className="flex items-center space-x-1 sm:space-x-2">
        {/* Favorite */}
        <motion.button 
          onClick={() => currentSong && toggleFavorite(currentSong.id)} 
          whileHover={{ scale: 1.2 }} 
          whileTap={{ scale: 0.8 }} 
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300",
            isFav 
              ? "bg-gradient-to-br from-red-500 to-pink-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.4)]" 
              : "text-gray-500 hover:text-red-400 hover:bg-white/10"
          )} 
          disabled={!currentSong}
        >
          <motion.div
            key={isFav ? 'liked' : 'unliked'}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 20 }}
          >
            <Heart size={16} fill={isFav ? "currentColor" : "none"} />
          </motion.div>
        </motion.button>

        {/* Download */}
        <motion.button 
          onClick={() => currentSong && downloadSong(currentSong)} 
          whileHover={{ scale: 1.2 }} 
          whileTap={{ scale: 0.8 }} 
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300",
            downloaded 
              ? "bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.4)]" 
              : "text-gray-500 hover:text-violet-400 hover:bg-white/10"
          )} 
          disabled={!currentSong?.youtubeId || downloading} 
          title={downloaded ? "Downloaded" : "Download"}
        >
          {downloaded ? <Check size={16} /> : downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        </motion.button>

        {/* Volume Icon */}
        <VolumeIcon volume={volume} />
        
        {/* Volume Slider */}
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
