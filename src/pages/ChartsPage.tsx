import React, { useEffect, useCallback, useMemo, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGoBack } from '../hooks/useGoBack';
import { useChartsStore, ChartSong, TrendingSource } from '../stores/chartsStore';
import { useAudioStore } from '../stores/audioStore';
import { TrendingUp, TrendingDown, Minus, Sparkles, Music, ArrowLeft, RefreshCw, Clock, Globe, AlertTriangle } from 'lucide-react';
import { TRENDING_SOURCE_LABELS } from '../utils/trendingLabels';
import CachedImage from '../components/CachedImage';
import { DownloadButton } from '../components/DownloadButton';
import { deferIdle } from '../utils/idle';
import { useSongContextMenu } from '../components/SongContextMenu';
import { Song } from '../types/music';
import { useVirtualList } from '../hooks/useVirtualList';
import { useRef } from 'react';

const CHART_ROW_HEIGHT = 60;

const chartSongToSong = (song: ChartSong): Song => ({
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
});

const SOURCE_LABELS: Record<TrendingSource, string> = {
  ...TRENDING_SOURCE_LABELS,
  none: '',
};

const SOURCE_ICONS: Record<TrendingSource, React.ReactNode> = {
  LIVE: <Globe size={12} className="text-red-400" />,
  CACHED: <Clock size={12} className="text-yellow-400" />,
  LIBRARY: <Music size={12} className="text-blue-400" />,
  BUILT_IN: <Music size={12} className="text-gray-400" />,
  none: null,
};

const ChartRow = memo(({ song, index, onPlay, getTrendIcon, onContextMenu, onTouchStart, downloadableSong }: {
  song: ChartSong;
  index: number;
  onPlay: () => void;
  getTrendIcon: (trend: string) => React.ReactNode;
  onContextMenu: (e: React.MouseEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
  downloadableSong: Song;
}) => (
  <div
    onClick={onPlay}
    onContextMenu={onContextMenu}
    onTouchStart={onTouchStart}
    className="flex items-center gap-4 p-3 rounded-xl bg-white/5 hover:bg-white/10 cursor-pointer transition-colors group"
    style={{ height: CHART_ROW_HEIGHT, position: 'absolute', top: index * CHART_ROW_HEIGHT, left: 0, right: 0 }}
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
      youtubeId={song.youtubeId}
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
    <DownloadButton song={downloadableSong} className="w-8 h-8 rounded-full bg-white/5" />
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
  const refreshing = useChartsStore((s) => s.refreshing);
  const error = useChartsStore((s) => s.error);
  const lastUpdated = useChartsStore((s) => s.lastUpdated);
  const source = useChartsStore((s) => s.source);
  const origin = useChartsStore((s) => s.origin);
  const hydrateFromCache = useChartsStore((s) => s.hydrateFromCache);
  const fetchCharts = useChartsStore((s) => s.fetchCharts);
  const loadSong = useAudioStore((s) => s.loadSong);
  const [activeTab, setActiveTab] = React.useState<'top' | 'global' | 'bollywood'>('top');
  const chartListRef = useRef<HTMLDivElement>(null);

  const { handleContextMenu, handleLongPress, ContextMenu } = useSongContextMenu(
    (artist) => navigate(`/search?q=${encodeURIComponent(artist)}`),
    (album) => navigate(`/search?q=${encodeURIComponent(album)}`),
  );

  useEffect(() => {
    // Initialize from cache synchronously, then fetch fresh
    deferIdle(() => {
      hydrateFromCache();
      // Then fetch fresh data
      fetchCharts();
    });
  }, [hydrateFromCache, fetchCharts]);

  const charts = useMemo(() =>
    (activeTab === 'top' ? topCharts : activeTab === 'global' ? globalCharts : bollywoodCharts) || [],
    [activeTab, topCharts, globalCharts, bollywoodCharts]
  );
  const chartWin = useVirtualList(charts.length, CHART_ROW_HEIGHT, chartListRef);

  const handlePlay = useCallback((song: ChartSong, index: number) => {
    const clicked = charts[index]?.id === song.id ? charts[index] : charts.find((c) => c.id === song.id);
    if (!clicked) return;
    let target: Song;
    try {
      target = chartSongToSong(clicked);
    } catch {
      return; // a malformed row must never crash playback
    }
    // Same playback pipeline as every other list: full visible chart as the
    // queue with the clicked song's position — per-item isolated so one bad
    // row is skipped instead of breaking the queue.
    const queue: Song[] = [];
    for (const c of charts) {
      try { queue.push(chartSongToSong(c)); } catch { /* skip bad item */ }
    }
    const qIdx = queue.findIndex((s) => s.id === target.id);
    if (queue.length === 0 || qIdx < 0) return;
    loadSong(queue[qIdx], queue, qIdx);
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
              {source === 'LIVE' && origin === 'charts' ? 'Live · Official Charts' : SOURCE_LABELS[source]} · {formatLastUpdated(lastUpdated)}
            </span>
          )}
          <button
            onClick={() => fetchCharts({ force: true })}
            disabled={loading || refreshing}
            className="p-2 rounded-lg hover:bg-white/5 transition-colors text-gray-400 hover:text-white disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading || refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-300">
          <AlertTriangle size={14} className="flex-shrink-0" />
          <span>{charts.length > 0 ? `${error}.` : error}</span>
        </div>
      )}

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

      {!loading && charts.length === 0 && (
        <div className="text-center py-16 space-y-3">
          <Music size={40} className="mx-auto text-gray-600" />
          <p className="text-gray-400">No songs in this chart right now</p>
          <button
            onClick={() => fetchCharts({ force: true })}
            className="px-4 py-2 rounded-xl bg-violet-500 hover:bg-violet-600 text-white text-sm font-medium transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {charts.length > 0 && (
        <div ref={chartListRef} style={{ position: 'relative', height: chartWin.totalHeight }}>
          {charts.slice(chartWin.start, chartWin.end).map((song, i) => {
            const index = chartWin.start + i;
            const downloadableSong = chartSongToSong(song);
            return (
              <ChartRow
                key={song.id}
                song={song}
                index={index}
                onPlay={() => handlePlay(song, index)}
                getTrendIcon={getTrendIcon}
                onContextMenu={(e) => handleContextMenu(e, downloadableSong)}
                onTouchStart={(e) => handleLongPress(e, downloadableSong)}
                downloadableSong={downloadableSong}
              />
            );
          })}
        </div>
      )}
      <ContextMenu />
    </div>
  );
};

export default ChartsPage;
