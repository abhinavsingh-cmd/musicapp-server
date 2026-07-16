import React from 'react';
import { useHistoryStore } from '../stores/historyStore';
import { useAudioStore } from '../stores/audioStore';
import { motion } from 'framer-motion';
import { Clock, Trash2, Music, Play } from 'lucide-react';

export const HistoryPage: React.FC = () => {
  const { history, clearHistory, removeSong } = useHistoryStore();
  const { loadSong } = useAudioStore();

  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  };

  const handlePlay = (entry: any, index: number) => {
    const songs = history.map(e => e.song);
    loadSong(entry.song, songs, index);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-xl flex items-center justify-center">
            <Clock size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Listening History</h1>
            <p className="text-sm text-gray-400">{history.length} songs played</p>
          </div>
        </div>
        {history.length > 0 && (
          <motion.button
            onClick={clearHistory}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="px-4 py-2 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all text-sm"
          >
            <Trash2 size={14} className="inline mr-2" />
            Clear History
          </motion.button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-gray-400">
          <Music className="w-16 h-16 text-gray-600 mb-4" />
          <p className="text-lg">No listening history</p>
          <p className="text-sm text-gray-600">Start playing songs to build your history</p>
        </div>
      ) : (
        <div className="space-y-2">
          {history.map((entry, index) => (
            <motion.div
              key={`${entry.song.id}-${entry.playedAt}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.02 }}
              className="flex items-center gap-4 p-3 rounded-xl bg-white/5 hover:bg-white/10 group transition-all"
            >
              <button
                onClick={() => handlePlay(entry, index)}
                className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Play size={16} className="text-violet-400 ml-0.5" />
              </button>
              <img
                src={entry.song.coverArt}
                alt={entry.song.title}
                loading="lazy"
                className="w-12 h-12 rounded-lg object-cover"
              />
              <div className="flex-1 min-w-0">
                <p className="text-white font-medium truncate">{entry.song.title}</p>
                <p className="text-sm text-gray-400 truncate">{entry.song.artist}</p>
              </div>
              <span className="text-xs text-gray-500">{formatTime(entry.playedAt)}</span>
              <button
                onClick={() => removeSong(entry.song.id)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100"
              >
                <Trash2 size={14} />
              </button>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

export default HistoryPage;
