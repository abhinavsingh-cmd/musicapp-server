import { createContext, useContext, useMemo } from 'react';
import { useAudioStore } from '../stores/audioStore';
import { useQueueStore } from '../stores/queueStore';
import { useDownloadsStore } from '../stores/downloadsStore';
import { useHistoryStore } from '../stores/historyStore';
import { useLyricsStore } from '../stores/lyricsStore';
import { useEqualizerStore } from '../stores/equalizerStore';

const AudioContext = createContext<any>(null);

export const useAudioContext = () => {
  const ctx = useContext(AudioContext);
  if (!ctx) throw new Error('useAudioContext must be used within AudioProvider');
  return ctx;
};

export const AudioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const currentSong = useAudioStore((s) => s.currentSong);
  const isPlaying = useAudioStore((s) => s.isPlaying);
  const isLoading = useAudioStore((s) => s.isLoading);
  const volume = useAudioStore((s) => s.volume);
  const isShuffled = useAudioStore((s) => s.isShuffled);
  const repeatMode = useAudioStore((s) => s.repeatMode);
  const progress = useAudioStore((s) => s.progress);
  const duration = useAudioStore((s) => s.duration);
  const error = useAudioStore((s) => s.error);
  const favorites = useAudioStore((s) => s.favorites);
  
  const queue = useQueueStore((s) => s.queue);
  const currentIndex = useQueueStore((s) => s.currentIndex);
  const isShuffledQueue = useQueueStore((s) => s.isShuffled);
  const repeatModeQueue = useQueueStore((s) => s.repeatMode);
  
  const downloads = useDownloadsStore((s) => s.downloads);
  const downloadingIds = useDownloadsStore((s) => s.downloadingIds);
  const progressMap = useDownloadsStore((s) => s.progressMap);
  
  const history = useHistoryStore((s) => s.history);
  const lyrics = useLyricsStore((s) => s.lyrics);
  const currentLyricLine = useLyricsStore((s) => s.currentLine);
  
  const equalizerEnabled = useEqualizerStore((s) => s.enabled);
  const equalizerPreset = useEqualizerStore((s) => s.preset);
  const equalizerGains = useEqualizerStore((s) => s.gains);

  const play = useAudioStore((s) => s.play);
  const pause = useAudioStore((s) => s.pause);
  const togglePlayPause = useAudioStore((s) => s.togglePlayPause);
  const nextSong = useAudioStore((s) => s.nextSong);
  const previousSong = useAudioStore((s) => s.previousSong);
  const seek = useAudioStore((s) => s.seek);
  const setVolume = useAudioStore((s) => s.setVolume);
  const toggleShuffle = useAudioStore((s) => s.toggleShuffle);
  const cycleRepeat = useAudioStore((s) => s.cycleRepeat);
  const toggleFavorite = useAudioStore((s) => s.toggleFavorite);
  const loadSong = useAudioStore((s) => s.loadSong);
  
  const playAtIndex = useQueueStore((s) => s.playAtIndex);
  const addToQueue = useQueueStore((s) => s.addToQueue);
  const addNext = useQueueStore((s) => s.addNext);
  const removeFromQueue = useQueueStore((s) => s.removeFromQueue);
  const reorderQueue = useQueueStore((s) => s.reorderQueue);
  const clearQueue = useQueueStore((s) => s.clearQueue);
  const toggleShuffleQueue = useQueueStore((s) => s.toggleShuffle);
  const cycleRepeatQueue = useQueueStore((s) => s.cycleRepeat);
  
  const downloadSong = useDownloadsStore((s) => s.downloadSong);
  const isDownloaded = useDownloadsStore((s) => s.isDownloaded);
  const isDownloading = useDownloadsStore((s) => s.isDownloading);
  const getProgress = useDownloadsStore((s) => s.getProgress);
  const getBlobUrl = useDownloadsStore((s) => s.getBlobUrl);
  
  const fetchLyrics = useLyricsStore((s) => s.fetchLyrics);
  const updateCurrentLine = useLyricsStore((s) => s.updateCurrentLine);
  const clearLyrics = useLyricsStore((s) => s.clearLyrics);
  
  const toggleEqualizer = useEqualizerStore((s) => s.toggle);
  const setBand = useEqualizerStore((s) => s.setBand);
  const setPreset = useEqualizerStore((s) => s.setPreset);

  const value = useMemo(() => ({
    currentSong,
    isPlaying,
    isLoading,
    volume,
    isShuffled,
    repeatMode,
    progress,
    duration,
    error,
    favorites,
    
    queue,
    currentIndex,
    isShuffledQueue,
    repeatModeQueue,
    
    downloads,
    downloadingIds,
    progressMap,
    
    history,
    lyrics,
    currentLyricLine,
    
    equalizerEnabled,
    equalizerPreset,
    equalizerGains,
    
    play,
    pause,
    togglePlayPause,
    nextSong,
    previousSong,
    seek,
    setVolume,
    toggleShuffle,
    cycleRepeat,
    toggleFavorite,
    loadSong,
    
    playAtIndex,
    addToQueue,
    addNext,
    removeFromQueue,
    reorderQueue,
    clearQueue: clearQueue,
    toggleShuffleQueue,
    cycleRepeatQueue,
    
    downloadSong,
    isDownloaded,
    isDownloading,
    getProgress,
    getBlobUrl,
    
    fetchLyrics,
    updateCurrentLine,
    clearLyrics,
    
    toggleEqualizer,
    setBand,
    setPreset,
  }), [
    currentSong, isPlaying, isLoading, volume, isShuffled, repeatMode, progress, duration, error, favorites,
    queue, currentIndex, isShuffledQueue, repeatModeQueue,
    downloads, downloadingIds, progressMap,
    history, lyrics, currentLyricLine,
    equalizerEnabled, equalizerPreset, equalizerGains,
    play, pause, togglePlayPause, nextSong, previousSong, seek, setVolume, toggleShuffle, cycleRepeat, toggleFavorite, loadSong,
    playAtIndex, addToQueue, addNext, removeFromQueue, reorderQueue, clearQueue, toggleShuffleQueue, cycleRepeatQueue,
    downloadSong, isDownloaded, isDownloading, getProgress, getBlobUrl,
    fetchLyrics, updateCurrentLine, clearLyrics,
    toggleEqualizer, setBand, setPreset,
  ]);

  return (
    <AudioContext.Provider value={value}>
      {children}
    </AudioContext.Provider>
  );
};