import React, { useState, useRef, useCallback } from 'react';
import { useAudioStore } from '../../../stores/audioStore';
import { cn } from '../../../utils/cn';

interface ProgressBarProps {
  className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ className }) => {
  const { progress, duration, seek, currentSong } = useAudioStore();
  const [isHovering, setIsHovering] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!barRef.current || !duration) return;
    const rect = barRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(pos * duration);
  }, [duration, seek]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!barRef.current || !duration || !isDragging.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(pos * duration);
  }, [duration, seek]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const pct = duration > 0 ? (progress / duration) * 100 : 0;

  return (
    <div className={cn("px-4", className)}>
      <div
        ref={barRef}
        className="relative h-1.5 bg-white/10 rounded-full cursor-pointer group"
        onClick={handleSeek}
        onMouseDown={() => { isDragging.current = true; }}
        onMouseUp={() => { isDragging.current = false; }}
        onMouseMove={handleMouseMove}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => { setIsHovering(false); isDragging.current = false; }}
      >
        <div
          className="absolute top-0 left-0 h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-[width] duration-100 ease-linear"
          style={{ width: currentSong ? `${pct}%` : '0%' }}
        />
        {currentSong && (
          <div
            className={cn(
              "absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md border-2 border-purple-500 transition-transform duration-150",
              isHovering ? "scale-140 opacity-100" : "scale-100 opacity-80"
            )}
            style={{ left: `calc(${pct}% - 6px)` }}
          />
        )}
      </div>
      <div className="flex justify-between mt-0.5">
        <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">
          {currentSong ? formatTime(progress) : '0:00'}
        </span>
        <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">
          {currentSong ? formatTime(duration) : '0:00'}
        </span>
      </div>
    </div>
  );
};
