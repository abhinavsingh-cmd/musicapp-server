import React, { useEffect, useCallback, useMemo, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGoBack } from '../hooks/useGoBack';
import { useChartsStore, ChartSong, TrendingSource } from '../stores/chartsStore';
import { useAudioStore } from '../stores/audioStore';
import { trendingService } from '../services/trendingService';
import { TrendingUp, TrendingDown, Minus, Sparkles, Music, ArrowLeft, RefreshCw, Clock, Globe, Radio, Download, Check, Loader2 } from 'lucide-react';
import CachedImage from '../components/CachedImage';
import { useSongContextMenu } from '../components/SongContextMenu';
import { useDownloadsStore } from '../stores/downloadsStore';

const SOURCE_LABELS: Record<TrendingSource, string> = {
  youtube_music: 'Live from YouTube Music',
  charts: 'Official Charts',
  cache: 'Cached Data',
  builtin: 'Built-in Catalog',
  local_library: 'Local Library',
  none: '',
};

const SOURCE_ICONS: Record<TrendingSource, React.ReactNode> = {
  youtube_music: <Globe size={12} className="text-red-400" />,
  charts: <Radio size={12} className="text-emerald-400" />,
  cache: <Clock size={12} className="text-yellow-400" />,
  builtin: <Music size={12} className="text-gray-400" />,
  local_library: <Music size={12} className="text-blue-400" />,
  none: null,
};

const ChartRow = memo(({ song, index, onPlay, getTrendIcon, onContextMenu, onTouchStart, isDownloaded, isDownloading, onDownload }: {
  song: ChartSong;
  index: number;
  onPlay: () => void;
  getTrendIcon: (trend: string) => React.ReactNode;
  onContextMenu: (e: React.MouseEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
  isDownloaded: boolean;
  isDownloading: boolean;
  onDownload: (e: React.MouseEvent) => void;
}) => (
  <div
    onClick={onPlay}
    onContextMenu={onContextMenu}
    onTouchStart={onTouchStart}
    className="flex items-center gap-4 p-3 rounded-xl bg-white/5 hover:bg-white/10 cursor-pointer transition-colors group"
    style={{ height: 60 }}
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
    <button
      onClick={(e) => { e.stopPropagation(); onDownload(e); }}
      className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors flex-shrink-0"
      title={isDownloaded ? 'Downloaded' : isDownloading ? 'Downloading...' : 'Download'}
    >
      {isDownloaded ? (
        <Check size={14} className="text-emerald-400" />
      ) : isDownloading ? (
        <Loader2 size={14} className="text-violet-400 animate-spin" />
      ) : (
        <Download size={14} className="text-gray-400 group-hover:text-white" />
      )}
    </button>
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
  const lastUpdated = useChartsStore((s) => s.lastUpdated);
  const source = useChartsStore((s) => s.source);
  const fetchCharts = useChartsStore((s) => s.fetchCharts);
  const loadSong = useAudioStore((s) => s.loadSong);
  const [activeTab, setActiveTab] = React.useState<'top' | 'global' | 'bollywood'>('top');

  const { handleContextMenu, handleLongPress, ContextMenu } = useSongContextMenu(
    (artist) => navigate(`/search?q=${encodeURIComponent(artist)}`),
    (album) => navigate(`/search?q=${encodeURIComponent(album)}`),
  );

  const isDownloadedFn = useDownloadsStore((s) => s.isDownloaded);
  const isDownloadingFn = useDownloadsStore((s) => s.isDownloading);
  const downloadSong = useDownloadsStore((s) => s.downloadSong);

  useEffect(() => {
    const defer = typeof requestIdleCallback === 'function'
      ? requestIdleCallback
      : (cb: IdleRequestCallback) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 0);
    
    // Initialize from cache synchronously, then fetch fresh
    defer(() => {
      const initial = trendingService.getState();
      if (initial && initial.songs.length > 0) {
        useChartsStore.setState({
          topCharts: initial.songs.map((song, i) => ({
            id: `initial-${i}-${song.id}`, title: song.title, artist: song.artist,
            thumbnail: song.coverArt, rank: i + 1, trend: 'up',
            duration: song.duration, viewCount: 0
          })),
          source: initial.source as TrendingSource,
          lastUpdated: initial.lastUpdated || Date.now(),
        });
      }
      
      // Then fetch fresh data
      fetchCharts();
    });
  }, [fetchCharts]);

  const charts = useMemo(() =>
    (activeTab === 'top' ? topCharts : activeTab === 'global' ? globalCharts : bollywoodCharts) || [],
    [activeTab, topCharts, globalCharts, bollywoodCharts]
  );

  const handlePlay = useCallback((song: ChartSong, index: number) => {
    const filteredChart = charts[index] || charts.find((c) => c.id === song.id);
    if (!filteredChart) return;
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
    loadSong(songData, (filteredChart ? [filteredChart] : []).map(c => ({
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

  const handleDownload = useCallback((song: ChartSong) => {
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
    downloadSong(songData);
  }, [downloadSong]);

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

      {charts.length > 0 && (
        <div>
          {charts.map((song, i) => {
            return (
              <ChartRow
                key={song.id}
                song={song}
                index={i}
                onPlay={() => handlePlay(song, i)}
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
                isDownloaded={isDownloadedFn(song.youtubeId || song.id)}
                isDownloading={isDownloadingFn(song.youtubeId || song.id)}
                onDownload={() => handleDownload(song)}
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
