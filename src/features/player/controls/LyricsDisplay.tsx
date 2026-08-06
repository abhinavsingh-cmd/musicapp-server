import React, { useEffect, useRef, useMemo, memo } from 'react';
import { useLyricsStore } from '../../../stores/lyricsStore';
import { useAudioStore } from '../../../stores/audioStore';
import { Music, Loader2 } from 'lucide-react';

const LyricsLine = memo(({ text, isActive, isPast, onClick }: { text: string; isActive: boolean; isPast: boolean; onClick: () => void }) => (
  <div
    className={`py-2 px-3 my-1 rounded-lg transition-all duration-300 cursor-pointer hover:bg-white/5 ${
      isActive
        ? 'text-white text-xl font-bold scale-105 bg-gradient-to-r from-violet-500/20 to-fuchsia-500/10'
        : isPast
        ? 'text-gray-500 text-base'
        : 'text-gray-400 text-base'
    }`}
    onClick={onClick}
  >
    {text}
  </div>
));
LyricsLine.displayName = 'LyricsLine';

export const LyricsDisplay: React.FC = memo(() => {
  const lyrics = useLyricsStore((s) => s.lyrics);
  const currentLine = useLyricsStore((s) => s.currentLine);
  const loading = useLyricsStore((s) => s.loading);
  const fetchLyrics = useLyricsStore((s) => s.fetchLyrics);
  const currentSong = useAudioStore((s) => s.currentSong);
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const lastUpdateRef = useRef(0);

  useEffect(() => {
    if (currentSong) {
      fetchLyrics(currentSong.id, currentSong.title, currentSong.artist);
    }
    lineRefs.current.clear();
  }, [currentSong, fetchLyrics]);

  // Throttled progress sync — reads from store directly to avoid re-renders
  useEffect(() => {
    let rafId: number;
    const tick = () => {
      const now = Date.now();
      if (now - lastUpdateRef.current >= 500) {
        lastUpdateRef.current = now;
        const { progress } = useAudioStore.getState();
        useLyricsStore.getState().updateCurrentLine(progress);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  useEffect(() => {
    if (currentLine >= 0 && lineRefs.current.has(currentLine)) {
      lineRefs.current.get(currentLine)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [currentLine]);

  const seekToLine = useMemo(() => {
    return (time: number) => useAudioStore.getState().seek(time);
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <Loader2 className="w-8 h-8 animate-spin text-violet-400 mb-3" />
        <p className="text-sm">Loading lyrics...</p>
      </div>
    );
  }

  if (lyrics.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <Music className="w-12 h-12 text-gray-600 mb-3" />
        <p className="text-sm">No lyrics available</p>
        <p className="text-xs text-gray-600 mt-1">Lyrics may not be available for this song</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-violet-500/30 scroll-smooth"
    >
      <div className="py-8 px-4">
        {lyrics.map((line, i) => (
          <div
            key={i}
            ref={(el) => { if (el) lineRefs.current.set(i, el); }}
          >
            <LyricsLine
              text={line.text}
              isActive={i === currentLine}
              isPast={i < currentLine}
              onClick={() => seekToLine(line.time)}
            />
          </div>
        ))}
      </div>
    </div>
  );
});
LyricsDisplay.displayName = 'LyricsDisplay';
