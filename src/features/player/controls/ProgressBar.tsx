import React, { useState, useRef, useCallback, memo, useEffect } from 'react';
import { useAudioStore } from '../../../stores/audioStore';
import { cn } from '../../../utils/cn';

interface ProgressBarProps {
  className?: string;
}

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const ProgressFill = memo(({ pct, hasSong }: { pct: number; hasSong: boolean }) => (
  <div
    className="absolute top-0 left-0 h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full"
    style={{ width: hasSong ? `${pct}%` : '0%', willChange: 'width' }}
  />
));
ProgressFill.displayName = 'ProgressFill';

const TimeDisplay = memo(({ progress, duration, hasSong }: { progress: number; duration: number; hasSong: boolean }) => (
  <div className="flex justify-between mt-0.5">
    <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">
      {hasSong ? formatTime(progress) : '0:00'}
    </span>
    <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">
      {hasSong ? formatTime(duration) : '0:00'}
    </span>
  </div>
));
TimeDisplay.displayName = 'TimeDisplay';

export const ProgressBar: React.FC<ProgressBarProps> = memo(({ className }) => {
  const seek = useAudioStore((s) => s.seek);
  const hasSong = useAudioStore((s) => s.currentSong !== null);
  const [isHovering, setIsHovering] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const pctRef = useRef(0);
  const [, forceUpdate] = useState(0);

  // Subscribe to progress via rAF to avoid 4x/sec re-renders — but ONLY
  // while a track exists. With no song there is no playback to measure, so
  // the timer must not run at all (it would keep the bar re-rendering and
  // burn a frame every tick for nothing).
  useEffect(() => {
    if (!hasSong) return;
    let rafId: number;
    const tick = () => {
      const { progress, duration } = useAudioStore.getState();
      const newPct = duration > 0 ? (progress / duration) * 100 : 0;
      if (Math.abs(newPct - pctRef.current) > 0.1) {
        pctRef.current = newPct;
        forceUpdate(c => c + 1);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [hasSong]);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!barRef.current) return;
    const { duration } = useAudioStore.getState();
    if (!duration) return;
    const rect = barRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(pos * duration);
  }, [seek]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!barRef.current || !isDragging.current) return;
    const { duration } = useAudioStore.getState();
    if (!duration) return;
    const rect = barRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(pos * duration);
  }, [seek]);

  const pct = pctRef.current;
  const progress = useAudioStore((s) => s.progress);
  const duration = useAudioStore((s) => s.duration);

  // No track — hide the progress area entirely. A 0:00 / 0:00 readout and an
  // empty seek track imply playback that does not exist.
  if (!hasSong) return null;

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
        <ProgressFill pct={pct} hasSong={hasSong} />
        {hasSong && (
          <div
            className={cn(
              "absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md border-2 border-purple-500 transition-transform duration-150",
              isHovering ? "scale-140 opacity-100" : "scale-100 opacity-80"
            )}
            style={{ left: `calc(${pct}% - 6px)` }}
          />
        )}
      </div>
      <TimeDisplay progress={progress} duration={duration} hasSong={hasSong} />
    </div>
  );
});
ProgressBar.displayName = 'ProgressBar';
