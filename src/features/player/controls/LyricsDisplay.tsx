import React, { useEffect, useRef } from 'react';
import { useLyricsStore } from '../../../stores/lyricsStore';
import { useAudioStore } from '../../../stores/audioStore';
import { Music, Loader2 } from 'lucide-react';

export const LyricsDisplay: React.FC = () => {
  const { lyrics, currentLine, loading, fetchLyrics } = useLyricsStore();
  const { currentSong, progress } = useAudioStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (currentSong) {
      fetchLyrics(currentSong.id, currentSong.title, currentSong.artist);
    }
  }, [currentSong, fetchLyrics]);

  useEffect(() => {
    useLyricsStore.getState().updateCurrentLine(progress);
  }, [progress]);

  useEffect(() => {
    if (currentLine >= 0 && lineRefs.current.has(currentLine)) {
      lineRefs.current.get(currentLine)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [currentLine]);

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
            className={`py-2 px-3 my-1 rounded-lg transition-all duration-300 cursor-pointer hover:bg-white/5 ${
              i === currentLine
                ? 'text-white text-xl font-bold scale-105 bg-gradient-to-r from-violet-500/20 to-fuchsia-500/10'
                : i < currentLine
                ? 'text-gray-500 text-base'
                : 'text-gray-400 text-base'
            }`}
            onClick={() => useAudioStore.getState().seek(line.time)}
          >
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
};
