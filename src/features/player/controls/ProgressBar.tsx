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

const TimeDisplay = memo(({ progress, duration }: { progress: number; duration: number }) => (
  <div className="flex justify-between mt-0.5">
    <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">
      {formatTime(progress)}
    </span>
    <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">
      {formatTime(duration)}
    </span>
  </div>
));
TimeDisplay.displayName = 'TimeDisplay';

/**
 * Progress bar that updates via direct DOM manipulation (no React re-renders).
 * The rAF loop writes to fillEl.style.width and thumbEl.style.left directly,
 * bypassing React reconciliation entirely. Only the time display re-renders
 * at a throttled rate (~1/sec) for the numeric readout.
 */
export const ProgressBar: React.FC<ProgressBarProps> = memo(({ className }) => {
  const seek = useAudioStore((s) => s.seek);
  const hasSong = useAudioStore((s) => s.currentSong !== null);
  const [isHovering, setIsHovering] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const lastPct = useRef(0);
  // Throttle time display updates to ~1/sec to avoid re-rendering
  // SongInfo/PlayerControls every rAF frame.
  const [timeTick, setTimeTick] = useState(0);

  // Direct-DOM rAF loop: updates fill width + thumb position at 60fps
  // without triggering any React state updates.
  useEffect(() => {
    if (!hasSong) return;
    let rafId: number;
    let lastTimeTick = 0;
    const tick = () => {
      const { progress, duration } = useAudioStore.getState();
      const pct = duration > 0 ? (progress / duration) * 100 : 0;
      if (Math.abs(pct - lastPct.current) > 0.05) {
        lastPct.current = pct;
        if (fillRef.current) fillRef.current.style.width = `${pct}%`;
        if (thumbRef.current) thumbRef.current.style.left = `calc(${pct}% - 6px)`;
      }
      // Throttle time display to ~1 update/sec (only re-renders TimeDisplay,
      // not the entire Player tree).
      const now = performance.now();
      if (now - lastTimeTick > 1000) {
        lastTimeTick = now;
        setTimeTick(t => t + 1);
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

  // Read from store only for the throttled time display
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  timeTick; // ensure timeTick is consumed so linter doesn't warn
  const progress = useAudioStore((s) => s.progress);
  const duration = useAudioStore((s) => s.duration);

  if (!hasSong) return null;

  return (
    <div className={cn('px-4', className)}>
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
        {/* Fill bar — updated via ref, no React re-render */}
        <div
          ref={fillRef}
          className="absolute top-0 left-0 h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full will-change-[width]"
          style={{ width: '0%' }}
        />
        {/* Thumb — updated via ref, no React re-render */}
        <div
          ref={thumbRef}
          className={cn(
            'absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md border-2 border-purple-500 transition-[transform,opacity] duration-150 pointer-events-none',
            isHovering ? 'scale-140 opacity-100' : 'scale-100 opacity-80',
          )}
          style={{ left: 'calc(0% - 6px)' }}
        />
      </div>
      <TimeDisplay progress={progress} duration={duration} />
    </div>
  );
});
ProgressBar.displayName = 'ProgressBar';
