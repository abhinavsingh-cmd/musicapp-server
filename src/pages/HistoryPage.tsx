import React, { useState, useRef, useCallback, useMemo, memo } from 'react';
import { useGoBack } from '../hooks/useGoBack';
import { useHistoryStore } from '../stores/historyStore';
import { useAudioStore } from '../stores/audioStore';
import { Clock, Trash2, Music, Play, ArrowLeft } from 'lucide-react';

const ROW_HEIGHT = 64;
const BUFFER = 5;

const HistoryRow = memo(({ entry, formatTime, onPlay, onRemove }: {
  entry: any;
  formatTime: (ts: number) => string;
  onPlay: () => void;
  onRemove: () => void;
}) => (
  <div
    className="flex items-center gap-4 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 group transition-colors"
    style={{ height: ROW_HEIGHT }}
  >
    <button
      onClick={onPlay}
      className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
    >
      <Play size={16} className="text-violet-400 ml-0.5" />
    </button>
    <img
      src={entry.song.coverArt}
      alt={entry.song.title}
      loading="lazy"
      decoding="async"
      className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
    />
    <div className="flex-1 min-w-0">
      <p className="text-white font-medium truncate text-sm">{entry.song.title}</p>
      <p className="text-xs text-gray-400 truncate">{entry.song.artist}</p>
    </div>
    <span className="text-xs text-gray-500 flex-shrink-0">{formatTime(entry.playedAt)}</span>
    <button
      onClick={onRemove}
      className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100 flex-shrink-0"
    >
      <Trash2 size={14} />
    </button>
  </div>
), (prev, next) => {
  return prev.entry.song.id === next.entry.song.id
    && prev.entry.playedAt === next.entry.playedAt;
});
HistoryRow.displayName = 'HistoryRow';

export const EMPTY_HISTORY: never[] = [];

const HistoryPage: React.FC = () => {
  const goBack = useGoBack();
  const history = useHistoryStore((s) => s.history) ?? EMPTY_HISTORY;
  const clearHistory = useHistoryStore((s) => s.clearHistory);
  const removeSong = useHistoryStore((s) => s.removeSong);
  const loadSong = useAudioStore((s) => s.loadSong);
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const validHistory = useMemo(() => history.filter(e => e && e.song), [history]);
  const containerHeight = containerRef.current?.clientHeight || 600;

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
  const endIndex = Math.min(validHistory.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + BUFFER);
  const visibleItems = validHistory.slice(startIndex, endIndex);

  const totalHeight = validHistory.length * ROW_HEIGHT;

  const lastScrollRef = useRef(0);
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const now = Date.now();
    if (now - lastScrollRef.current < 16) return;
    lastScrollRef.current = now;
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const formatTime = useCallback((timestamp: number) => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  }, []);

  const handlePlayAll = useCallback((entry: any, index: number) => {
    const songs = validHistory.map(e => e.song);
    loadSong(entry.song, songs, index);
  }, [validHistory, loadSong]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={goBack} className="p-2 rounded-xl hover:bg-white/5 transition-colors text-gray-400 hover:text-white" aria-label="Go back">
            <ArrowLeft size={20} />
          </button>
          <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-xl flex items-center justify-center">
            <Clock size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Listening History</h1>
            <p className="text-sm text-gray-400">{validHistory.length} songs played</p>
          </div>
        </div>
        {history.length > 0 && (
          <button
            onClick={clearHistory}
            className="px-4 py-2 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all text-sm"
          >
            <Trash2 size={14} className="inline mr-2" />
            Clear History
          </button>
        )}
      </div>

      {validHistory.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-gray-400">
          <Music className="w-16 h-16 text-gray-600 mb-4" />
          <p className="text-lg">No listening history</p>
          <p className="text-sm text-gray-600">Start playing songs to build your history</p>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="space-y-2 overflow-y-auto"
          style={{ maxHeight: 'calc(100vh - 200px)' }}
          onScroll={handleScroll}
        >
          <div style={{ height: totalHeight, position: 'relative' }}>
            {visibleItems.map((entry, i) => {
              const realIndex = startIndex + i;
              return (
                <div
                  key={`${entry.song.id}-${entry.playedAt}`}
                  style={{ position: 'absolute', top: realIndex * ROW_HEIGHT, left: 0, right: 0 }}
                >
                  <HistoryRow
                    entry={entry}
                    formatTime={formatTime}
                    onPlay={() => handlePlayAll(entry, realIndex)}
                    onRemove={() => removeSong(entry.song.id)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default HistoryPage;
