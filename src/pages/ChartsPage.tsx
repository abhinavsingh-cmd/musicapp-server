import React, { useEffect } from 'react';
import { useChartsStore, ChartSong } from '../stores/chartsStore';
import { useAudioStore } from '../stores/audioStore';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus, Sparkles, Music, Loader2 } from 'lucide-react';

export const ChartsPage: React.FC = () => {
  const topCharts = useChartsStore((s) => s.topCharts);
  const globalCharts = useChartsStore((s) => s.globalCharts);
  const bollywoodCharts = useChartsStore((s) => s.bollywoodCharts);
  const loading = useChartsStore((s) => s.loading);
  const error = useChartsStore((s) => s.error);
  const fetchCharts = useChartsStore((s) => s.fetchCharts);
  const loadSong = useAudioStore((s) => s.loadSong);
  const [activeTab, setActiveTab] = React.useState<'top' | 'global' | 'bollywood'>('top');

  useEffect(() => {
    fetchCharts();
  }, [fetchCharts]);

  const charts = activeTab === 'top' ? topCharts : activeTab === 'global' ? globalCharts : bollywoodCharts;

  const handlePlay = (song: ChartSong, index: number) => {
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
    loadSong(songData, charts.map(c => ({
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
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'up': return <TrendingUp size={12} className="text-emerald-400" />;
      case 'down': return <TrendingDown size={12} className="text-red-400" />;
      case 'new': return <Sparkles size={12} className="text-violet-400" />;
      default: return <Minus size={12} className="text-gray-500" />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-xl flex items-center justify-center">
          <TrendingUp size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Charts</h1>
          <p className="text-sm text-gray-400">Trending songs right now</p>
        </div>
      </div>

      {/* Tabs */}
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

      {/* Chart List */}
      <div className="space-y-2">
        {charts.map((song, index) => (
          <motion.div
            key={song.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.02 }}
            onClick={() => handlePlay(song, index)}
            className="flex items-center gap-4 p-3 rounded-xl bg-white/5 hover:bg-white/10 cursor-pointer transition-all group"
          >
            <div className="w-8 text-center">
              <span className={`text-lg font-bold ${
                index < 3 ? 'text-violet-400' : 'text-gray-500'
              }`}>
                {song.rank}
              </span>
            </div>
            <div className="w-5">{getTrendIcon(song.trend)}</div>
            <img
              src={song.thumbnail}
              alt={song.title}
              loading="lazy"
              className="w-12 h-12 rounded-lg object-cover"
            />
            <div className="flex-1 min-w-0">
              <p className="text-white font-medium truncate group-hover:text-violet-300 transition-colors">
                {song.title}
              </p>
              <p className="text-sm text-gray-400 truncate">{song.artist}</p>
            </div>
            <div className="text-gray-500 text-sm">
              {song.duration ? `${Math.floor(song.duration / 60)}:${(song.duration % 60).toString().padStart(2, '0')}` : '--:--'}
            </div>
            <div className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <Music size={14} className="text-violet-400" />
            </div>
          </motion.div>
        ))}
      </div>

      {error && (
        <div className="text-center text-red-400 py-8">
          <p>{error}</p>
          <button onClick={fetchCharts} className="mt-2 text-sm text-violet-400 hover:underline">
            Try again
          </button>
        </div>
      )}
    </div>
  );
};

export default ChartsPage;
