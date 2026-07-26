import React, { useEffect, useCallback, useMemo, memo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGoBack } from '../hooks/useGoBack';
import { useChartsStore, ChartSong, TrendingSource } from '../stores/chartsStore';
import { useAudioStore } from '../stores/audioStore';
import { TrendingUp, TrendingDown, Minus, Sparkles, Music, ArrowLeft, RefreshCw, Clock, Globe, Radio } from 'lucide-react';
import CachedImage from '../components/CachedImage';
import { useSongContextMenu } from '../components/SongContextMenu';

const ROW_HEIGHT = 60;
const BUFFER = 8;

const SOURCE_LABELS: Record<TrendingSource, string> = {
  youtube_music: 'Live from YouTube Music',
  charts: 'Official Charts',
  cache: 'Cached Data',
  builtin: 'Built-in Catalog',
  none: '',
};

const SOURCE_ICONS: Record<TrendingSource, React.ReactNode> = {
  youtube_music: <Globe size={12} className="text-red-400" />,
  charts: <Radio size={12} className="text-emerald-400" />,
  cache: <Clock size={12} className="text-yellow-400" />,
  builtin: <Music size={12} className="text-gray-400" />,
  none: null,
};

const ChartRow = memo(({ song, index, onPlay, getTrendIcon, onContextMenu, onTouchStart }: {
  song: ChartSong;
  index: number;
  onPlay: () => void;
  getTrendIcon: (trend: string) => React.ReactNode;
  onContextMenu: (e: React.MouseEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
}) => (
  <div
    onClick={onPlay}
    onContextMenu={onContextMenu}
    onTouchStart={onTouchStart}
    className="flex items-center gap-4 p-3 rounded-xl bg-white/5 hover:bg-white/10 cursor-pointer transition-colors group"
    style={{ height: ROW_HEIGHT }}
  >
    <div className="w-8 text-center flex-shrink-0">
      <span className={`text-lg font-bold ${
        index < 3 ? 'text-violet-400' : 'text-gray-500'
      }`}>
        {song.rank}
      </span>
    </div>
    <div className="w-5 flex-shrink-0">{getTrendIcon(song.trend)}</div>
    <CachedImage
      src={song.thumbnail}
      alt={song.title}
      className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
    />
    <div className="flex-1 min-w-0">
      <p className="text-white font-medium truncate group-hover:text-violet-300 transition-colors text-sm">
        {song.title}
      </p>
      <p className="text-xs text-gray-400 truncate">{song.artist}</p>
    </div>
    <div className="text-gray-500 text-sm flex-shrink-0">
      {song.duration ? `${Math.floor(song.duration / 60)}:${(song.duration % 60).toString().padStart(2, '0')}` : '--:--'}
    </div>
    <div className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
      <Music size={14} className="text-violet-400" />
    </div>
  </div>
));
ChartRow.displayName = 'ChartRow';

function formatLastUpdated(ts: number | null): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export const ChartsPage: React.FC = () => {
  const navigate = useNavigate();
  const goBack = useGoBack();
  const topCharts = useChartsStore((s) => s.topCharts);
  const globalCharts = useChartsStore((s) => s.globalCharts);
  const bollywoodCharts = useChartsStore((s) => s.bollywoodCharts);
  const loading = useChartsStore((s) => s.loading);
  const error = useChartsStore((s) => s.error);
  const lastUpdated = useChartsStore((s) => s.lastUpdated);
  const source = useChartsStore((s) => s.source);
  const fetchCharts = useChartsStore((s) => s.fetchCharts);
  const loadSong = useAudioStore((s) => s.loadSong);
  const [activeTab, setActiveTab] = React.useState<'top' | 'global' | 'bollywood'>('top');
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const rafRef = useRef<number>(0);

  const { handleContextMenu, handleLongPress, ContextMenu } = useSongContextMenu(
    (artist) => navigate(`/search?q=${encodeURIComponent(artist)}`),
    (album) => navigate(`/search?q=${encodeURIComponent(album)}`),
  );

  useEffect(() => {
    fetchCharts();
  }, [fetchCharts]);

  const charts = useMemo(() =>
    (activeTab === 'top' ? topCharts : activeTab === 'global' ? globalCharts : bollywoodCharts) || [],
    [activeTab, topCharts, globalCharts, bollywoodCharts]
  );

  const handleScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      if (scrollContainerRef.current) {
        setScrollTop(scrollContainerRef.current.scrollTop);
      }
      rafRef.current = 0;
    });
  }, []);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setContainerHeight(entry.contentRect.height);
    });
    observer.observe(el);
    setContainerHeight(el.clientHeight);
    return () => {
      el.removeEventListener('scroll', handleScroll);
      observer.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [handleScroll, activeTab]);

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
  const visibleCount = Math.min(charts.length - startIndex, Math.ceil(containerHeight / ROW_HEIGHT) + BUFFER * 2);
  const visibleCharts = charts.slice(startIndex, startIndex + visibleCount);

  const handlePlay = useCallback((song: ChartSong, index: number) => {
    const songData = {
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: 'Charts',
      duration: song.duration || 200,
      genre: 'Pop',
      coverArt: song.thumbnail,
      audioUrl: '',
      youtubeId: song.youtubeId,
      releaseYear: new Date().getFullYear(),
    };
    loadSong(songData, (charts || []).map(c => ({
      id: c.id,
      title: c.title,
      artist: c.artist,
      album: 'Charts',
      duration: c.duration || 200,
      genre: 'Pop',
      coverArt: c.thumbnail,
      audioUrl: '',
      youtubeId: c.youtubeId,
      releaseYear: new Date().getFullYear(),
    })), index);
  }, [charts, loadSong]);

  const getTrendIcon = useCallback((trend: string) => {
    switch (trend) {
      case 'up': return <TrendingUp size={12} className="text-emerald-400" />;
      case 'down': return <TrendingDown size={12} className="text-red-400" />;
      case 'new': return <Sparkles size={12} className="text-violet-400" />;
      default: return <Minus size={12} className="text-gray-500" />;
    }
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={goBack} className="p-2 rounded-xl hover:bg-white/5 transition-colors text-gray-400 hover:text-white" aria-label="Go back">
          <ArrowLeft size={20} />
        </button>
        <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-xl flex items-center justify-center">
          <TrendingUp size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Charts</h1>
          <p className="text-sm text-gray-400">Trending songs right now</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(['top', 'global', 'bollywood'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                activeTab === tab
                  ? 'bg-violet-500 text-white'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10'
              }`}
            >
              {tab === 'top' ? 'Top Charts' : tab === 'global' ? 'Global' : 'Bollywood'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-gray-500 flex items-center gap-1">
              {SOURCE_ICONS[source]}
              {SOURCE_LABELS[source]} · {formatLastUpdated(lastUpdated)}
            </span>
          )}
          <button
            onClick={fetchCharts}
            disabled={loading}
            className="p-2 rounded-lg hover:bg-white/5 transition-colors text-gray-400 hover:text-white disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading && charts.length === 0 && (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-3 rounded-xl bg-white/5 animate-pulse" style={{ animationDelay: `${i * 40}ms` }}>
              <div className="w-8 h-4 rounded bg-white/10" />
              <div className="w-5 h-4 rounded bg-white/10" />
              <div className="w-12 h-12 rounded-lg bg-white/10" />
              <div className="flex-1 space-y-2">
                <div className="h-4 rounded bg-white/10 w-3/4" />
                <div className="h-3 rounded bg-white/10 w-1/2" />
              </div>
              <div className="w-10 h-4 rounded bg-white/10" />
            </div>
          ))}
        </div>
      )}

      {!loading && error && charts.length === 0 && (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
            <TrendingUp size={24} className="text-red-400" />
          </div>
          <p className="text-red-400 font-medium mb-2">{error}</p>
          <button
            onClick={fetchCharts}
            className="px-4 py-2 rounded-xl bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 transition-colors text-sm font-medium"
          >
            Try again
          </button>
        </div>
      )}

      {!loading && !error && charts.length === 0 && (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
            <Music size={24} className="text-gray-500" />
          </div>
          <p className="text-gray-400 font-medium mb-2">No chart data available</p>
          <button
            onClick={fetchCharts}
            className="px-4 py-2 rounded-xl bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 transition-colors text-sm font-medium"
          >
            Try again
          </button>
        </div>
      )}

      {charts.length > 0 && (
        <div ref={scrollContainerRef} style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          <div style={{ height: charts.length * ROW_HEIGHT, position: 'relative' }}>
            <div style={{ transform: `translateY(${startIndex * ROW_HEIGHT}px)` }}>
              {visibleCharts.map((song, i) => {
                const actualIndex = startIndex + i;
                return (
                  <ChartRow
                    key={song.id}
                    song={song}
                    index={actualIndex}
                    onPlay={() => handlePlay(song, actualIndex)}
                    getTrendIcon={getTrendIcon}
                    onContextMenu={(e) => handleContextMenu(e, {
                      id: song.id, title: song.title, artist: song.artist, album: 'Charts',
                      duration: song.duration || 200, genre: 'Pop', coverArt: song.thumbnail,
                      audioUrl: '', youtubeId: song.youtubeId, releaseYear: new Date().getFullYear(),
                    })}
                    onTouchStart={(e) => handleLongPress(e, {
                      id: song.id, title: song.title, artist: song.artist, album: 'Charts',
                      duration: song.duration || 200, genre: 'Pop', coverArt: song.thumbnail,
                      audioUrl: '', youtubeId: song.youtubeId, releaseYear: new Date().getFullYear(),
                    })}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}
      <ContextMenu />
    </div>
  );
};

export default ChartsPage;
